const fs = require("fs");
const path = require("path");
const {
    initializeApp: initializeAdminApp,
    cert,
    getApps: getAdminApps
} = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let servicesPromise = null;

function loadServiceAccount() {
    const fromEnv = String(
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        ""
    ).trim();

    let serviceAccount;

    if (fromEnv) {
        try {
            serviceAccount = JSON.parse(fromEnv);
        } catch (error) {
            throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
        }
    } else {
        const isCloudflareWorker = process.env.CLOUDFLARE_WORKER === "true";

        if (isCloudflareWorker) {
            throw new Error(
                "GOOGLE_SERVICE_ACCOUNT_JSON is missing from Cloudflare Worker secrets. Add the full Firebase serviceAccountKey.json contents as a Cloudflare Secret."
            );
        }

        const localKeyPath = path.resolve(process.cwd(), "backend", "serviceAccountKey.json");
        if (!fs.existsSync(localKeyPath)) {
            throw new Error(
                "Firebase service account not found. Add backend/serviceAccountKey.json locally or set GOOGLE_SERVICE_ACCOUNT_JSON."
            );
        }

        try {
            serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, "utf8"));
        } catch (error) {
            throw new Error(`Could not load Firebase service account: ${error.message}`);
        }
    }

    if (!serviceAccount?.project_id) {
        throw new Error("Firebase service account is missing project_id.");
    }

    if (serviceAccount.project_id !== "xtech-automation") {
        throw new Error(
            `Wrong Firebase project. Expected xtech-automation but got ${serviceAccount.project_id}`
        );
    }

    return serviceAccount;
}

async function initFirebase() {
    if (servicesPromise) return servicesPromise;

    servicesPromise = (async () => {
        const serviceAccount = loadServiceAccount();

        let adminApp = getAdminApps()[0];
        if (!adminApp) {
            adminApp = initializeAdminApp({
                credential: cert(serviceAccount),
                projectId: serviceAccount.project_id
            });
        }

        const auth = getAuth(adminApp);

        const cloudflareAppModule = await import("@ljoukov/firebase-admin-cloudflare/app");
        const cloudflareFirestoreModule = await import("@ljoukov/firebase-admin-cloudflare/firestore");

        const firestoreApp = cloudflareAppModule.initializeApp({
            serviceAccountJson: JSON.stringify(serviceAccount)
        });
        const db = cloudflareFirestoreModule.getFirestore(firestoreApp);
        const Timestamp = cloudflareFirestoreModule.Timestamp;
        const FieldValue = cloudflareFirestoreModule.FieldValue;

        return { db, auth, Timestamp, FieldValue };
    })();

    return servicesPromise;
}

module.exports = { initFirebase };
