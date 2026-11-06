const isCloudflareWorker = process.env.CLOUDFLARE_WORKER === "true";
if (!isCloudflareWorker) require("dotenv").config();

const express = require("express");
const { randomUUID } = require("crypto");
const path = require("path");
const dns = require("dns").promises;
const { initFirebase } = require("./firebase");
const {registerEmailOtpRoutes}=require("./routes/email-otp.routes");
const {registerCustomerRegistrationRoutes}=require("./routes/customer-registration.routes");
const {registerAiAssistantRoutes}=require("./routes/ai-assistant.routes");
const { registerCustomerProfileRoutes } = require("./routes/customer-profile.routes");
const { registerUserAccountRoutes } = require("./routes/user-accounts.routes");
const { registerReportDashboardRoutes } = require("./routes/report-dashboard.routes");
const { registerSalesRoutes } = require("./routes/sales.routes");
const { registerPickupRoutes } = require("./routes/pickups.routes");
const { registerCustomerRoutes } = require("./routes/customers.routes");
const { registerInventoryRoutes } = require("./routes/inventory.routes");
const { registerAccountNotificationRoutes } = require("./routes/account-notification.routes");
const { registerSystemRoutes } = require("./routes/system.routes");
const { createAuthMiddleware } = require("./middleware/auth");
const { normalizedEmail, isValidName, isValidEmailAddress, isValidOptionalText, isValidPassword, isValidProductID, isValidProductName, isValidCategory, isValidPositiveWholeNumber } = require("./utils/validators");
const {
    serialize,
    operationalProduct,
    operationalSale
} = require("./utils/serialization");
let db;
let auth;
let Timestamp;
const XTECH_MANUAL = require("./xtechManual");
const {
    createOtpHash,
    emailChallengeId,
    generateOtpCode,
    maskEmail,
    otpExpiryMinutes,
    otpResendSeconds,
    sendOtpEmail,
    verifyOtpHash
} = require("./mailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
if (!isCloudflareWorker) {
    app.use(express.static(path.join(__dirname, "../frontend")));
}

const now = () => Timestamp.now();

// The Cloudflare Firestore adapter requires an explicit string document ID.
// Use UUIDs instead of calling collection.doc(newDocumentId()) without an argument.
function newDocumentId() {
    return randomUUID().replace(/-/g, "");
}
const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

function normalizedRole(role) {
    return role === "owner" ? "admin" : (role || "customer");
}

const emailDomainCache = new Map();

async function resolveDnsJson(domain, type) {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`;
    const response = await fetch(url, {
        headers: { Accept: "application/dns-json" }
    });
    if (!response.ok) throw new Error(`DNS lookup failed with HTTP ${response.status}`);
    return response.json();
}

async function emailDomainCanReceiveMail(value) {
    const email = normalizedEmail(value);
    if (!isValidEmailAddress(email)) return false;
    const domain = email.split("@")[1];
    const cached = emailDomainCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) return cached.valid;

    let valid;
    try {
        if (isCloudflareWorker) {
            const mx = await resolveDnsJson(domain, "MX");
            valid = Array.isArray(mx?.Answer) && mx.Answer.length > 0;

            if (!valid) {
                const addressResult = await resolveDnsJson(domain, "A");
                valid = Array.isArray(addressResult?.Answer) && addressResult.Answer.length > 0;
            }
        } else {
            const mx = await dns.resolveMx(domain);
            valid = Array.isArray(mx) && mx.some(record => record && record.exchange);
        }
    } catch (error) {
        if (!isCloudflareWorker) {
            try {
                const addresses = await dns.resolve(domain);
                valid = Array.isArray(addresses) && addresses.length > 0;
            } catch (dnsError) {
                const definitiveMissingDomain = ["ENOTFOUND", "ENODATA", "ENODOMAIN"].includes(dnsError.code);
                if (definitiveMissingDomain) {
                    valid = false;
                } else {
                    console.warn(`Email-domain DNS check skipped for ${domain}: ${dnsError.code || dnsError.message}`);
                    valid = true;
                }
            }
        } else {
            console.warn(`Email-domain DNS check skipped for ${domain}: ${error?.message || error}`);
            valid = true;
        }
    }

    emailDomainCache.set(domain, { valid, expiresAt: Date.now() + (10 * 60 * 1000) });
    return valid;
}

function normalizePhilippineMobile(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (!/^[+0-9() .-]+$/.test(raw)) return null;

    const compact = raw.replace(/[() .-]/g, "");
    let normalized = null;
    if (/^09\d{9}$/.test(compact)) normalized = `+63${compact.slice(1)}`;
    if (/^\+639\d{9}$/.test(compact)) normalized = compact;
    if (!normalized) return null;

    const subscriber = normalized.replace(/\D/g, "").slice(3); // digits after 639
    if (/^(\d)\1{8}$/.test(subscriber)) return null;
    if (["123456789", "987654321", "000000000"].includes(subscriber)) return null;

    return normalized;
}

function isValidDateYMD(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const date = new Date(`${text}T00:00:00`);
    if (Number.isNaN(date.getTime())) return false;
    return dateYMD(date) === text;
}

function dateYMD(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function datePart(value) {
    if (!value) return "";
    if (value && typeof value.toDate === "function") return dateYMD(value.toDate());
    const stringValue = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) return stringValue;
    const parsed = new Date(stringValue);
    return Number.isNaN(parsed.getTime()) ? "" : dateYMD(parsed);
}

function parseRange(req) {
    const start = String(req.query.start || "").trim();
    const end = String(req.query.end || "").trim();
    const valid = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!valid(start) || !valid(end)) {
        const error = new Error("Report dates must use YYYY-MM-DD format.");
        error.status = 400;
        throw error;
    }
    if (start && end && start > end) {
        const error = new Error("Start date cannot be after end date.");
        error.status = 400;
        throw error;
    }
    return { start, end };
}

function inRange(value, start, end) {
    if (!start && !end) return true;
    const date = datePart(value);
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
}

function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    const totals = new Map();
    for (const item of items) {
        const productID = String(item?.productID || "").trim();
        const quantity = num(item?.quantity);
        if (!productID || !isValidPositiveWholeNumber(quantity)) {
            throw new Error("Every item must have a Product ID and a positive whole-number quantity no greater than 1,000,000.");
        }
        totals.set(productID, (totals.get(productID) || 0) + quantity);
    }
    return Array.from(totals, ([productID, quantity]) => ({ productID, quantity }));
}

const { authRequired, roles } = createAuthMiddleware({
    getAuth: () => auth,
    getDb: () => db,
    normalizedRole
});

const notificationCollectionFor = uid => db.collection("users").doc(uid).collection("notifications");

function queueCustomerNotification(transaction, uid, details) {
    if (!uid) return;
    const ref = notificationCollectionFor(uid).doc(newDocumentId());
    transaction.set(ref, {
        notificationID: ref.id,
        type: String(details.type || "general"),
        title: String(details.title || "XTECH notification"),
        message: String(details.message || ""),
        relatedType: String(details.relatedType || ""),
        relatedId: String(details.relatedId || ""),
        read: false,
        createdAt: details.createdAt || now()
    });
}

/* SYSTEM — see backend/routes/system.routes.js */
registerSystemRoutes(app, { authRequired, roles, getDb: () => db, now });

/* Account profile and customer notification routes (Stage 4.4b) */
registerAccountNotificationRoutes(app, {
    authRequired, roles, serialize, notificationCollectionFor, now
});

/* EMAIL OTP (Stage 4.4f4) */
const issueEmailOtp=registerEmailOtpRoutes(app,{
  getDb:()=>db,getAuth:()=>auth,getTimestamp:()=>Timestamp,now,
  normalizedEmail,isValidEmailAddress,createOtpHash,emailChallengeId,generateOtpCode,
  maskEmail,otpExpiryMinutes,otpResendSeconds,sendOtpEmail,verifyOtpHash
});

/* CUSTOMER REGISTRATION (Stage 4.4f3) */
registerCustomerRegistrationRoutes(app,{
  getDb:()=>db,getAuth:()=>auth,now,newDocumentId,normalizedEmail,normalizePhilippineMobile,
  isValidName,isValidEmailAddress,emailDomainCanReceiveMail,isValidOptionalText,isValidPassword,issueEmailOtp
});

/* CUSTOMER PROFILE (Stage 4.4f2) */
registerCustomerProfileRoutes(app, {
    authRequired, roles, getDb: () => db, getAuth: () => auth,
    now, serialize, normalizePhilippineMobile, isValidName, isValidOptionalText
});

/* ADMIN USER ACCOUNT MANAGEMENT (Stage 4.4f1) */
registerUserAccountRoutes(app, {
    authRequired, roles, getDb: () => db, getAuth: () => auth,
    now, serialize, normalizedRole, normalizedEmail,
    isValidName, isValidEmailAddress, emailDomainCanReceiveMail, isValidPassword
});

/* PRODUCTS / INVENTORY (extracted in Stage 4.4c) */
registerInventoryRoutes(app, {
    authRequired, roles, getDb: () => db, now, num, serialize,
    operationalProduct, newDocumentId, isValidProductID,
    isValidProductName, isValidCategory, isValidOptionalText,
    isValidPositiveWholeNumber
});

/* CUSTOMERS (extracted in Stage 4.4d1) */
registerCustomerRoutes(app, {
    authRequired, roles, getDb: () => db, getAuth: () => auth,
    serialize, operationalSale, normalizedEmail, normalizePhilippineMobile,
    isValidName, isValidEmailAddress, emailDomainCanReceiveMail,
    isValidOptionalText, newDocumentId, now
});

/* PICKUPS (extracted in Stage 4.4d2) */
registerPickupRoutes(app, {
    authRequired, roles, getDb: () => db, serialize, normalizeItems,
    isValidDateYMD, dateYMD, isValidOptionalText, newDocumentId,
    now, num, queueCustomerNotification
});

/* SALES (extracted in Stage 4.4d3) */
registerSalesRoutes(app, {
    authRequired, roles, getDb: () => db, operationalSale, normalizeItems,
    isValidOptionalText, newDocumentId, now, num, queueCustomerNotification
});

/* REPORTS + DASHBOARD (extracted in Stage 4.4e) */
registerReportDashboardRoutes(app, {
    authRequired, roles, getDb: () => db,
    operationalProduct, operationalSale, serialize,
    parseRange, inRange, dateYMD, datePart, num
});

/* HELP ASSISTANT (Stage 4.4g) */
registerAiAssistantRoutes(app,{
  getDb:()=>db,getTimestamp:()=>Timestamp,authRequired,serialize,newDocumentId,XTECH_MANUAL
});

/* FRONTEND FALLBACK */
if (!isCloudflareWorker) {
    app.get("/{*splat}", (req, res) => {
        res.sendFile(path.join(__dirname, "../frontend/index.html"));
    });
}

let serverStarted = false;
let serverStartPromise = null;

async function startServer() {
    if (serverStarted) return;
    if (serverStartPromise) return serverStartPromise;

    serverStartPromise = (async () => {
        const services = await initFirebase();
        db = services.db;
        auth = services.auth;
        Timestamp = services.Timestamp;

        await new Promise((resolve, reject) => {
            const onListening = () => {
                serverStarted = true;
                const publicUrl = String(process.env.APP_URL || "").trim();
                console.log(`XTECH Automation listening on port ${PORT}`);
                if (publicUrl) console.log(`Public URL: ${publicUrl}`);
                else if (!isCloudflareWorker) console.log(`Local URL: http://localhost:${PORT}`);
                resolve();
            };

            // Cloudflare Workers' Node HTTP integration supports app.listen(port)
            // but not the Node host-binding form app.listen(port, "0.0.0.0").
            const server = isCloudflareWorker
                ? app.listen(PORT, onListening)
                : app.listen(PORT, "0.0.0.0", onListening);

            server.once("error", reject);
        });
    })();

    return serverStartPromise;
}

if (require.main === module) {
    startServer().catch(error => {
        console.error("XTECH startup failed:", error?.message || error);
        process.exit(1);
    });
}

module.exports = { app, startServer };

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});


