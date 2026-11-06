"use strict";
/** Original email challenge creation and verification handlers. */
function registerEmailOtpRoutes(app,deps) {
  const {getDb,getAuth,getTimestamp,now,normalizedEmail,isValidEmailAddress,
    createOtpHash,emailChallengeId,generateOtpCode,maskEmail,otpExpiryMinutes,otpResendSeconds,sendOtpEmail,verifyOtpHash}=deps;
  const db={collection:(...a)=>getDb().collection(...a),runTransaction:(...a)=>getDb().runTransaction(...a)};
  const auth={getUserByEmail:(...a)=>getAuth().getUserByEmail(...a),getUser:(...a)=>getAuth().getUser(...a),
    updateUser:(...a)=>getAuth().updateUser(...a),createCustomToken:(...a)=>getAuth().createCustomToken(...a)};
  const Timestamp={fromMillis:(ms)=>getTimestamp().fromMillis(ms)};
// Creates and emails a short-lived code for sign-in or registration verification
async function issueEmailOtp(userRecord, email, purpose = "signin") {
    const challengeRef = db.collection("emailOtpChallenges").doc(emailChallengeId(email));
    const existing = await challengeRef.get();
    const currentTime = Date.now();
    const resendSeconds = otpResendSeconds();

    if (existing.exists) {
        const lastSentAt = existing.data().lastSentAt;
        const lastSentMs = lastSentAt?.toMillis ? lastSentAt.toMillis() : 0;
        const secondsSinceLastSend = Math.floor((currentTime - lastSentMs) / 1000);
        if (lastSentMs && secondsSinceLastSend < resendSeconds) {
            const waitSeconds = resendSeconds - secondsSinceLastSend;
            const error = new Error(`Please wait ${waitSeconds} second${waitSeconds === 1 ? "" : "s"} before requesting another code.`);
            error.status = 429;
            error.retryAfterSeconds = waitSeconds;
            throw error;
        }
    }

    const code = generateOtpCode();
    const { salt, hash } = createOtpHash(code);
    const expiryMinutes = otpExpiryMinutes();

    await challengeRef.set({
        uid: userRecord.uid,
        email,
        purpose,
        codeHash: hash,
        salt,
        attemptsRemaining: 5,
        createdAt: now(),
        lastSentAt: now(),
        expiresAt: Timestamp.fromMillis(currentTime + (expiryMinutes * 60 * 1000))
    });

    try {
        await sendOtpEmail(email, code, purpose);
    } catch (error) {
        await challengeRef.delete().catch(() => {});
        throw error;
    }

    return {
        maskedEmail: maskEmail(email),
        expiresInSeconds: expiryMinutes * 60,
        resendAfterSeconds: resendSeconds
    };
}

// Sends a short-lived 6-digit code to an existing XTECH account
app.post("/api/auth/email-otp/request", async (req, res) => {
    const email = normalizedEmail(req.body.email);

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    try {
        const userRecord = await auth.getUserByEmail(email);
        const profileSnap = await db.collection("users").doc(userRecord.uid).get();
        const accountProfile = profileSnap.exists ? profileSnap.data() : null;
        const registrationPending = accountProfile?.registrationPending === true;

        if (!registrationPending && (accountProfile?.active === false || userRecord.disabled)) {
            return res.status(403).json({ success: false, message: "This XTECH account has been deactivated." });
        }

        const purpose = registrationPending ? "registration" : "signin";
        const otp = await issueEmailOtp(userRecord, email, purpose);
        return res.json({
            success: true,
            ...otp,
            registrationPending,
            message: registrationPending
                ? `A 6-digit registration verification code was sent to ${otp.maskedEmail}.`
                : `A 6-digit sign-in code was sent to ${otp.maskedEmail}.`
        });
    } catch (error) {
        if (error.code === "auth/user-not-found") {
            return res.status(404).json({ success: false, message: "No XTECH account was found for this email. Register or ask an administrator to create the account first." });
        }
        if (error.status === 429) {
            return res.status(429).json({ success: false, message: error.message, retryAfterSeconds: error.retryAfterSeconds });
        }
        console.error("Email OTP request error:", error.message);
        return res.status(500).json({ success: false, message: "Could not create or send the email code. Check the SMTP settings and try again." });
    }
});

// Verifies the email code and returns a Firebase custom token for the matching account
app.post("/api/auth/email-otp/verify", async (req, res) => {
    const email = normalizedEmail(req.body.email);
    const code = String(req.body.code || "").trim();

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ success: false, message: "Enter the 6-digit code from your email." });
    }

    const challengeRef = db.collection("emailOtpChallenges").doc(emailChallengeId(email));

    try {
        const verification = await db.runTransaction(async transaction => {
            const challengeSnap = await transaction.get(challengeRef);

            if (!challengeSnap.exists) {
                return { ok: false, status: 400, message: "This email code is no longer available. Request a new code." };
            }

            const challenge = challengeSnap.data();
            const expiryMs = challenge.expiresAt?.toMillis ? challenge.expiresAt.toMillis() : 0;
            const attemptsRemaining = Number(challenge.attemptsRemaining || 0);

            if (!expiryMs || Date.now() > expiryMs) {
                transaction.delete(challengeRef);
                return { ok: false, status: 400, message: "This email code has expired. Request a new code." };
            }

            if (attemptsRemaining <= 0) {
                transaction.delete(challengeRef);
                return { ok: false, status: 429, message: "Too many incorrect attempts. Request a new email code." };
            }

            if (!verifyOtpHash(code, challenge.salt, challenge.codeHash)) {
                const remaining = attemptsRemaining - 1;
                if (remaining <= 0) transaction.delete(challengeRef);
                else transaction.update(challengeRef, { attemptsRemaining: remaining });

                return {
                    ok: false,
                    status: remaining > 0 ? 400 : 429,
                    message: remaining > 0
                        ? `Incorrect email code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
                        : "Too many incorrect attempts. Request a new email code."
                };
            }

            transaction.delete(challengeRef);
            return { ok: true, uid: challenge.uid, purpose: challenge.purpose || "signin" };
        });

        if (!verification.ok) {
            return res.status(verification.status).json({ success: false, message: verification.message });
        }

        const userRecord = await auth.getUser(verification.uid);
        const profileRef = db.collection("users").doc(verification.uid);
        const profileSnap = await profileRef.get();
        const accountProfile = profileSnap.exists ? profileSnap.data() : null;
        const completingRegistration = verification.purpose === "registration" || accountProfile?.registrationPending === true;

        if (completingRegistration) {
            const timestamp = now();
            await auth.updateUser(verification.uid, { emailVerified: true, disabled: false });
            await profileRef.set({ active: true, registrationPending: false, emailVerifiedAt: timestamp, updatedAt: timestamp }, { merge: true });
            if (accountProfile?.customerID) {
                await db.collection("customers").doc(accountProfile.customerID).set({
                    active: true,
                    registrationPending: false,
                    emailVerifiedAt: timestamp,
                    updatedAt: timestamp
                }, { merge: true });
            }
        } else {
            if (accountProfile?.active === false || userRecord.disabled) {
                return res.status(403).json({ success: false, message: "This XTECH account has been deactivated." });
            }
            if (!userRecord.emailVerified) {
                await auth.updateUser(verification.uid, { emailVerified: true });
            }
        }

        const customToken = await auth.createCustomToken(verification.uid, {
            xtechEmailOtp: true,
            registrationVerified: completingRegistration
        });
        return res.json({ success: true, customToken, registrationCompleted: completingRegistration });
    } catch (error) {
        console.error("Email OTP verification error:", error.message);
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Could not verify the email code."
        });
    }
});
  return issueEmailOtp;
}
module.exports={registerEmailOtpRoutes};
