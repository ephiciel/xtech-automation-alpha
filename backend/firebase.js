const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");
const fs = require("fs");

const keyPath = path.join(__dirname, "serviceAccountKey.json");

if (!fs.existsSync(keyPath)) {
    throw new Error(`Firebase service account not found: ${keyPath}`);
}

let serviceAccount;
try {
    serviceAccount = require(keyPath);
} catch (error) {
    throw new Error(`Could not load serviceAccountKey.json: ${error.message}`);
}

if (!serviceAccount.project_id) {
    throw new Error("serviceAccountKey.json is missing project_id.");
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
