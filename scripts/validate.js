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
  "package.json"
];

let failures = 0;
function fail(message) { console.error(`FAIL: ${message}`); failures++; }
function pass(message) { console.log(`PASS: ${message}`); }

for (const file of files) {
  const full = path.join(root, file);
  fs.existsSync(full) ? pass(`${file} exists`) : fail(`${file} is missing`);
}

for (const file of ["backend/server.js", "backend/firebase.js", "backend/mailer.js", "backend/seed-admin.js", "scripts/enable-totp.js", "scripts/cleanup-v18-data.js", "frontend/js/app.js"]) {
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
  "loginForm", "registerForm", "passwordTotpMethod", "emailOtpMethod", "emailOtpForm", "totpChallengeForm", "totpEnrollForm",
  "productTable", "transactionTable", "customerTable",
  "pickupTable", "saleTable", "userTable", "reportTableBody", "reportRowCount", "exportCurrentCsv", "printReport",
  "security", "securityEmailOtpStatus", "changePasswordForm", "sendResetPasswordBtn", "modal", "toast"
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

const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
if (/serviceAccountKey\.json/.test(gitignore) && /^\.env$/m.test(gitignore)) pass("secret files are ignored by Git");
else fail(".gitignore must include .env and backend/serviceAccountKey.json");

if (failures) {
  console.error(`\n${failures} validation check(s) failed.`);
  process.exit(1);
}
console.log("\nAll static project checks passed.");
