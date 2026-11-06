"use strict";
/** Original user account endpoints from backend/server.js, unchanged.
 * Firebase Admin/Firestore access is lazy to support Cloudflare Worker startup.
 */
function registerUserAccountRoutes(app, deps) {
    const { authRequired, roles, getDb, getAuth, now, serialize, normalizedRole, normalizedEmail,
        isValidName, isValidEmailAddress, emailDomainCanReceiveMail, isValidPassword } = deps;
    if (typeof getDb !== "function" || typeof getAuth !== "function")
        throw new TypeError("Account routes require lazy Firebase access.");
    const db = { collection: (...args) => getDb().collection(...args) };
    const auth = {
        createUser: (...args) => getAuth().createUser(...args),
        deleteUser: (...args) => getAuth().deleteUser(...args),
        updateUser: (...args) => getAuth().updateUser(...args)
    };

app.get("/api/users", authRequired, roles("admin"), async (req, res) => {
    try {
        const snap = await db.collection("users").get();
        const users = snap.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }))
            .map(user => ({ ...user, role: normalizedRole(user.role) }))
            .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
        res.json({ success: true, users });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to load user accounts." });
    }
});

app.post("/api/users", authRequired, roles("admin"), async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = normalizedEmail(req.body.email);
    const password = String(req.body.password || "");
    const role = normalizedRole(req.body.role);

    if (!isValidName(name)) {
        return res.status(400).json({ success: false, message: "Enter a valid staff name." });
    }
    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address. Check for extra @ signs, repeated dots, and endings such as .comcom or .com.com." });
    }
    if (!(await emailDomainCanReceiveMail(email))) {
        return res.status(400).json({ success: false, message: "The email domain could not be verified. Check the address for typing mistakes." });
    }
    if (!isValidPassword(password)) {
        return res.status(400).json({ success: false, message: "Password must be between 6 and 128 characters." });
    }
    if (!["secretary", "warehouse"].includes(role)) {
        return res.status(400).json({ success: false, message: "Select a valid staff role." });
    }

    let userRecord = null;
    try {
        userRecord = await auth.createUser({ email, password, displayName: name });
        const timestamp = now();
        await db.collection("users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            email,
            name,
            role,
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp
        });
        res.status(201).json({ success: true, message: `${role === "secretary" ? "Secretary" : "Warehouse"} account created.` });
    } catch (error) {
        console.error(error);
        if (userRecord) {
            try {
                await auth.deleteUser(userRecord.uid);
            } catch (cleanupError) {
                console.error(
                    "Staff account cleanup: Failed to delete Firebase Auth user:",
                    cleanupError.code || cleanupError.message
                );
            }
        }
        const message = error.code === "auth/email-already-exists"
            ? "An account with this email already exists."
            : (error.message || "Failed to create user account.");
        res.status(400).json({ success: false, message });
    }
});

app.patch("/api/users/:uid/status", authRequired, roles("admin"), async (req, res) => {
    try {
        if (req.params.uid === req.user.uid) {
            return res.status(400).json({ success: false, message: "You cannot deactivate your own account." });
        }
        const active = req.body.active === true;
        const ref = db.collection("users").doc(req.params.uid);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ success: false, message: "User account not found." });

        const userData = snap.data();
        const updates = [
            ref.update({ active, updatedAt: now() }),
            auth.updateUser(req.params.uid, { disabled: !active })
        ];
        if (normalizedRole(userData.role) === "customer" && userData.customerID) {
            updates.push(
                db.collection("customers").doc(userData.customerID).set(
                    { active, updatedAt: now() },
                    { merge: true }
                )
            );
        }
        await Promise.all(updates);
        res.json({ success: true, message: active ? "Account activated." : "Account deactivated." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to update account status." });
    }
});

}
module.exports = { registerUserAccountRoutes };
