"use strict";

const { parsePriceCents } = require("../utils/pricing");

function registerCustomerPricingRoutes(app, deps) {
    const { authRequired, roles, getDb, now, newDocumentId } = deps;

    if (typeof getDb !== "function") {
        throw new TypeError("Customer pricing requires Firestore access.");
    }

    const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

    const fail = (res, code, message) => res.status(code).json({ success: false, message });

    app.get("/api/customers/:id/prices", authRequired, roles("admin"), async (req, res) => {
        if (!safeId(req.params.id)) {
            return fail(res, 400, "Invalid customer ID.");
        }

        try {
            const customer = getDb().collection("customers").doc(req.params.id);

            const snap = await customer.get();

            if (!snap.exists) {
                return fail(res, 404, "Customer not found.");
            }

            const priceDocs = await customer.collection("prices").get();

            const prices = priceDocs.docs
                .map((doc) => ({
                    productID: doc.id,
                    ...doc.data()
                }))
                .filter((data) => data.active !== false && Number.isSafeInteger(data.priceCents));

            return res.json({
                success: true,
                customerID: req.params.id,
                prices
            });
        } catch (error) {
            console.error("Customer price list failed:", error);
            return fail(res, 500, "Unable to load customer prices.");
        }
    });

    app.put(
        "/api/customers/:id/prices/:productID",
        authRequired,
        roles("admin"),
        async (req, res) => {
            const { id, productID } = req.params;

            if (!safeId(id) || !safeId(productID)) {
                return fail(res, 400, "Invalid customer or product ID.");
            }

            if (!Object.prototype.hasOwnProperty.call(req.body || {}, "price")) {
                return fail(res, 400, "Provide a price in PHP.");
            }

            let priceCents;

            try {
                priceCents = parsePriceCents(req.body.price);
            } catch (error) {
                return fail(res, 400, error.message);
            }

            try {
                const db = getDb();

                const customer = db.collection("customers").doc(id);
                const product = db.collection("products").doc(productID);
                const customerPrice = customer.collection("prices").doc(productID);

                const result = await db.runTransaction(async (tx) => {
                    const [customerSnap, productSnap, priceSnap] = await Promise.all([
                        tx.get(customer),
                        tx.get(product),
                        tx.get(customerPrice)
                    ]);

                    if (!customerSnap.exists || customerSnap.data().active === false) {
                        return {
                            error: "Customer not found or inactive."
                        };
                    }

                    if (!productSnap.exists || productSnap.data().active === false) {
                        return {
                            error: "Product not found or archived."
                        };
                    }

                    const existing = priceSnap.exists ? priceSnap.data() : null;

                    if (existing?.active !== false && existing?.priceCents === priceCents) {
                        return { changed: false };
                    }

                    const timestamp = now();

                    tx.set(customerPrice, {
                        customerID: id,
                        productID,
                        priceCents,
                        active: true,
                        createdAt: existing?.createdAt || timestamp,
                        updatedAt: timestamp,
                        updatedByUID: req.user.uid
                    });

                    const audit = db.collection("pricingAudit").doc(newDocumentId());

                    tx.set(audit, {
                        type: "CUSTOMER_PRICE_SET",
                        customerID: id,
                        productID,
                        previousPriceCents:
                            existing?.active !== false ? (existing?.priceCents ?? null) : null,
                        newPriceCents: priceCents,
                        performedByUID: req.user.uid,
                        createdAt: timestamp
                    });

                    return { changed: true };
                });

                if (result.error) {
                    return fail(res, 404, result.error);
                }

                return res.json({
                    success: true,
                    customerID: id,
                    productID,
                    priceCents,
                    changed: result.changed
                });
            } catch (error) {
                console.error("Customer price update failed:", error);
                return fail(res, 500, "Unable to save customer price.");
            }
        }
    );

    app.delete(
        "/api/customers/:id/prices/:productID",
        authRequired,
        roles("admin"),
        async (req, res) => {
            const { id, productID } = req.params;

            if (!safeId(id) || !safeId(productID)) {
                return fail(res, 400, "Invalid customer or product ID.");
            }

            try {
                const db = getDb();

                const customer = db.collection("customers").doc(id);
                const customerPrice = customer.collection("prices").doc(productID);

                const result = await db.runTransaction(async (tx) => {
                    const [customerSnap, priceSnap] = await Promise.all([
                        tx.get(customer),
                        tx.get(customerPrice)
                    ]);

                    if (!customerSnap.exists) {
                        return { error: "Customer not found." };
                    }

                    if (!priceSnap.exists || priceSnap.data().active === false) {
                        return { changed: false };
                    }

                    const timestamp = now();
                    const previous = priceSnap.data();

                    tx.set(customerPrice, {
                        ...previous,
                        active: false,
                        updatedAt: timestamp,
                        updatedByUID: req.user.uid
                    });

                    const audit = db.collection("pricingAudit").doc(newDocumentId());

                    tx.set(audit, {
                        type: "CUSTOMER_PRICE_CLEARED",
                        customerID: id,
                        productID,
                        previousPriceCents: previous.priceCents,
                        newPriceCents: null,
                        performedByUID: req.user.uid,
                        createdAt: timestamp
                    });

                    return { changed: true };
                });

                if (result.error) {
                    return fail(res, 404, result.error);
                }

                return res.json({
                    success: true,
                    customerID: id,
                    productID,
                    changed: result.changed
                });
            } catch (error) {
                console.error("Customer price removal failed:", error);
                return fail(res, 500, "Unable to clear customer price.");
            }
        }
    );

    // Public within authenticated customer/staff accounts; no negotiated prices or audits.
    app.get(
        "/api/catalog/products",
        authRequired,
        roles("admin", "secretary", "customer"),
        async (req, res) => {
            try {
                const snap = await getDb().collection("products").where("active", "==", true).get();
                const products = snap.docs
                    .map((doc) => {
                        const p = doc.data();
                        const cents = p.basePriceCents;
                        return {
                            productID: p.productID || doc.id,
                            productName: p.productName || "",
                            category: p.category || "",
                            description: p.description || "",
                            unit: p.unit || "",
                            imageUrl: p.imageUrl || null,
                            quantity:
                                Number.isSafeInteger(p.quantity) && p.quantity > 0 ? p.quantity : 0,
                            sellingPriceCents:
                                Number.isSafeInteger(cents) && cents >= 0 && cents <= 999999999
                                    ? cents
                                    : null
                        };
                    })
                    .sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
                return res.json({
                    success: true,
                    products,
                    count: products.length,
                    currency: "PHP"
                });
            } catch (error) {
                console.error("Catalog product list failed:", error);
                return fail(res, 500, "Unable to load product catalog.");
            }
        }
    );

    // Optimistic concurrency: both staff roles can edit ONLY the standard catalog price.
    app.patch(
        "/api/products/:productID/standard-price",
        authRequired,
        roles("admin", "secretary"),
        async (req, res) => {
            const productID = req.params.productID;
            if (!safeId(productID)) return fail(res, 400, "Invalid product ID.");
            const body = req.body || {};
            if (
                !Object.prototype.hasOwnProperty.call(body, "price") ||
                !Object.prototype.hasOwnProperty.call(body, "expectedPriceCents")
            ) {
                return fail(res, 400, "Price and expected current price are required.");
            }
            const expected = body.expectedPriceCents;
            if (
                expected !== null &&
                (!Number.isSafeInteger(expected) || expected < 0 || expected > 999999999)
            ) {
                return fail(res, 400, "Invalid expected price.");
            }
            let next;
            try {
                next =
                    body.price === null || body.price === "" ? null : parsePriceCents(body.price);
            } catch (error) {
                return fail(res, 400, error.message);
            }
            try {
                const db = getDb();
                const productRef = db.collection("products").doc(productID);
                const result = await db.runTransaction(async (tx) => {
                    const snap = await tx.get(productRef);
                    if (!snap.exists) return { status: 404, error: "Product not found." };
                    const p = snap.data();
                    if (p.active === false)
                        return { status: 400, error: "Archived products cannot be repriced." };
                    const previous = p.basePriceCents ?? null;
                    if (previous !== expected)
                        return {
                            status: 409,
                            error: "Price changed by another user. Refresh before saving."
                        };
                    if (previous === next) return { changed: false };
                    const timestamp = now();
                    const audit = db.collection("pricingAudit").doc(newDocumentId());
                    tx.update(productRef, { basePriceCents: next, updatedAt: timestamp });
                    tx.set(audit, {
                        type:
                            next === null
                                ? "BASE_PRICE_CLEARED"
                                : previous === null
                                  ? "BASE_PRICE_SET"
                                  : "BASE_PRICE_UPDATED",
                        productID,
                        previousPriceCents: previous,
                        newPriceCents: next,
                        performedByUID: req.user.uid,
                        performedByRole: req.profile.role,
                        createdAt: timestamp
                    });
                    return { changed: true };
                });
                if (result.error) return fail(res, result.status, result.error);
                return res.json({
                    success: true,
                    productID,
                    sellingPriceCents: next,
                    changed: result.changed
                });
            } catch (error) {
                console.error("Catalog price update failed:", error);
                return fail(res, 500, "Unable to update catalog price.");
            }
        }
    );
}

module.exports = { registerCustomerPricingRoutes };
