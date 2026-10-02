const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");
const fs = require("fs");

// Uses Render's secret file in production and the local key during development.
const localKeyPath = path.join(__dirname, "serviceAccountKey.json");
const renderKeyPath = "/etc/secrets/serviceAccountKey.json";
const configuredKeyPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();

const candidatePaths = [configuredKeyPath, renderKeyPath, localKeyPath].filter(Boolean);
const keyPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

if (!keyPath) {
    throw new Error(
        "Firebase service account not found. Add backend/serviceAccountKey.json locally or serviceAccountKey.json as a Render Secret File."
    );
}

let serviceAccount;
try {
    serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
} catch (error) {
    throw new Error(`Could not load Firebase service account from ${keyPath}: ${error.message}`);
}

if (!serviceAccount.project_id) {
    throw new Error("Firebase service account is missing project_id.");
}

if (serviceAccount.project_id !== "xtech-automation") {
    throw new Error(
        `Wrong Firebase project. Expected xtech-automation but got ${serviceAccount.project_id}`
    );
}

if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const auth = getAuth();

module.exports = { db, auth, Timestamp };
