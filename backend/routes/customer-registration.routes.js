"use strict";
/** Original customer registration, including OTP and compensating rollback. */
function registerCustomerRegistrationRoutes(app,deps) {
  const {getDb,getAuth,now,newDocumentId,normalizedEmail,normalizePhilippineMobile,
    isValidName,isValidEmailAddress,emailDomainCanReceiveMail,isValidOptionalText,isValidPassword,issueEmailOtp}=deps;
  const db={collection:(...a)=>getDb().collection(...a)};
  const auth={getUserByEmail:(...a)=>getAuth().getUserByEmail(...a),createUser:(...a)=>getAuth().createUser(...a),
    deleteUser:(...a)=>getAuth().deleteUser(...a)};
// Creates a pending customer account and requires email OTP verification before activation
app.post("/api/auth/register-customer", async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = normalizedEmail(req.body.email);
    const password = String(req.body.password || "");
    const phone = normalizePhilippineMobile(req.body.phone);
    const company = String(req.body.company || "").trim();
    const address = String(req.body.address || "").trim();

    if (!isValidName(name)) {
        return res.status(400).json({ success: false, message: "Enter a valid full name using letters, spaces, apostrophes, periods, or hyphens." });
    }
    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address. Check for extra @ signs, repeated dots, and endings such as .comcom or .com.com." });
    }
    if (!(await emailDomainCanReceiveMail(email))) {
        return res.status(400).json({ success: false, message: "The email domain could not be verified. Check the address for typing mistakes." });
    }
    if (phone === null) {
        return res.status(400).json({ success: false, message: "Enter a valid Philippine mobile number such as 09171234567 or +639171234567, or leave it blank." });
    }
    if (!isValidOptionalText(company, 120) || !isValidOptionalText(address, 250)) {
        return res.status(400).json({ success: false, message: "Company must be 120 characters or fewer and address must be 250 characters or fewer." });
    }
    if (!isValidPassword(password)) {
        return res.status(400).json({ success: false, message: "Password must be between 6 and 128 characters." });
    }

    let createdUser = null;
    let customerRef = null;
    let linkedExistingCustomer = false;
    let previousCustomerData = null;

    try {
        try {
            const existingUser = await auth.getUserByEmail(email);
            const existingProfile = await db.collection("users").doc(existingUser.uid).get();
            if (existingProfile.exists && existingProfile.data().registrationPending === true) {
                const otp = await issueEmailOtp(existingUser, email, "registration");
                return res.status(200).json({
                    success: true,
                    verificationRequired: true,
                    ...otp,
                    message: "This registration is still waiting for email verification. A new code was sent."
                });
            }
            return res.status(409).json({ success: false, message: "An account with this email already exists." });
        } catch (error) {
            if (error.code !== "auth/user-not-found") throw error;
        }

        createdUser = await auth.createUser({ email, password, displayName: name, disabled: true, emailVerified: false });
        const existingCustomer = await db.collection("customers").where("email", "==", email).limit(1).get();
        const timestamp = now();

        if (!existingCustomer.empty) {
            customerRef = existingCustomer.docs[0].ref;
            previousCustomerData = existingCustomer.docs[0].data();
            linkedExistingCustomer = true;
            await customerRef.update({
                name,
                phone: phone || previousCustomerData.phone || "",
                company: company || previousCustomerData.company || "",
                address: address || previousCustomerData.address || "",
                userUID: createdUser.uid,
                active: false,
                registrationPending: true,
                updatedAt: timestamp
            });
        } else {
            customerRef = db.collection("customers").doc(newDocumentId());
            await customerRef.set({
                customerID: customerRef.id,
                userUID: createdUser.uid,
                name,
                email,
                phone,
                company,
                address,
                active: false,
                registrationPending: true,
                createdAt: timestamp,
                updatedAt: timestamp
            });
        }

        await db.collection("users").doc(createdUser.uid).set({
            uid: createdUser.uid,
            email,
            name,
            role: "customer",
            active: false,
            registrationPending: true,
            customerID: customerRef.id,
            createdAt: timestamp,
            updatedAt: timestamp
        });

        const otp = await issueEmailOtp(createdUser, email, "registration");
        return res.status(201).json({
            success: true,
            verificationRequired: true,
            ...otp,
            message: "Account details saved. Enter the 6-digit code sent to your email to finish registration."
        });
    } catch (error) {
        console.error("Customer registration error:", error.message);
        if (createdUser) {
            try {
                await auth.deleteUser(createdUser.uid);
            } catch (cleanupError) {
                console.error(
                    "Registration cleanup: Failed to delete Firebase Auth user:",
                    cleanupError.code || cleanupError.message
                );
            }

            try {
                await db.collection("users").doc(createdUser.uid).delete();
            } catch (cleanupError) {
                console.error(
                    "Registration cleanup: Failed to delete Firestore user:",
                    cleanupError.code || cleanupError.message
                );
            }
        }
        if (customerRef) {
            try {
                if (linkedExistingCustomer && previousCustomerData) {
                    await customerRef.set(previousCustomerData);
                } else {
                    await customerRef.delete();
                }
            } catch (cleanupError) {
                console.error(
                    "Registration cleanup: Failed to restore customer record:",
                    cleanupError.code || cleanupError.message
                );
            }
        }
        if (error.status === 429) {
            return res.status(429).json({ success: false, message: error.message, retryAfterSeconds: error.retryAfterSeconds });
        }
        return res.status(500).json({ success: false, message: error.message || "Failed to create customer account." });
    }
});
}
module.exports={registerCustomerRegistrationRoutes};
