"use strict";

/**
 * Register original XTECH product and inventory endpoints.
 * No Firebase connection is created when this module is imported.
 * getDb is evaluated per request because Firebase initializes asynchronously.
 */
function registerInventoryRoutes(app, deps) {
    const {
        authRequired, roles, getDb, now, num, serialize, operationalProduct,
        newDocumentId, isValidProductID, isValidProductName,
        isValidCategory, isValidOptionalText, isValidPositiveWholeNumber
    } = deps;

    // Forward Firestore calls lazily, retaining the original db method receiver.
    const db = {
        collection: (...args) => getDb().collection(...args),
        batch: (...args) => getDb().batch(...args),
        runTransaction: (...args) => getDb().runTransaction(...args)
    };

/* PRODUCTS / INVENTORY */
app.get("/api/products", authRequired, async (req, res) => {
    try {
        const snap = await db.collection("products").where("active", "==", true).get();
        const products = snap.docs.map(doc => operationalProduct(doc.data()))
            .sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
        res.json({ success: true, count: products.length, products });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to retrieve products." });
    }
});

app.get("/api/products/archived", authRequired, roles("admin", "warehouse"), async (req, res) => {
    try {
        const snap = await db.collection("products").where("active", "==", false).get();
        res.json({ success: true, products: snap.docs.map(doc => operationalProduct(doc.data())) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to retrieve archived products." });
    }
});

app.get("/api/products/:productID", authRequired, async (req, res) => {
    try {
        const snap = await db.collection("products").doc(req.params.productID).get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "Product not found." });
        res.json({ success: true, product: operationalProduct(snap.data()) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to retrieve product." });
    }
});

app.post("/api/products", authRequired, roles("admin", "warehouse"), async (req, res) => {
    try {
        const productID = String(req.body.productID || "").trim();
        const productName = String(req.body.productName || "").trim();
        const category = String(req.body.category || "").trim();
        const unit = String(req.body.unit || "").trim();
        const quantity = num(req.body.quantity);
        const reorderLevel = num(req.body.reorderLevel);

        if (!isValidProductID(productID)) {
            return res.status(400).json({ success: false, message: "Product ID must be 2 to 40 characters and use only letters, numbers, hyphens, or underscores." });
        }
        if (!isValidProductName(productName)) {
            return res.status(400).json({ success: false, message: "Product name must be between 2 and 100 characters." });
        }
        if (!isValidCategory(category)) {
            return res.status(400).json({ success: false, message: "Select a valid product category." });
        }
        if (!isValidOptionalText(String(req.body.description || ""), 500)) {
            return res.status(400).json({ success: false, message: "Product description must be 500 characters or fewer." });
        }
        if (!Number.isInteger(quantity) || !Number.isInteger(reorderLevel) || quantity < 0 || reorderLevel < 0) {
            return res.status(400).json({ success: false, message: "Stored stock values must be valid non-negative numbers." });
        }

        const ref = db.collection("products").doc(productID);
        if ((await ref.get()).exists) {
            return res.status(409).json({ success: false, message: "A product with this Product ID already exists." });
        }

        const timestamp = now();
        const product = {
            productID,
            productName,
            category,
            unit,
            quantity,
            reorderLevel,
            description: String(req.body.description || "").trim(),
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp,
            archivedAt: null
        };
        const batch = db.batch();
        batch.set(ref, product);
        if (quantity > 0) {
            const auditRef = db.collection("inventoryTransactions").doc(newDocumentId());
            batch.set(auditRef, {
                transactionID: auditRef.id,
                productID,
                productName,
                type: "INITIAL_STOCK",
                quantity,
                previousQuantity: 0,
                newQuantity: quantity,
                reason: "Initial stock when product was created",
                performedBy: req.user.name || req.user.email || "System",
                userId: req.user.uid,
                source: "PRODUCT_CREATE",
                createdAt: timestamp
            });
        }
        await batch.commit();
        res.status(201).json({ success: true, message: "Product created successfully.", product: serialize(product) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to create product." });
    }
});

app.put("/api/products/:productID", authRequired, roles("admin", "warehouse"), async (req, res) => {
    try {
        const ref = db.collection("products").doc(req.params.productID);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "Product not found." });
        const current = snap.data();
        if (current.active === false) return res.status(400).json({ success: false, message: "Archived products cannot be edited." });

        const productName = String(req.body.productName || "").trim();
        const category = String(req.body.category || "").trim();
        const reorderLevel = num(req.body.reorderLevel);
        if (!isValidProductName(productName)) {
            return res.status(400).json({ success: false, message: "Product name must be between 2 and 100 characters." });
        }
        if (!isValidCategory(category)) {
            return res.status(400).json({ success: false, message: "Select a valid product category." });
        }
        if (!isValidOptionalText(String(req.body.description || ""), 500)) {
            return res.status(400).json({ success: false, message: "Product description must be 500 characters or fewer." });
        }
        if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
            return res.status(400).json({ success: false, message: "Stored product values are invalid." });
        }
        if (req.body.quantity !== undefined && num(req.body.quantity) !== num(current.quantity)) {
            return res.status(400).json({ success: false, message: "Use Stock In/Stock Out for quantity changes so the audit trail remains accurate." });
        }

        await ref.update({
            productName,
            category,
            unit: String(req.body.unit || "").trim(),
            reorderLevel,
            description: String(req.body.description || "").trim(),
            updatedAt: now()
        });
        res.json({ success: true, message: "Product updated successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to update product." });
    }
});

app.patch("/api/products/:productID/archive", authRequired, roles("admin", "warehouse"), async (req, res) => {
    try {
        const ref = db.collection("products").doc(req.params.productID);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "Product not found." });
        await ref.update({ active: false, archivedAt: now(), updatedAt: now() });
        res.json({ success: true, message: "Product archived successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to archive product." });
    }
});

app.patch("/api/products/:productID/restore", authRequired, roles("admin", "warehouse"), async (req, res) => {
    try {
        const ref = db.collection("products").doc(req.params.productID);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "Product not found." });
        await ref.update({ active: true, archivedAt: null, updatedAt: now() });
        res.json({ success: true, message: "Product restored successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to restore product." });
    }
});

async function stockChange(req, res, type) {
    try {
        const productID = String(req.body.productID || "").trim();
        const quantity = num(req.body.quantity);
        const reason = String(req.body.reason || "").trim();
        if (!productID) {
            return res.status(400).json({ success: false, message: "Select a product." });
        }
        if (!isValidPositiveWholeNumber(quantity)) {
            return res.status(400).json({ success: false, message: "Quantity must be a positive whole number no greater than 1,000,000." });
        }
        if (reason.length < 2 || !isValidOptionalText(reason, 200)) {
            return res.status(400).json({ success: false, message: "Enter a reason between 2 and 200 characters." });
        }

        const productRef = db.collection("products").doc(productID);
        const auditRef = db.collection("inventoryTransactions").doc(newDocumentId());
        const result = await db.runTransaction(async transaction => {
            const snap = await transaction.get(productRef);
            if (!snap.exists) throw new Error("Product not found.");
            const product = snap.data();
            if (product.active === false) throw new Error("Cannot change stock of an archived product.");
            const previous = num(product.quantity);
            if (type === "STOCK_OUT" && quantity > previous) {
                throw new Error(`Insufficient stock. Available quantity: ${previous}.`);
            }
            const next = type === "STOCK_IN" ? previous + quantity : previous - quantity;
            const timestamp = now();
            transaction.update(productRef, { quantity: next, updatedAt: timestamp });
            transaction.set(auditRef, {
                transactionID: auditRef.id,
                productID: product.productID,
                productName: product.productName,
                type,
                quantity,
                previousQuantity: previous,
                newQuantity: next,
                reason,
                performedBy: req.user.name || req.user.email || "System",
                userId: req.user.uid,
                source: "MANUAL",
                createdAt: timestamp
            });
            return { previous, next };
        });

        res.json({
            success: true,
            message: type === "STOCK_IN" ? "Stock added successfully." : "Stock released successfully.",
            product: { productID, previousQuantity: result.previous, newQuantity: result.next },
            transactionID: auditRef.id
        });
    } catch (error) {
        console.error(error);
        res.status(400).json({ success: false, message: error.message || "Failed to update stock." });
    }
}

app.post("/api/inventory/stock-in", authRequired, roles("admin", "warehouse"), (req, res) => stockChange(req, res, "STOCK_IN"));
app.post("/api/inventory/stock-out", authRequired, roles("admin", "warehouse"), (req, res) => stockChange(req, res, "STOCK_OUT"));

app.get("/api/inventory/transactions", authRequired, roles("admin", "warehouse", "secretary"), async (req, res) => {
    try {
        const snap = await db.collection("inventoryTransactions").orderBy("createdAt", "desc").limit(1000).get();
        res.json({
            success: true,
            transactions: snap.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to load inventory transactions." });
    }
});
}

module.exports = { registerInventoryRoutes };
