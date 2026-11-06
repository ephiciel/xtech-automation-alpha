"use strict";
/**
 * Pickup creation, listing and status transitions.
 * Transactional stock deductions and audit logging are preserved verbatim.
 * Firebase is resolved only when a request runs, not during route setup.
 */
function registerPickupRoutes(app, deps) {
    const { authRequired, roles, getDb, serialize, normalizeItems,
        isValidDateYMD, dateYMD, isValidOptionalText, newDocumentId,
        now, num, queueCustomerNotification } = deps;
    if (typeof getDb !== "function") throw new TypeError("Pickup routes require lazy Firestore access.");
    const db = {
        collection: (...args) => getDb().collection(...args),
        runTransaction: (...args) => getDb().runTransaction(...args)
    };

/* PICKUPS */
app.get("/api/pickups", authRequired, roles("admin", "secretary", "customer"), async (req, res) => {
    try {
        let snap;
        if (req.profile.role === "customer") {
            snap = await db.collection("pickups").where("customerUID", "==", req.user.uid).get();
        } else {
            snap = await db.collection("pickups").get();
        }
        const pickups = snap.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }))
            .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        res.json({ success: true, pickups });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to load pickups." });
    }
});

app.post("/api/pickups", authRequired, roles("admin", "secretary", "customer"), async (req, res) => {
    try {
        const requestedDate = String(req.body.requestedDate || "").trim();
        const notes = String(req.body.notes || "").trim();
        if (!isValidDateYMD(requestedDate) || requestedDate < dateYMD()) {
            return res.status(400).json({ success: false, message: "Pickup date must be a valid date that is today or later." });
        }
        if (!isValidOptionalText(notes, 500)) {
            return res.status(400).json({ success: false, message: "Pickup notes must be 500 characters or fewer." });
        }

        const items = normalizeItems(req.body.items);
        if (!items.length) return res.status(400).json({ success: false, message: "Add at least one product to the pickup request." });

        let customerID = String(req.body.customerID || "").trim() || null;
        let customerData = null;
        let customerUID = null;

        if (req.profile.role === "customer") {
            let customerSnap = null;
            if (req.profile.customerID) {
                const snap = await db.collection("customers").doc(req.profile.customerID).get();
                if (snap.exists) customerSnap = snap;
            }
            if (!customerSnap) {
                const snap = await db.collection("customers").where("userUID", "==", req.user.uid).limit(1).get();
                if (!snap.empty) customerSnap = snap.docs[0];
            }
            if (!customerSnap || customerSnap.data().active === false) {
                return res.status(400).json({ success: false, message: "Your customer profile is unavailable or inactive." });
            }
            customerID = customerSnap.id;
            customerData = customerSnap.data();
            customerUID = req.user.uid;
        } else if (customerID) {
            const snap = await db.collection("customers").doc(customerID).get();
            if (!snap.exists || snap.data().active === false) {
                return res.status(404).json({ success: false, message: "Customer not found or inactive." });
            }
            customerData = snap.data();
            customerUID = customerData.userUID || null;
        }

        // The pickup is written in the same transaction that checks inventory.
        // This makes the admin inventory the authoritative stock source and closes the stale-stock race window.
        const ref = db.collection("pickups").doc(newDocumentId());
        let pickup;
        await db.runTransaction(async transaction => {
            const productRefs = items.map(item => db.collection("products").doc(item.productID));
            const productSnaps = await Promise.all(productRefs.map(productRef => transaction.get(productRef)));
            const timestamp = now();

            const lineItems = items.map((item, index) => {
                const snap = productSnaps[index];
                if (!snap.exists) throw new Error(`Product ${item.productID} is unavailable.`);
                const product = snap.data();
                const available = num(product.quantity);

                if (product.active === false) throw new Error(`${product.productName || item.productID} is unavailable.`);
                if (item.quantity > available) {
                    throw new Error(`Order cannot proceed. ${product.productName} has only ${available} ${product.unit || "units"} available in the admin inventory, but ${item.quantity} were requested.`);
                }

                return {
                    productID: product.productID,
                    productName: product.productName,
                    unit: product.unit || "units",
                    quantity: item.quantity,
                    stockAtRequest: available
                };
            });

            pickup = {
                pickupID: ref.id,
                customerID,
                customerUID,
                customerName: customerData?.name || "Walk-in / No registered customer",
                items: lineItems,
                totalQuantity: lineItems.reduce((sum, item) => sum + item.quantity, 0),
                requestedDate,
                notes,
                status: "Pending",
                createdAt: timestamp,
                updatedAt: timestamp
            };

            transaction.set(ref, pickup);
        });

        res.status(201).json({ success: true, pickup: serialize(pickup) });
    } catch (error) {
        console.error(error);
        res.status(400).json({ success: false, message: error.message || "Failed to create pickup request." });
    }
});

app.patch("/api/pickups/:id/status", authRequired, roles("admin", "secretary", "customer"), async (req, res) => {
    try {
        const status = String(req.body.status || "").trim();
        const ref = db.collection("pickups").doc(req.params.id);
        const initialSnap = await ref.get();
        if (!initialSnap.exists) return res.status(404).json({ success: false, message: "Pickup not found." });
        const initialPickup = initialSnap.data();

        if (req.profile.role === "customer") {
            if (initialPickup.customerUID !== req.user.uid) {
                return res.status(403).json({ success: false, message: "You can only manage your own pickup requests." });
            }
            if (!(initialPickup.status === "Pending" && status === "Cancelled")) {
                return res.status(400).json({ success: false, message: "Customers can only cancel a pending pickup request." });
            }
            await ref.update({ status: "Cancelled", cancelledAt: now(), cancelledBy: req.user.uid, updatedAt: now() });
            return res.json({ success: true, message: "Pickup request cancelled." });
        }

        const transitions = {
            Pending: ["Approved", "Cancelled"],
            Approved: ["Completed", "Cancelled"],
            Completed: [],
            Cancelled: []
        };
        if (!(transitions[initialPickup.status] || []).includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot change pickup from ${initialPickup.status} to ${status}.`
            });
        }

        if (status === "Completed") {
            await db.runTransaction(async transaction => {
                const pickupSnap = await transaction.get(ref);
                if (!pickupSnap.exists) throw new Error("Pickup not found.");
                const pickup = pickupSnap.data();
                if (pickup.status !== "Approved") throw new Error("Only an approved pickup can be completed.");

                const normalized = normalizeItems(pickup.items);
                const productRefs = normalized.map(item => db.collection("products").doc(item.productID));
                const productSnaps = await Promise.all(productRefs.map(productRef => transaction.get(productRef)));
                const timestamp = now();

                normalized.forEach((item, index) => {
                    const productSnap = productSnaps[index];
                    if (!productSnap.exists) throw new Error(`Product ${item.productID} not found.`);
                    const product = productSnap.data();
                    const previous = num(product.quantity);
                    if (product.active === false) throw new Error(`${product.productName} is archived.`);
                    if (item.quantity > previous) throw new Error(`Pickup cannot be completed. ${product.productName} has only ${previous} ${product.unit || "units"} in the admin inventory, but this pickup requires ${item.quantity}.`);
                    const next = previous - item.quantity;
                    transaction.update(productRefs[index], { quantity: next, updatedAt: timestamp });
                    const auditRef = db.collection("inventoryTransactions").doc(newDocumentId());
                    transaction.set(auditRef, {
                        transactionID: auditRef.id,
                        productID: product.productID,
                        productName: product.productName,
                        type: "PICKUP_OUT",
                        quantity: item.quantity,
                        previousQuantity: previous,
                        newQuantity: next,
                        reason: `Pickup ${pickup.pickupID} completed`,
                        performedBy: req.user.name || req.user.email || "System",
                        userId: req.user.uid,
                        source: "PICKUP",
                        referenceID: pickup.pickupID,
                        createdAt: timestamp
                    });
                });

                transaction.update(ref, {
                    status: "Completed",
                    completedAt: timestamp,
                    completedBy: req.user.uid,
                    updatedAt: timestamp
                });


                queueCustomerNotification(transaction, pickup.customerUID, {
                    type: "pickup_completed",
                    title: "Pickup completed",
                    message: "Your pickup has been completed successfully.",
                    relatedType: "pickup",
                    relatedId: pickup.pickupID,
                    createdAt: timestamp
                });
            });
        } else if (status === "Approved") {
            // Recheck the current admin inventory before a request can be approved.
            await db.runTransaction(async transaction => {
                const pickupSnap = await transaction.get(ref);
                if (!pickupSnap.exists) throw new Error("Pickup not found.");
                const pickup = pickupSnap.data();
                if (pickup.status !== "Pending") throw new Error("Only a pending pickup can be approved.");

                const normalized = normalizeItems(pickup.items);
                const productRefs = normalized.map(item => db.collection("products").doc(item.productID));
                const productSnaps = await Promise.all(productRefs.map(productRef => transaction.get(productRef)));
                normalized.forEach((item, index) => {
                    const snap = productSnaps[index];
                    if (!snap.exists) throw new Error(`Product ${item.productID} not found.`);
                    const product = snap.data();
                    const available = num(product.quantity);
                    if (product.active === false) throw new Error(`${product.productName} is archived.`);
                    if (item.quantity > available) {
                        throw new Error(`Pickup cannot be approved. ${product.productName} has only ${available} ${product.unit || "units"} in the admin inventory, but ${item.quantity} were ordered.`);
                    }
                });

                const timestamp = now();
                transaction.update(ref, {
                    status: "Approved",
                    approvedAt: timestamp,
                    approvedBy: req.user.uid,
                    updatedAt: timestamp
                });


                queueCustomerNotification(transaction, pickup.customerUID, {
                    type: "pickup_approved",
                    title: "Pickup approved",
                    message: "Your pickup request has been approved.",
                    relatedType: "pickup",
                    relatedId: pickup.pickupID,
                    createdAt: timestamp
                });
            });
        } else {
            await ref.update({
                status,
                ...(status === "Cancelled" ? { cancelledAt: now(), cancelledBy: req.user.uid } : {}),
                updatedAt: now()
            });
        }
        res.json({ success: true, message: `Pickup marked ${status}.` });
    } catch (error) {
        console.error(error);
        res.status(400).json({ success: false, message: error.message || "Failed to update pickup." });
    }
});
}
module.exports = { registerPickupRoutes };
