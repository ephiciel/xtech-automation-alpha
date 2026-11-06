"use strict";
/** Existing sales routes, preserved verbatim from backend/server.js.
 * Database access is lazy to avoid connecting on Cloudflare route registration.
 */
function registerSalesRoutes(app, deps) {
    const {
        authRequired,
        roles,
        getDb,
        operationalSale,
        normalizeItems,
        isValidOptionalText,
        newDocumentId,
        now,
        num,
        queueCustomerNotification
    } = deps;
    if (typeof getDb !== "function")
        throw new TypeError("Sales routes require lazy Firestore access.");
    const db = {
        collection: (...args) => getDb().collection(...args),
        runTransaction: (...args) => getDb().runTransaction(...args)
    };

    /* SALES */
    app.get("/api/sales", authRequired, roles("admin", "secretary"), async (req, res) => {
        try {
            const snap = await db.collection("sales").get();
            const sales = snap.docs
                .map((doc) => ({ id: doc.id, ...operationalSale(doc.data()) }))
                .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
            res.json({ success: true, sales });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: "Failed to load sales." });
        }
    });

    app.post("/api/sales", authRequired, roles("admin", "secretary"), async (req, res) => {
        try {
            const items = normalizeItems(req.body.items);
            const notes = String(req.body.notes || "").trim();
            if (!items.length)
                return res
                    .status(400)
                    .json({ success: false, message: "Add at least one product to the sale." });
            if (!isValidOptionalText(notes, 500)) {
                return res.status(400).json({
                    success: false,
                    message: "Sale notes must be 500 characters or fewer."
                });
            }

            const customerID = String(req.body.customerID || "").trim() || null;
            let customerData = null;
            if (customerID) {
                const customerSnap = await db.collection("customers").doc(customerID).get();
                if (!customerSnap.exists || customerSnap.data().active === false) {
                    return res
                        .status(404)
                        .json({ success: false, message: "Customer not found or inactive." });
                }
                customerData = customerSnap.data();
            }

            const customerUID = customerData?.userUID || null;
            const saleRef = db.collection("sales").doc(newDocumentId());
            let sale;
            await db.runTransaction(async (transaction) => {
                const productRefs = items.map((item) =>
                    db.collection("products").doc(item.productID)
                );
                const productSnaps = await Promise.all(
                    productRefs.map((ref) => transaction.get(ref))
                );
                const timestamp = now();
                const lineItems = [];

                items.forEach((item, index) => {
                    const productSnap = productSnaps[index];
                    if (!productSnap.exists)
                        throw new Error(`Product ${item.productID} not found.`);
                    const product = productSnap.data();
                    const previous = num(product.quantity);
                    if (product.active === false)
                        throw new Error(`${product.productName} is archived.`);
                    if (item.quantity > previous)
                        throw new Error(
                            `Insufficient stock for ${product.productName}. Available: ${previous}.`
                        );

                    const next = previous - item.quantity;
                    lineItems.push({
                        productID: product.productID,
                        productName: product.productName,
                        quantity: item.quantity
                    });

                    transaction.update(productRefs[index], {
                        quantity: next,
                        updatedAt: timestamp
                    });
                    const auditRef = db.collection("inventoryTransactions").doc(newDocumentId());
                    transaction.set(auditRef, {
                        transactionID: auditRef.id,
                        productID: product.productID,
                        productName: product.productName,
                        type: "SALE_OUT",
                        quantity: item.quantity,
                        previousQuantity: previous,
                        newQuantity: next,
                        reason: `Sale ${saleRef.id} confirmed`,
                        performedBy: req.user.name || req.user.email || "System",
                        userId: req.user.uid,
                        source: "SALE",
                        referenceID: saleRef.id,
                        createdAt: timestamp
                    });
                });

                sale = {
                    saleID: saleRef.id,
                    customerID,
                    customerUID,
                    customerName: customerData?.name || "Walk-in / No registered customer",
                    items: lineItems,
                    notes,
                    status: "Confirmed",
                    createdAt: timestamp,
                    createdBy: req.user.uid,
                    createdByName: req.user.name || req.user.email || "System"
                };
                transaction.set(saleRef, sale);

                queueCustomerNotification(transaction, customerUID, {
                    type: "purchase_recorded",
                    title: "Purchase recorded",
                    message: "Your purchase has been recorded successfully.",
                    relatedType: "sale",
                    relatedId: saleRef.id,
                    createdAt: timestamp
                });
            });

            res.status(201).json({ success: true, sale: operationalSale(sale) });
        } catch (error) {
            console.error(error);
            res.status(400).json({
                success: false,
                message: error.message || "Failed to record sale."
            });
        }
    });
}
module.exports = { registerSalesRoutes };
