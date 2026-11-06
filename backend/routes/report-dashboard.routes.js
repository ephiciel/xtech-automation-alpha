"use strict";
/** Existing report and dashboard calculations, preserved from backend/server.js.
 * Firestore access is lazy for Cloudflare Worker startup compatibility.
 */
function registerReportDashboardRoutes(app, deps) {
    const {
        authRequired,
        roles,
        getDb,
        operationalProduct,
        operationalSale,
        serialize,
        parseRange,
        inRange,
        dateYMD,
        datePart,
        num
    } = deps;
    if (typeof getDb !== "function")
        throw new TypeError("Report routes require lazy Firestore access.");
    const db = { collection: (...args) => getDb().collection(...args) };

    /* REPORTS */
    async function reportData() {
        const [products, transactions, sales, pickups, customers] = await Promise.all([
            db.collection("products").get(),
            db.collection("inventoryTransactions").get(),
            db.collection("sales").get(),
            db.collection("pickups").get(),
            db.collection("customers").get()
        ]);
        return {
            products: products.docs.map((doc) => operationalProduct(doc.data())),
            transactions: transactions.docs.map((doc) => serialize(doc.data())),
            sales: sales.docs.map((doc) => operationalSale(doc.data())),
            pickups: pickups.docs.map((doc) => serialize(doc.data())),
            customers: customers.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) }))
        };
    }

    function reportView(data, start, end) {
        const activeProducts = data.products.filter((product) => product.active !== false);
        const lowStock = activeProducts.filter(
            (product) => num(product.quantity) <= num(product.reorderLevel)
        );
        const transactions = data.transactions
            .filter((item) => inRange(item.createdAt, start, end))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const sales = data.sales
            .filter((item) => inRange(item.createdAt, start, end))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const pickups = data.pickups
            .filter((item) => inRange(item.createdAt, start, end))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const unitsSold = sales
            .filter((sale) => sale.status === "Confirmed")
            .reduce(
                (sum, sale) =>
                    sum +
                    (sale.items || []).reduce((itemSum, item) => itemSum + num(item.quantity), 0),
                0
            );

        return {
            metrics: {
                totalProducts: activeProducts.length,
                lowStock: lowStock.length,
                activeCustomers: data.customers.filter((customer) => customer.active !== false)
                    .length,
                sales: sales.length,
                unitsSold,
                pickups: pickups.length,
                pendingPickups: pickups.filter((pickup) => pickup.status === "Pending").length,
                completedPickups: pickups.filter((pickup) => pickup.status === "Completed").length
            },
            inventory: activeProducts,
            lowStock,
            transactions,
            sales,
            pickups
        };
    }

    app.get("/api/reports/summary", authRequired, roles("admin"), async (req, res) => {
        try {
            const { start, end } = parseRange(req);
            const view = reportView(await reportData(), start, end);
            res.json({
                success: true,
                generatedAt: new Date().toISOString(),
                period: { start, end },
                ...view
            });
        } catch (error) {
            console.error(error);
            res.status(error.status || 500).json({
                success: false,
                message: error.message || "Failed to generate report."
            });
        }
    });

    app.get("/api/reports/csv/:type", authRequired, roles("admin"), async (req, res) => {
        try {
            const { start, end } = parseRange(req);
            const view = reportView(await reportData(), start, end);
            const type = req.params.type;
            let rows;

            if (type === "inventory") {
                rows = [
                    [
                        "Product ID",
                        "Product Name",
                        "Category",
                        "Unit of Measure",
                        "Quantity in Stock",
                        "Reorder Level",
                        "Stock Status"
                    ],
                    ...view.inventory.map((product) => [
                        product.productID,
                        product.productName,
                        product.category,
                        product.unit,
                        product.quantity,
                        product.reorderLevel,
                        num(product.quantity) <= 0
                            ? "Out of Stock"
                            : num(product.quantity) <= num(product.reorderLevel)
                              ? "Low Stock"
                              : "In Stock"
                    ])
                ];
            } else if (type === "transactions") {
                rows = [
                    [
                        "Date & Time",
                        "Movement Type",
                        "Product ID",
                        "Product Name",
                        "Quantity Changed",
                        "Stock Before",
                        "Stock After",
                        "Reason / Reference",
                        "Performed By"
                    ],
                    ...view.transactions.map((item) => [
                        item.createdAt,
                        item.type,
                        item.productID,
                        item.productName,
                        item.quantity,
                        item.previousQuantity,
                        item.newQuantity,
                        item.reason,
                        item.performedBy
                    ])
                ];
            } else if (type === "sales") {
                rows = [
                    [
                        "Date & Time",
                        "Sale Reference",
                        "Customer",
                        "Status",
                        "Products / Quantity",
                        "Processed By"
                    ],
                    ...view.sales.map((sale) => [
                        sale.createdAt,
                        sale.saleID,
                        sale.customerName || "Walk-in / No registered customer",
                        sale.status,
                        (sale.items || [])
                            .map(
                                (item) =>
                                    `${item.productName || item.productID} x ${num(item.quantity)}`
                            )
                            .join("; "),
                        sale.createdByName || ""
                    ])
                ];
            } else if (type === "pickups") {
                rows = [
                    [
                        "Request Date & Time",
                        "Pickup Reference",
                        "Customer",
                        "Requested Pickup Date",
                        "Status",
                        "Notes"
                    ],
                    ...view.pickups.map((pickup) => [
                        pickup.createdAt,
                        pickup.pickupID,
                        pickup.customerName || "Walk-in / No registered customer",
                        pickup.requestedDate,
                        pickup.status,
                        pickup.notes
                    ])
                ];
            } else {
                return res.status(400).json({ success: false, message: "Unknown report type." });
            }

            const csv = rows
                .map((row) =>
                    row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
                )
                .join("\n");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename=xtech-${type}-report.csv`);
            res.send("\uFEFF" + csv);
        } catch (error) {
            console.error(error);
            res.status(error.status || 500).json({
                success: false,
                message: error.message || "Failed to export report."
            });
        }
    });

    /* DASHBOARD */
    app.get(
        "/api/dashboard",
        authRequired,
        roles("admin", "secretary", "warehouse"),
        async (req, res) => {
            try {
                const [productSnap, customerSnap, pickupSnap, salesSnap, transactionSnap] =
                    await Promise.all([
                        db.collection("products").where("active", "==", true).get(),
                        db.collection("customers").get(),
                        db.collection("pickups").get(),
                        db.collection("sales").get(),
                        db.collection("inventoryTransactions").get()
                    ]);

                const products = productSnap.docs.map((doc) => serialize(doc.data()));
                const customers = customerSnap.docs.map((doc) => serialize(doc.data()));
                const pickups = pickupSnap.docs.map((doc) => serialize(doc.data()));
                const sales = salesSnap.docs.map((doc) => serialize(doc.data()));
                const transactions = transactionSnap.docs.map((doc) => serialize(doc.data()));

                const days = [];
                for (let offset = 6; offset >= 0; offset--) {
                    const date = new Date();
                    date.setHours(12, 0, 0, 0);
                    date.setDate(date.getDate() - offset);
                    days.push(dateYMD(date));
                }

                const weeklyPickups = days.map((date) => ({
                    date,
                    count: pickups.filter((pickup) => datePart(pickup.createdAt) === date).length
                }));
                const weeklySales = days.map((date) => {
                    const confirmed = sales.filter(
                        (sale) => datePart(sale.createdAt) === date && sale.status === "Confirmed"
                    );
                    return {
                        date,
                        count: confirmed.length,
                        unitsSold: confirmed.reduce(
                            (sum, sale) =>
                                sum +
                                (sale.items || []).reduce(
                                    (itemSum, item) => itemSum + num(item.quantity),
                                    0
                                ),
                            0
                        )
                    };
                });

                const allLowStockProducts = products.filter(
                    (product) => num(product.quantity) <= num(product.reorderLevel)
                );
                const lowStockProducts = allLowStockProducts
                    .sort((a, b) => num(a.quantity) - num(b.quantity))
                    .slice(0, 8);
                const recentTransactions = transactions
                    .sort((a, b) =>
                        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
                    )
                    .slice(0, 8);

                res.json({
                    success: true,
                    metrics: {
                        totalProducts: products.length,
                        lowStock: allLowStockProducts.length,
                        customers: customers.filter((customer) => customer.active !== false).length,
                        pendingPickups: pickups.filter((pickup) => pickup.status === "Pending")
                            .length,
                        totalSales: sales.length,
                        totalUnitsSold: sales
                            .filter((sale) => sale.status === "Confirmed")
                            .reduce(
                                (sum, sale) =>
                                    sum +
                                    (sale.items || []).reduce(
                                        (itemSum, item) => itemSum + num(item.quantity),
                                        0
                                    ),
                                0
                            )
                    },
                    inventory: products
                        .sort((a, b) => num(b.quantity) - num(a.quantity))
                        .slice(0, 12)
                        .map((product) => ({
                            name: product.productName,
                            quantity: num(product.quantity)
                        })),
                    weeklyPickups,
                    weeklySales,
                    lowStockProducts,
                    recentTransactions
                });
            } catch (error) {
                console.error(error);
                res.status(500).json({ success: false, message: "Failed to load dashboard." });
            }
        }
    );
}
module.exports = { registerReportDashboardRoutes };
