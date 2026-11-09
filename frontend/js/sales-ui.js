"use strict";
// Stage 4.37: sales-ui has no network or Firebase side effects at module load.
(function registerSalesUi(global) {
    function createSalesUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            esc,
            badge,
            within,
            fmtDateTime,
            customerNameFor,
            itemSummary,
            productById,
            validatePositiveWholeNumber,
            mergeFormItem,
            validateText,
            updateCustomerSelectors,
            updateProductSelectors,
            loadInventory,
            loadTransactions,
            loadDashboard,
            ensureFormData,
            confirm,
            window
        } = deps;
        let sales = [];
        let saleFormItems = [];
        // Displays products and quantities in the current sale
        function renderSaleFormItems() {
            const container = $("saleItemList");
            if (!container) return;
            container.innerHTML = saleFormItems.length
                ? saleFormItems
                      .map((item) => {
                          const product = productById(item.productID);
                          return `<div class="item-row">
            <div><strong>${esc(product?.productName || item.productID)}</strong><small>${esc(item.productID)} · Available: ${Number(product?.quantity ?? 0)} ${esc(product?.unit || "units")}</small></div>
            <span><strong>${Number(item.quantity)}</strong> ${esc(product?.unit || "units")}</span>
            <button type="button" class="small-btn ghost dark-ghost" onclick="removeSaleItem('${esc(item.productID)}')">Remove</button>
        </div>`;
                      })
                      .join("")
                : '<div class="empty-state">No products added to this sale yet.</div>';
        }

        // Handles sales records and sale details
        // Loads sales records from the backend
        async function loadSales() {
            try {
                const [saleData] = await Promise.all([
                    api("/api/sales"),
                    ensureFormData({ needCustomers: true })
                ]);
                sales = saleData.sales || [];
                renderSaleFormItems();
                renderSales();
            } catch (error) {
                toast(error.message);
            }
        }

        // Filters and displays sales records
        function renderSales() {
            const search = $("saleSearch").value.trim().toLowerCase();
            const customerID = $("saleCustomerFilter").value;
            const status = $("saleStatusFilter").value;
            const start = $("saleFrom").value;
            const end = $("saleTo").value;
            const rows = sales.filter((sale) => {
                const productText = (sale.items || [])
                    .map((item) => `${item.productName} ${item.productID}`)
                    .join(" ");
                return (
                    (!search ||
                        `${sale.saleID} ${sale.customerName} ${productText} ${sale.notes || ""}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!customerID || sale.customerID === customerID) &&
                    (!status || sale.status === status) &&
                    within(sale.createdAt, start, end)
                );
            });
            $("saleTable").innerHTML = rows.length
                ? rows
                      .map(
                          (sale) =>
                              `<tr><td>${fmtDateTime(sale.createdAt)}</td><td><strong>${esc(sale.saleID)}</strong></td><td>${esc(sale.customerName || customerNameFor(sale.customerID))}</td><td>${badge(sale.status)}</td><td>${itemSummary(sale.items)}</td><td>${esc(sale.createdByName || "—")}</td><td><button class="small-btn secondary" onclick="viewSale('${esc(sale.id || sale.saleID)}')">View Details</button></td></tr>`
                      )
                      .join("")
                : '<tr><td colspan="7"><div class="table-empty">No sales transactions match the current filters.</div></td></tr>';
        }

        ["saleSearch", "saleCustomerFilter", "saleStatusFilter", "saleFrom", "saleTo"].forEach(
            (id) => $(id).addEventListener("input", renderSales)
        );

        $("addSaleItem").addEventListener("click", () => {
            const productID = $("saleProduct").value;
            const quantity = Number($("saleQuantity").value);
            const product = productById(productID);
            if (!product) return toast("Select a product first.");
            try {
                validatePositiveWholeNumber(quantity, "Sale quantity");
            } catch (error) {
                return toast(error.message);
            }
            const existing = saleFormItems.find((item) => item.productID === productID);
            if (quantity + (existing?.quantity || 0) > Number(product.quantity))
                return toast(
                    `Only ${product.quantity} ${product.unit || "units"} of ${product.productName} are currently available.`
                );
            mergeFormItem(saleFormItems, productID, quantity);
            $("saleQuantity").value = "1";
            renderSaleFormItems();
        });

        // Removes a product from the current sale
        window.removeSaleItem = (productID) => {
            saleFormItems = saleFormItems.filter((item) => item.productID !== productID);
            renderSaleFormItems();
        };

        $("saleForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("saleMessage", "");
            if (!saleFormItems.length)
                return setMessage(
                    "saleMessage",
                    "Add at least one product before confirming the sale."
                );
            try {
                const notes = validateText($("saleNotes").value, "Sale notes", 500);
                if (!confirm("Confirm this sale? Inventory will be deducted immediately.")) return;

                const data = await busy(
                    event.submitter,
                    () =>
                        api("/api/sales", {
                            method: "POST",
                            body: JSON.stringify({
                                customerID: $("saleCustomerID").value || null,
                                items: saleFormItems,
                                notes
                            })
                        }),
                    "Recording Sale…"
                );
                event.target.reset();
                saleFormItems = [];
                renderSaleFormItems();
                updateCustomerSelectors();
                updateProductSelectors();
                setMessage(
                    "saleMessage",
                    `Sale ${data.sale.saleID} recorded successfully.`,
                    "success"
                );
                await Promise.all([
                    loadSales(),
                    loadInventory(),
                    loadTransactions(),
                    loadDashboard()
                ]);
                toast("Sale recorded successfully");
            } catch (error) {
                setMessage("saleMessage", error.message);
            }
        });

        // Opens the details of a selected sale
        window.viewSale = (id) => {
            const sale = sales.find((item) => item.id === id || item.saleID === id);
            if (!sale) return;
            const rows = (sale.items || [])
                .map(
                    (item) =>
                        `<tr><td>${esc(item.productName)}</td><td>${esc(item.productID)}</td><td>${Number(item.quantity)}</td></tr>`
                )
                .join("");
            $("modalBody").innerHTML =
                `<h2>Sale Details</h2><div class="detail-grid"><div><span>Sale Reference</span><strong>${esc(sale.saleID)}</strong></div><div><span>Date & Time</span><strong>${fmtDateTime(sale.createdAt)}</strong></div><div><span>Customer</span><strong>${esc(sale.customerName || customerNameFor(sale.customerID))}</strong></div><div><span>Status</span><strong>${esc(sale.status)}</strong></div><div><span>Processed By</span><strong>${esc(sale.createdByName || "—")}</strong></div></div><h3>Products Sold</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th>Product ID</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table></div><h3>Notes</h3><p>${esc(sale.notes || "No notes recorded.")}</p>`;
            $("modal").classList.remove("hidden");
        };

        return Object.freeze({ loadSales, renderSales, renderSaleFormItems });
    }
    global.XTechSalesUi = Object.freeze({ createSalesUi });
})(typeof window !== "undefined" ? window : globalThis);
