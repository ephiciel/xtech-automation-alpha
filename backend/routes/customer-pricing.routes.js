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
}

module.exports = { registerCustomerPricingRoutes };
