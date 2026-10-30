const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const files = [
  "backend/server.js",
  "backend/firebase.js",
  "backend/mailer.js",
  "backend/seed-admin.js",
  "scripts/enable-totp.js",
  "scripts/cleanup-v18-data.js",
  "frontend/js/app.js",
  "frontend/index.html",
  "frontend/css/style.css",
  "worker/index.mjs",
  "wrangler.jsonc",
  "package.json"
];

let failures = 0;
function fail(message) { console.error(`FAIL: ${message}`); failures++; }
function pass(message) { console.log(`PASS: ${message}`); }

for (const file of files) {
  const full = path.join(root, file);
  fs.existsSync(full) ? pass(`${file} exists`) : fail(`${file} is missing`);
}

for (const file of ["backend/server.js", "backend/firebase.js", "backend/mailer.js", "backend/seed-admin.js", "scripts/enable-totp.js", "scripts/cleanup-v18-data.js", "frontend/js/app.js", "worker/index.mjs"]) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
    pass(`${file} syntax`);
  } catch (error) {
    fail(`${file} syntax: ${error.stderr?.toString() || error.message}`);
  }
}

const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) fail(`duplicate HTML IDs: ${[...new Set(duplicates)].join(", ")}`);
else pass("HTML IDs are unique");

const requiredIds = [
  "loginForm", "registerForm", "passwordTotpMethod", "emailOtpMethod", "forgotPasswordBtn", "emailOtpForm", "emailOtpCooldown", "totpChallengeForm", "totpEnrollForm",
  "productTable", "transactionTable", "customerTable",
  "pickupTable", "saleTable", "userTable", "reportTableBody", "reportRowCount", "exportCurrentCsv", "printReport",
  "security", "securityEmailOtpStatus", "changePasswordForm", "sendResetPasswordBtn", "modal", "toast",
  "notificationCenter", "notificationBell", "notificationBadge", "notificationMenu", "notificationPageList"
];
const missingIds = requiredIds.filter(id => !ids.includes(id));
if (missingIds.length) fail(`required HTML IDs missing: ${missingIds.join(", ")}`);
else pass("required UI elements are present");


const quantityOnlyFiles = [
  "frontend/index.html",
  "frontend/js/app.js",
  "backend/xtechManual.js"
];
const disallowedFinancialUi = /(?:₱|\bprice\b|\bpricing\b|\brevenue\b|total amount|estimated total|unit price)/i;
const financialUiHits = quantityOnlyFiles.filter(file => disallowedFinancialUi.test(fs.readFileSync(path.join(root, file), "utf8")));
if (financialUiHits.length) fail(`quantity-only workflow contains monetary UI text: ${financialUiHits.join(", ")}`);
else pass("quantity-only workflow has no monetary UI text");


const appJs = fs.readFileSync(path.join(root, "frontend/js/app.js"), "utf8");
if (/EMAIL_OTP_SESSION_KEY/.test(appJs) && /startEmailOtpCountdown/.test(appJs) && /sendPasswordResetEmail/.test(appJs)) {
  pass("V19 login recovery and persistent OTP countdown are present");
} else {
  fail("V19 login recovery or persistent OTP countdown is missing");
}

const serverJs = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (/emailDomainCanReceiveMail/.test(serverJs) && /normalizePhilippineMobile/.test(serverJs) && /registrationPending/.test(serverJs) && /gmail\.comcom/.test(appJs)) {
  pass("V20 verified email and Philippine mobile validation are present");
} else {
  fail("V20 contact validation or registration verification is missing");
}
if (packageJson.version === "22.0.0") pass("package version is 22.0.0");
else fail(`package version should be 22.0.0, found ${packageJson.version}`);

const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
if (/serviceAccountKey\.json/.test(gitignore) && /^\.env$/m.test(gitignore)) pass("secret files are ignored by Git");
else fail(".gitignore must include .env and backend/serviceAccountKey.json");

// Cloudflare Workers deployment checks
const firebaseJs = fs.readFileSync(path.join(root, "backend/firebase.js"), "utf8");
const wranglerConfig = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
const workerJs = fs.readFileSync(path.join(root, "worker/index.mjs"), "utf8");

if (/GOOGLE_SERVICE_ACCOUNT_JSON/.test(firebaseJs) && /@ljoukov\/firebase-admin-cloudflare/.test(firebaseJs)) {
  pass("Cloudflare-compatible Firebase service initialization is present");
} else {
  fail("backend/firebase.js must support GOOGLE_SERVICE_ACCOUNT_JSON and Worker-compatible Firestore");
}

if (/startServer/.test(serverJs) && /CLOUDFLARE_WORKER/.test(serverJs)) {
  pass("Express server supports Cloudflare Workers startup");
} else {
  fail("backend/server.js must support Cloudflare Workers startup");
}

if (/(?:httpServerHandler|handleAsNodeRequest)/.test(workerJs) && /xtech-automation/.test(wranglerConfig) && /run_worker_first/.test(wranglerConfig)) {
  pass("Cloudflare Worker entry point and static asset routing are configured");
} else {
  fail("Cloudflare Worker entry point or wrangler static asset routing is missing");
}

if (packageJson.dependencies?.["@ljoukov/firebase-admin-cloudflare"] && packageJson.devDependencies?.wrangler) {
  pass("Cloudflare deployment dependencies are declared");
} else {
  fail("package.json must include Worker-compatible Firestore and Wrangler");
}

if (/\/api\/notifications/.test(serverJs) && /purchase_recorded/.test(serverJs) && /pickup_approved/.test(serverJs) && /pickup_completed/.test(serverJs) && /loadNotifications/.test(appJs)) {
  pass("customer purchase and pickup notifications are configured");
} else {
  fail("customer notification backend or frontend is missing");
}

// V22 Resend HTTPS Email OTP checks
const mailerJs = fs.readFileSync(path.join(root, "backend/mailer.js"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
if (/api\.resend\.com\/emails/.test(mailerJs) && /RESEND_API_KEY/.test(mailerJs)) {
  pass("Resend HTTPS API email delivery is present");
} else {
  fail("backend/mailer.js must use the Resend HTTPS API for Email OTP delivery");
}
if (/RESEND_API_KEY=/.test(envExample) && !/SMTP_HOST=/.test(envExample)) {
  pass(".env.example uses Resend API configuration");
} else {
  fail(".env.example must use RESEND_API_KEY and not require SMTP settings");
}

if (failures) {
  console.error(`\n${failures} validation check(s) failed.`);
  process.exit(1);
}
console.log("\nAll static project checks passed.");
