const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const files = [
  "backend/server.js",
  "backend/routes/email-otp.routes.js",
  "backend/routes/customer-registration.routes.js",
  "backend/routes/ai-assistant.routes.js",
  "backend/routes/customers.routes.js",
  "backend/routes/pickups.routes.js",
  "backend/routes/sales.routes.js",
  "backend/routes/report-dashboard.routes.js",
  "backend/routes/user-accounts.routes.js",
  "backend/routes/customer-profile.routes.js",
  "backend/routes/inventory.routes.js",
  "backend/routes/account-notification.routes.js",
  "backend/firebase.js",
  "backend/mailer.js",
  "backend/seed-admin.js",
  "scripts/enable-totp.js",
  "scripts/cleanup-v18-data.js",
  "frontend/js/app.js",
  "frontend/js/shared-utils.js",
  "frontend/js/api-client.js",
  "frontend/js/auth-client.js",
  "frontend/js/inventory-ui.js",
  "frontend/js/customer-ui.js",
  "frontend/js/pickup-ui.js",
  "frontend/js/sales-ui.js",
  "frontend/js/dashboard-ui.js",
  "frontend/js/reports-ui.js",
  "frontend/js/staff-ui.js",
  "frontend/js/security-ui.js",
  "frontend/js/profile-ui.js",
  "frontend/js/auth-ui.js",
  "frontend/js/notification-ui.js",
  "frontend/js/ai-assistant-ui.js",
  "frontend/js/app-shell-ui.js",
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

for (const file of ["backend/server.js", "backend/routes/email-otp.routes.js", "backend/routes/customer-registration.routes.js", "backend/routes/ai-assistant.routes.js", "backend/routes/customers.routes.js", "backend/routes/pickups.routes.js", "backend/routes/sales.routes.js", "backend/routes/report-dashboard.routes.js", "backend/routes/user-accounts.routes.js", "backend/routes/customer-profile.routes.js", "backend/routes/inventory.routes.js", "backend/routes/account-notification.routes.js", "backend/firebase.js", "backend/mailer.js", "backend/seed-admin.js", "scripts/enable-totp.js", "scripts/cleanup-v18-data.js", "frontend/js/app.js", "frontend/js/shared-utils.js", "frontend/js/api-client.js", "frontend/js/auth-client.js", "frontend/js/inventory-ui.js", "frontend/js/customer-ui.js", "frontend/js/pickup-ui.js", "frontend/js/sales-ui.js", "frontend/js/dashboard-ui.js", "frontend/js/reports-ui.js", "frontend/js/staff-ui.js", "frontend/js/security-ui.js", "frontend/js/profile-ui.js", "frontend/js/auth-ui.js", "frontend/js/notification-ui.js", "frontend/js/ai-assistant-ui.js", "frontend/js/app-shell-ui.js", "worker/index.mjs"]) {
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
  "frontend/js/customer-ui.js",
  "frontend/js/pickup-ui.js",
  "frontend/js/sales-ui.js",
  "frontend/js/reports-ui.js",
  "frontend/js/staff-ui.js",
  "frontend/js/security-ui.js",
  "frontend/js/profile-ui.js",
  "frontend/js/auth-ui.js",
  "frontend/js/notification-ui.js",
  "frontend/js/ai-assistant-ui.js",
  "frontend/js/app-shell-ui.js",
  "backend/xtechManual.js"
];
const disallowedFinancialUi = /(?:₱|\bprice\b|\bpricing\b|\brevenue\b|total amount|estimated total|unit price)/i;
const financialUiHits = quantityOnlyFiles.filter(file => disallowedFinancialUi.test(fs.readFileSync(path.join(root, file), "utf8")));
if (financialUiHits.length) fail(`quantity-only workflow contains monetary UI text: ${financialUiHits.join(", ")}`);
else pass("quantity-only workflow has no monetary UI text");


const appJs = fs.readFileSync(path.join(root, "frontend/js/app.js"), "utf8");
const sharedUtilsJs = fs.readFileSync(path.join(root, "frontend/js/shared-utils.js"), "utf8");
// Stage 4.41: the browser shell is isolated from session/data ownership.
const appShellJs = fs.readFileSync(path.join(root, "frontend/js/app-shell-ui.js"), "utf8");
const stage441Order = ["notification-ui.js", "ai-assistant-ui.js", "app-shell-ui.js", "app.js"]
  .map(file => html.indexOf('<script src="js/' + file + '"></script>'));
if (stage441Order.every((pos, index) => pos >= 0 && (!index || pos > stage441Order[index - 1])) &&
    /XTechAppShellUi\.createAppShellUi/.test(appJs) &&
    ["showSection", "applyRole", "applyTheme", "initTheme", "closeModal"]
      .every(name => appShellJs.includes("function " + name + "(")) &&
    /setCurrentSectionName/.test(appShellJs) && /getProfile/.test(appShellJs) &&
    /hasDashboardCharts/.test(appShellJs) && /modalClose/.test(appShellJs) &&
    /theme-toggle/.test(appShellJs) &&
    /function showSection\(/.test(appJs) && /function applyRole\(/.test(appJs) &&
    /function closeModal\(/.test(appJs)) {
  pass("app shell extraction retains navigation, role checks, theme and modal wiring");
} else fail("Stage 4.41 app shell integration is incomplete");

if (html.indexOf('<script src="js/shared-utils.js"></script>') < html.indexOf('<script src="js/app.js"></script>') && html.includes('<script src="js/shared-utils.js"></script>')) pass("shared utilities load before app.js");
else fail("frontend helper script load order is incorrect");
const scriptOrder = ["js/shared-utils.js", "js/api-client.js", "js/auth-client.js", "js/app.js"]
  .map(src => html.indexOf('<script src="' + src + '"></script>'));
if (scriptOrder.every((position, index) => position >= 0 && (index === 0 || position > scriptOrder[index - 1])) &&
    /XTechApiClient\.createApiClient/.test(appJs) &&
    /XTechAuthClient\.createFirebaseAuthClient/.test(appJs) &&
    /XTechAuthClient\.createEmailOtpStore/.test(appJs)) pass("frontend API and authentication modules load before app.js");
else fail("frontend API or authentication module integration is incomplete");
const inventoryScript = fs.readFileSync(path.join(root, "frontend/js/inventory-ui.js"), "utf8");
const inventoryScriptIndex = html.indexOf('<script src="js/inventory-ui.js"></script>');
const appScriptIndex = html.indexOf('<script src="js/app.js"></script>');
if (inventoryScriptIndex >= 0 && inventoryScriptIndex < appScriptIndex &&
    /XTechInventoryUi\.createInventoryUi/.test(appJs) &&
    /function loadInventory\(/.test(inventoryScript) &&
    /function renderTransactions\(/.test(inventoryScript) &&
    /window\.archiveProduct/.test(inventoryScript) &&
    /window\.restoreProduct/.test(inventoryScript)) {
  pass("inventory UI extraction keeps product, stock and transaction actions registered");
} else fail("inventory UI module extraction is incomplete");
const customerUiJs = fs.readFileSync(path.join(root, "frontend/js/customer-ui.js"), "utf8");
const pickupUiJs = fs.readFileSync(path.join(root, "frontend/js/pickup-ui.js"), "utf8");
const customerScriptIndex = html.indexOf('<script src="js/customer-ui.js"></script>');
const pickupScriptIndex = html.indexOf('<script src="js/pickup-ui.js"></script>');
if (customerScriptIndex > inventoryScriptIndex && pickupScriptIndex > customerScriptIndex && pickupScriptIndex < appScriptIndex &&
    /XTechCustomerUi\.createCustomerUi/.test(appJs) && /XTechPickupUi\.createPickupUi/.test(appJs) &&
    /function loadCustomers\(/.test(customerUiJs) && /window\.editCustomer/.test(customerUiJs) &&
    /window\.customerHistory/.test(customerUiJs) && /window\.setCustomerStatus/.test(customerUiJs) &&
    /function loadPickups\(/.test(pickupUiJs) && /window\.setPickup/.test(pickupUiJs) &&
    /function refreshPickupInventory\(/.test(pickupUiJs) && /window\.removePickupItem/.test(pickupUiJs)) {
  pass("customer and pickup UI modules retain registration and script ordering");
} else fail("Stage 4.36 customer/pickup UI extraction is incomplete");
const salesUiJs = fs.readFileSync(path.join(root, "frontend/js/sales-ui.js"), "utf8");
const dashboardUiJs = fs.readFileSync(path.join(root, "frontend/js/dashboard-ui.js"), "utf8");
const reportsUiJs = fs.readFileSync(path.join(root, "frontend/js/reports-ui.js"), "utf8");
const stage437Order = ["pickup-ui.js", "sales-ui.js", "dashboard-ui.js", "reports-ui.js", "app.js"]
  .map(file => html.indexOf('<script src="js/' + file + '"></script>'));
if (stage437Order.every((position, index) => position >= 0 && (!index || position > stage437Order[index - 1])) &&
    /XTechSalesUi\.createSalesUi/.test(appJs) && /XTechDashboardUi\.createDashboardUi/.test(appJs) &&
    /XTechReportsUi\.createReportsUi/.test(appJs) &&
    /function loadSales\(/.test(salesUiJs) && /window\.viewSale/.test(salesUiJs) &&
    /function drawCharts\(/.test(dashboardUiJs) && /function loadDashboard\(/.test(dashboardUiJs) &&
    /function reportTableRows\(/.test(reportsUiJs) && /function printCurrentReport\(/.test(reportsUiJs) &&
    /api\/reports\/csv/.test(reportsUiJs)) {
  pass("sales, dashboard, reports module extraction retains UI and script order");
} else fail("Stage 4.37 UI modularization is incomplete");
const stage438Order = ["reports-ui.js", "staff-ui.js", "security-ui.js", "profile-ui.js", "app.js"]
  .map(file => html.indexOf('<script src="js/' + file + '"></script>'));
const staffUiJs = fs.readFileSync(path.join(root, "frontend/js/staff-ui.js"), "utf8");
const securityUiJs = fs.readFileSync(path.join(root, "frontend/js/security-ui.js"), "utf8");
const profileUiJs = fs.readFileSync(path.join(root, "frontend/js/profile-ui.js"), "utf8");
if (stage438Order.every((position, index) => position >= 0 && (!index || position > stage438Order[index - 1])) &&
    /XTechStaffUi\.createStaffUi/.test(appJs) && /XTechSecurityUi\.createSecurityUi/.test(appJs) &&
    /XTechProfileUi\.createProfileUi/.test(appJs) &&
    /function loadUsers\(/.test(staffUiJs) && /window\.setUserStatus/.test(staffUiJs) &&
    /function loadSecurity\(/.test(securityUiJs) && /function resetPasswordChangeMfa\(/.test(securityUiJs) &&
    /sendResetPasswordBtn/.test(securityUiJs) && /changePasswordForm/.test(securityUiJs) &&
    /function loadProfile\(/.test(profileUiJs) && /profileForm/.test(profileUiJs)) {
  pass("staff, security and profile UI extraction retains guarded wiring and load order");
} else fail("Stage 4.38 UI modularization is incomplete");
const authUiJs = fs.readFileSync(path.join(root, "frontend/js/auth-ui.js"), "utf8");
const notificationUiJs = fs.readFileSync(path.join(root, "frontend/js/notification-ui.js"), "utf8");
const stage439Scripts = ["profile-ui.js", "auth-ui.js", "notification-ui.js", "app.js"]
  .map(file => html.indexOf('<script src="js/' + file + '"></script>'));
if (stage439Scripts.every((position, index) => position >= 0 && (!index || position > stage439Scripts[index - 1])) &&
    /XTechAuthUi\.createAuthUi/.test(appJs) && /XTechNotificationUi\.createNotificationUi/.test(appJs) &&
    /function restoreEmailOtpSession\(/.test(authUiJs) && /function beginTotpEnrollment\(/.test(authUiJs) &&
    /\/api\/auth\/register-customer/.test(authUiJs) && /\/api\/auth\/email-otp\/verify/.test(authUiJs) &&
    /function loadNotifications\(/.test(notificationUiJs) && /function startNotificationPolling\(/.test(notificationUiJs) &&
    /function resetNotifications\(/.test(notificationUiJs) && /\/api\/notifications\/read-all/.test(notificationUiJs)) {
  pass("auth and customer notification UI extraction keeps original flows and load order");
} else fail("Stage 4.39 auth/notification UI extraction is incomplete");
const combinedAuthUiSource = appJs + "\n" + authUiJs + "\n" + fs.readFileSync(path.join(root, "frontend/js/security-ui.js"), "utf8");
if (/EMAIL_OTP_SESSION_KEY/.test(combinedAuthUiSource) && /startEmailOtpCountdown/.test(combinedAuthUiSource) && /sendPasswordResetEmail/.test(combinedAuthUiSource)) {
  pass("V19 login recovery and persistent OTP countdown are present");
} else {
  fail("V19 login recovery or persistent OTP countdown is missing");
}

const serverJs = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const extractedAuthAiJs = ["backend/routes/email-otp.routes.js", "backend/routes/customer-registration.routes.js", "backend/routes/ai-assistant.routes.js"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const combinedAuthAiSource = serverJs + "\n" + extractedAuthAiJs;
if (["registerEmailOtpRoutes", "registerCustomerRegistrationRoutes", "registerAiAssistantRoutes"].every(name => serverJs.includes(name)) &&
    extractedAuthAiJs.includes("registrationPending: true") &&
    extractedAuthAiJs.includes("createCustomToken") && extractedAuthAiJs.includes("AI_ROLE_SECTIONS") &&
    extractedAuthAiJs.includes("chatCollectionFor")) pass("email OTP, customer registration and AI assistant routes are modularized");
else fail("combined authentication and AI modularization is incomplete");


// Stage 4.4f2: customer profile retrieval and editing stay customer-only.
const customerProfileRoutesJs = fs.readFileSync(path.join(root, "backend/routes/customer-profile.routes.js"), "utf8");
if (customerProfileRoutesJs.includes('app.get("/api/profile"') &&
    customerProfileRoutesJs.includes('app.put("/api/profile"') &&
    /registerCustomerProfileRoutes\(app/.test(combinedAuthAiSource) &&
    (customerProfileRoutesJs.match(/roles\("customer"\)/g) || []).length === 2 &&
    customerProfileRoutesJs.includes("auth.updateUser") &&
    customerProfileRoutesJs.includes('where("userUID", "==", req.user.uid)')) {
  pass("customer profile routes retain customer-only access and Firebase synchronization");
} else fail("customer profile route extraction incomplete");


// Stage 4.4f1: user account handlers retain their admin-only authorization.
const userAccountRoutesJs = fs.readFileSync(path.join(root, "backend/routes/user-accounts.routes.js"), "utf8");
if (userAccountRoutesJs.includes('app.get("/api/users"') &&
    userAccountRoutesJs.includes('app.post("/api/users"') &&
    userAccountRoutesJs.includes('app.patch("/api/users/:uid/status"') &&
    /registerUserAccountRoutes\(app/.test(combinedAuthAiSource) &&
    (userAccountRoutesJs.match(/roles\("admin"\)/g) || []).length === 3 &&
    userAccountRoutesJs.includes("auth.createUser") &&
    userAccountRoutesJs.includes("auth.updateUser")) {
  pass("admin user account routes retain staff creation and status controls");
} else fail("user-account route extraction incomplete");


// Stage 4.4e: retain reporting, CSV export and dashboard route security.
const reportDashboardJs = fs.readFileSync(path.join(root, "backend/routes/report-dashboard.routes.js"), "utf8");
if (/app\.get\(\s*"\/api\/reports\/summary"/.test(reportDashboardJs) &&
    /app\.get\(\s*"\/api\/reports\/csv\/:type"/.test(reportDashboardJs) &&
    /app\.get\(\s*"\/api\/dashboard"/.test(reportDashboardJs) &&
    /registerReportDashboardRoutes\(app/.test(combinedAuthAiSource) &&
    reportDashboardJs.includes('roles("admin")') &&
    reportDashboardJs.includes('roles("admin", "secretary", "warehouse")') &&
    reportDashboardJs.includes("res.setHeader") &&
    reportDashboardJs.includes("weeklySales")) {
  pass("report and dashboard routes retain access restrictions and CSV exports");
} else fail("report/dashboard extraction incomplete");


// Stage 4.4d3: preserve sales authorization, stock transactions and notifications.
const salesRoutesJs = fs.readFileSync(path.join(root, "backend/routes/sales.routes.js"), "utf8");
if (salesRoutesJs.includes('app.get("/api/sales"') &&
    salesRoutesJs.includes('app.post("/api/sales"') &&
    /registerSalesRoutes\(app/.test(combinedAuthAiSource) &&
    salesRoutesJs.includes('roles("admin", "secretary")') &&
    salesRoutesJs.includes("runTransaction") &&
    salesRoutesJs.includes("SALE_OUT") &&
    salesRoutesJs.includes("purchase_recorded")) {
  pass("sales routes retain stock transaction auditing and purchase notifications");
} else fail("sales route extraction incomplete");


// Stage 4.4d2: pickup route extraction and inventory notification checks.
const pickupRoutesJs = fs.readFileSync(path.join(root, "backend/routes/pickups.routes.js"), "utf8");
const pickupRoutesExpected = ["/api/pickups", "/api/pickups/:id/status"];
if (pickupRoutesExpected.every(p => pickupRoutesJs.includes(p)) &&
    /registerPickupRoutes\(app/.test(combinedAuthAiSource) &&
    pickupRoutesJs.includes('roles("admin", "secretary", "customer")') &&
    pickupRoutesJs.includes("PICKUP_OUT") && pickupRoutesJs.includes("runTransaction")) {
  pass("pickup routes retain permission checks and transactional stock deduction");
} else fail("pickup route extraction incomplete");


// Stage 4.4d1: verify customer route extraction and preserved access guards.
const customerRoutesJs = fs.readFileSync(path.join(root, "backend/routes/customers.routes.js"), "utf8");
const customerPaths = ["/api/customers", "/api/customers/:id",
  "/api/customers/:id/status", "/api/customers/:id/history"];
if (customerPaths.every(p => customerRoutesJs.includes(p)) &&
    /registerCustomerRoutes\(app/.test(combinedAuthAiSource) &&
    customerRoutesJs.includes('roles("admin", "secretary")')) {
  pass("customer routes are modularized with original role permissions");
} else fail("customer route extraction incomplete");

// Stage 4.4c: verify extracted inventory routes remain wired to the API.
const inventoryRoutesJs = fs.readFileSync(path.join(root, "backend/routes/inventory.routes.js"), "utf8");
const requiredInventoryRoutePaths = [
  "/api/products", "/api/products/archived", "/api/products/:productID",
  "/api/products/:productID/archive", "/api/products/:productID/restore",
  "/api/inventory/stock-in", "/api/inventory/stock-out", "/api/inventory/transactions"
];
if (requiredInventoryRoutePaths.every(p => inventoryRoutesJs.includes(p)) &&
    /registerInventoryRoutes\(app/.test(combinedAuthAiSource) && inventoryRoutesJs.includes("db.runTransaction(")) {
  pass("inventory routes are modularized with stock transaction logic retained");
} else fail("inventory route extraction incomplete");

const accountRoutesJs = fs.readFileSync(path.join(root, "backend/routes/account-notification.routes.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (/emailDomainCanReceiveMail/.test(combinedAuthAiSource) && /normalizePhilippineMobile/.test(combinedAuthAiSource) && /registrationPending/.test(combinedAuthAiSource) && /gmail\.comcom/.test(sharedUtilsJs)) {
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

if (/startServer/.test(combinedAuthAiSource) && /CLOUDFLARE_WORKER/.test(combinedAuthAiSource)) {
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

if (/\/api\/notifications/.test(accountRoutesJs) && /registerAccountNotificationRoutes/.test(combinedAuthAiSource) && /purchase_recorded/.test(salesRoutesJs) && /pickup_approved/.test(pickupRoutesJs) && /pickup_completed/.test(pickupRoutesJs) && /loadNotifications/.test(appJs)) {
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

const aiAssistantUiJs = fs.readFileSync(path.join(root, "frontend/js/ai-assistant-ui.js"), "utf8");
const stage440ScriptOrder = ["notification-ui.js", "ai-assistant-ui.js", "app.js"]
  .map(file => html.indexOf('<script src="js/' + file + '"></script>'));
if (stage440ScriptOrder.every((position,index) => position >= 0 && (!index || position > stage440ScriptOrder[index-1])) &&
    /XTechAiAssistantUi\.createAiAssistantUi/.test(appJs) &&
    /getCurrentUser: \(\) => currentUser/.test(appJs) &&
    /getCurrentSectionName: \(\) => currentSectionName/.test(appJs) &&
    /function renderAssistantMarkdown\(/.test(aiAssistantUiJs) &&
    /function loadChatHistory\(/.test(aiAssistantUiJs) &&
    /\/api\/chat\/history/.test(aiAssistantUiJs) &&
    /\/api\/chat/.test(aiAssistantUiJs) &&
    /function resetChatPanel\(/.test(aiAssistantUiJs)) {
  pass("AI Assistant UI extraction preserves chat, history and script ordering");
} else fail("Stage 4.40 AI Assistant UI extraction is incomplete");

if (failures) {
  console.error(`\n${failures} validation check(s) failed.`);
  process.exit(1);
}
console.log("\nAll static project checks passed.");
