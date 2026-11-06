"use strict";

/**
 * Public status/configuration endpoints and admin-only Firebase connectivity check.
 * Extracted from the existing XTECH server without changing response payloads.
 * getDb() is called only when the protected Firebase route is requested,
 * because the Firestore connection is initialized by startServer().
 */
function registerSystemRoutes(app, { authRequired, roles, getDb, now }) {
    if (!app || typeof app.get !== "function" ||
        typeof authRequired !== "function" || typeof roles !== "function" ||
        typeof getDb !== "function" || typeof now !== "function") {
        throw new TypeError("System routes require app, authorization, Firebase and clock dependencies.");
    }

    app.get("/api/status", (req, res) => {
        res.json({ success: true, message: "XTECH Automation server is connected.", timestamp: new Date().toISOString() });
    });
    
    app.get("/api/config", (req, res) => {
        res.json({
            apiKey: process.env.FIREBASE_API_KEY || "",
            authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
            projectId: process.env.FIREBASE_PROJECT_ID || "",
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
            appId: process.env.FIREBASE_APP_ID || "",
            adminEmail: process.env.ADMIN_EMAIL || "",
            adminMfaBypass: process.env.ADMIN_MFA_BYPASS === "true"
        });
    });
    
    app.get("/api/firebase-test", authRequired, roles("admin"), async (req, res) => {
        try {
            await getDb().collection("test").doc("connection").set({
                message: "Firebase connection successful",
                timestamp: now()
            });
            res.json({ success: true, message: "Firebase is connected!" });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: "Firebase connection failed." });
        }
    });
}

module.exports = { registerSystemRoutes };
