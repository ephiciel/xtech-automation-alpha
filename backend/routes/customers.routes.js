"use strict";

/**
 * Customer CRUD, status and history routes.
 * The original handlers and their authorization checks are preserved.
 * Database and Auth dependencies are accessed only during requests.
 */
function registerCustomerRoutes(app, deps) {
    const {
        authRequired, roles, getDb, getAuth, serialize, operationalSale,
        normalizedEmail, normalizePhilippineMobile, isValidName,
        isValidEmailAddress, emailDomainCanReceiveMail, isValidOptionalText,
        newDocumentId, now
    } = deps;
    if (typeof getDb !== "function" || typeof getAuth !== "function") {
        throw new TypeError("Customer routes require lazy Firebase dependencies.");
    }

    // Preserve the original Firestore and Firebase Auth method receivers.
    // Firebase initializes at server startup, AFTER routes are registered.
    const db = { collection: (...args) => getDb().collection(...args) };
    const auth = { updateUser: (...args) => getAuth().updateUser(...args) };

/* CUSTOMERS */
app.get("/api/customers", authRequired, roles("admin", "secretary"), async (req, res) => {
    try {
        const snap = await db.collection("customers").get();
        const customers = snap.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        res.json({ success: true, customers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to load customers." });
    }
});

app.post("/api/customers", authRequired, roles("admin", "secretary"), async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const email = normalizedEmail(req.body.email);
        const phone = normalizePhilippineMobile(req.body.phone);
        const company = String(req.body.company || "").trim();
        const address = String(req.body.address || "").trim();

        if (!isValidName(name)) return res.status(400).json({ success: false, message: "Enter a valid customer name." });
        if (!isValidEmailAddress(email)) return res.status(400).json({ success: false, message: "Enter a valid email address. Check for extra @ signs, repeated dots, and endings such as .comcom or .com.com." });
        if (!(await emailDomainCanReceiveMail(email))) return res.status(400).json({ success: false, message: "The email domain could not be verified. Check the address for typing mistakes." });
        if (phone === null) return res.status(400).json({ success: false, message: "Enter a valid Philippine mobile number such as 09171234567 or +639171234567, or leave it blank." });
        if (!isValidOptionalText(company, 120) || !isValidOptionalText(address, 250)) {
            return res.status(400).json({ success: false, message: "Company must be 120 characters or fewer and address must be 250 characters or fewer." });
        }

        const duplicate = await db.collection("customers").where("email", "==", email).limit(1).get();
        if (!duplicate.empty) return res.status(409).json({ success: false, message: "A customer with this email already exists." });

        const ref = db.collection("customers").doc(newDocumentId());
        const timestamp = now();
        const customer = {
            customerID: ref.id,
            userUID: null,
            name,
            email,
            phone,
            company,
            address,
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        await ref.set(customer);
        res.status(201).json({ success: true, customer: serialize(customer) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to create customer." });
    }
});

app.put("/api/customers/:id", authRequired, roles("admin", "secretary"), async (req, res) => {
    try {
        const ref = db.collection("customers").doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "Customer not found." });

        const name = String(req.body.name || "").trim();
        const email = normalizedEmail(req.body.email);
        const phone = normalizePhilippineMobile(req.body.phone);
        const company = String(req.body.company || "").trim();
        const address = String(req.body.address || "").trim();

        if (!isValidName(name)) return res.status(400).json({ success: false, message: "Enter a valid customer name." });
        if (!isValidEmailAddress(email)) return res.status(400).json({ success: false, message: "Enter a valid email address. Check for extra @ signs, repeated dots, and endings such as .comcom or .com.com." });
        if (!(await emailDomainCanReceiveMail(email))) return res.status(400).json({ success: false, message: "The email domain could not be verified. Check the address for typing mistakes." });
        if (phone === null) return res.status(400).json({ success: false, message: "Enter a valid Philippine mobile number such as 09171234567 or +639171234567, or leave it blank." });
        if (!isValidOptionalText(company, 120) || !isValidOptionalText(address, 250)) {
            return res.status(400).json({ success: false, message: "Company must be 120 characters or fewer and address must be 250 characters or fewer." });
        }

        const duplicate = await db.collection("customers").where("email", "==", email).get();
        if (duplicate.docs.some(doc => doc.id !== req.params.id)) {
            return res.status(409).json({ success: false, message: "Another customer already uses this email." });
        }

        await ref.update({
            name,
            email,
            phone,
            company,
            address,
            updatedAt: now()
        });

        const userUID = snap.data().userUID;
        if (userUID) {
            await db.collection("users").doc(userUID).set({ name, email, updatedAt: now() }, { merge: true });
            try { await auth.updateUser(userUID, { displayName: name, email }); } catch (error) { console.warn("Auth profile sync warning:", error.message); }
        }

        res.json({ success: true, message: "Customer updated successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to update customer." });
    }
});

app.patch("/api/customers/:id/status", authRequired, roles("admin", "secretary"), async (req, res) => {
    try {
        const active = req.body.active === true;
        const ref = db.collection("customers").doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "Customer not found." });
        const customer = snap.data();
        await ref.update({ active, updatedAt: now() });
        if (customer.userUID) {
            await db.collection("users").doc(customer.userUID).set({ active, updatedAt: now() }, { merge: true });
            try { await auth.updateUser(customer.userUID, { disabled: !active }); } catch (error) { console.warn("Auth status sync warning:", error.message); }
        }
        res.json({ success: true, message: active ? "Customer activated." : "Customer deactivated." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to update customer status." });
    }
});

app.get("/api/customers/:id/history", authRequired, roles("admin", "secretary"), async (req, res) => {
    try {
        const customer = await db.collection("customers").doc(req.params.id).get();
        if (!customer.exists) return res.status(404).json({ success: false, message: "Customer not found." });
        const [pickups, sales] = await Promise.all([
            db.collection("pickups").where("customerID", "==", req.params.id).get(),
            db.collection("sales").where("customerID", "==", req.params.id).get()
        ]);
        const sortNewest = list => list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        res.json({
            success: true,
            customer: { id: customer.id, ...serialize(customer.data()) },
            pickups: sortNewest(pickups.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }))),
            sales: sortNewest(sales.docs.map(doc => ({ id: doc.id, ...operationalSale(doc.data()) })))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to load customer history." });
    }
});
}

module.exports = { registerCustomerRoutes };
