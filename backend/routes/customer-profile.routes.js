"use strict";
/** Original customer profile handlers extracted from backend/server.js.
 * Firebase Firestore and Auth are resolved only when the handler executes.
 */
function registerCustomerProfileRoutes(app, deps) {
    const {
        authRequired,
        roles,
        getDb,
        getAuth,
        now,
        serialize,
        normalizePhilippineMobile,
        isValidName,
        isValidOptionalText
    } = deps;
    if (typeof getDb !== "function" || typeof getAuth !== "function")
        throw new TypeError("Customer profile routes require lazy Firebase providers.");
    const db = { collection: (...args) => getDb().collection(...args) };
    const auth = { updateUser: (...args) => getAuth().updateUser(...args) };

    app.get("/api/profile", authRequired, roles("customer"), async (req, res) => {
        try {
            let customerDoc = null;
            if (req.profile.customerID) {
                const snap = await db.collection("customers").doc(req.profile.customerID).get();
                if (snap.exists) customerDoc = snap;
            }
            if (!customerDoc) {
                const snap = await db
                    .collection("customers")
                    .where("userUID", "==", req.user.uid)
                    .limit(1)
                    .get();
                if (!snap.empty) customerDoc = snap.docs[0];
            }
            if (!customerDoc) {
                return res
                    .status(404)
                    .json({ success: false, message: "Customer profile not found." });
            }
            res.json({
                success: true,
                customer: { id: customerDoc.id, ...serialize(customerDoc.data()) }
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: "Failed to load customer profile." });
        }
    });

    app.put("/api/profile", authRequired, roles("customer"), async (req, res) => {
        try {
            const name = String(req.body.name || "").trim();
            const phone = normalizePhilippineMobile(req.body.phone);
            const company = String(req.body.company || "").trim();
            const address = String(req.body.address || "").trim();

            if (!isValidName(name)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid full name using letters, spaces, apostrophes, periods, or hyphens."
                });
            }
            if (phone === null) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid Philippine mobile number such as 09171234567 or +639171234567, or leave it blank."
                });
            }
            if (!isValidOptionalText(company, 120) || !isValidOptionalText(address, 250)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Company must be 120 characters or fewer and address must be 250 characters or fewer."
                });
            }

            let customerRef = req.profile.customerID
                ? db.collection("customers").doc(req.profile.customerID)
                : null;
            if (!customerRef || !(await customerRef.get()).exists) {
                const snap = await db
                    .collection("customers")
                    .where("userUID", "==", req.user.uid)
                    .limit(1)
                    .get();
                if (snap.empty)
                    return res
                        .status(404)
                        .json({ success: false, message: "Customer profile not found." });
                customerRef = snap.docs[0].ref;
            }

            const timestamp = now();
            await Promise.all([
                customerRef.update({
                    name,
                    phone,
                    company,
                    address,
                    updatedAt: timestamp
                }),
                db
                    .collection("users")
                    .doc(req.user.uid)
                    .set({ name, updatedAt: timestamp }, { merge: true }),
                auth.updateUser(req.user.uid, { displayName: name })
            ]);

            res.json({ success: true, message: "Profile updated successfully." });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: "Failed to update profile." });
        }
    });
}
module.exports = { registerCustomerProfileRoutes };
