"use strict";

/**
 * Authentication/authorization middleware extracted from XTECH's existing server.
 *
 * getAuth/getDb are lazy because Firebase initializes during startServer().
 * The original status codes, messages and permission checks are preserved.
 * Inject logger to test errors without writing sensitive runtime data to logs.
 */
function createAuthMiddleware({ getAuth, getDb, normalizedRole, logger = console }) {
    if (
        typeof getAuth !== "function" ||
        typeof getDb !== "function" ||
        typeof normalizedRole !== "function"
    ) {
        throw new TypeError(
            "Authentication middleware requires Firebase getters and role normalization."
        );
    }

    async function authRequired(req, res, next) {
        const authorization = req.headers.authorization || "";
        if (!authorization.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }

        const idToken = authorization.substring(7).trim();
        if (!idToken) {
            return res
                .status(401)
                .json({ success: false, message: "Authentication token is missing." });
        }

        try {
            const auth = getAuth();
            const db = getDb();
            const decodedToken = await auth.verifyIdToken(idToken, true);
            req.user = decodedToken;

            const userSnap = await db.collection("users").doc(decodedToken.uid).get();
            req.profile = userSnap.exists
                ? userSnap.data()
                : { role: "customer", email: decodedToken.email || "", active: true };
            req.profile = { ...req.profile, role: normalizedRole(req.profile.role) };

            if (req.profile.active === false) {
                return res
                    .status(403)
                    .json({ success: false, message: "This account has been deactivated." });
            }

            next();
        } catch (error) {
            logger.error("Firebase authentication error:", error.message);
            return res
                .status(401)
                .json({ success: false, message: "Invalid or expired authentication token." });
        }
    }

    function roles(...allowed) {
        return (req, res, next) => {
            if (!allowed.includes(req.profile?.role)) {
                return res.status(403).json({
                    success: false,
                    message: "You do not have permission for this action."
                });
            }
            next();
        };
    }

    return { authRequired, roles };
}

module.exports = { createAuthMiddleware };
