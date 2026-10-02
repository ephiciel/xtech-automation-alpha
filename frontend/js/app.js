// Stores the current user session and data used by the page
let token = "";
let currentUser = null;
let profile = null;
let products = [];
let transactions = [];
let customers = [];
let pickups = [];
let sales = [];
let users = [];
let pickupFormItems = [];
let saleFormItems = [];
let reportCache = null;
let reportCacheQuery = null;
let charts = {};
let pendingRequests = 0;
let currentSectionName = "dashboard";

// Stores Firebase modular authentication helpers and temporary MFA state
let firebaseAppInstance = null;
let firebaseAuthInstance = null;
let firebaseAuthApi = null;
let selectedSignInMethod = "password-totp";
let authFlowInProgress = false;
let pendingMfaResolver = null;
let pendingMfaHint = null;
let pendingTotpSecret = null;
let pendingEmailOtpEmail = "";
let pendingEmailOtpMaskedEmail = "";
let emailOtpResendAvailableAt = 0;
let emailOtpExpiresAt = 0;
let emailOtpCountdownTimer = null;
const EMAIL_OTP_SESSION_KEY = "xtech-email-otp-session";
let pendingPasswordChangeMfaResolver = null;
let pendingPasswordChangeMfaHint = null;

// Finds an element by its ID
const $ = id => document.getElementById(id);

// Makes text safe before adding it to HTML
function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
}


// Formats a value as a readable date and time
function fmtDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
}

// Formats a value as a readable date
function fmtDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString();
}

// Converts a date value to YYYY-MM-DD format
function datePart(value) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// Gets todays date in YYYY-MM-DD format
function todayYMD() {
    return datePart(new Date());
}

// Checks if a date is inside the selected date range
function within(value, start, end) {
    const date = datePart(value);
    if (start && (!date || date < start)) return false;
    if (end && (!date || date > end)) return false;
    return true;
}


// Checks names, emails, phone numbers, text lengths, and numeric fields before sending data
function validationError(message) {
    throw new Error(message);
}

function validateName(value, label = "Name") {
    const text = String(value || "").trim();
    if (text.length < 2 || text.length > 80 || !/[\p{L}]/u.test(text) || !/^[\p{L}\p{M} .'-]+$/u.test(text)) {
        validationError(`${label} must be 2 to 80 characters and use letters, spaces, apostrophes, periods, or hyphens.`);
    }
    return text;
}

function validateEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    if (!email || email.length > 254 || /\s/.test(email)) {
        validationError("Enter a valid email address.");
    }

    const parts = email.split("@");
    if (parts.length !== 2) validationError("Enter a valid email address. Use only one @ symbol.");

    const [local, domain] = parts;
    if (!local || !domain || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
        validationError("Enter a valid email address. Check for missing text or repeated periods.");
    }
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) {
        validationError("Enter a valid email address.");
    }

    const labels = domain.split(".");
    if (labels.length < 2) validationError("Enter a complete email domain such as gmail.com.");

    for (const label of labels) {
        if (!label || label.length > 63 || !/^[a-z0-9-]+$/i.test(label) || label.startsWith("-") || label.endsWith("-")) {
            validationError("Enter a valid email domain.");
        }
    }

    const tld = labels.at(-1).toLowerCase();
    if (!/^[a-z]{2,24}$/i.test(tld)) validationError("Enter a valid email ending.");

    const commonEndings = ["com", "net", "org", "edu", "gov", "mil", "ph", "io", "co"];
    const repeatedEnding = labels.length >= 3 && labels.at(-1).toLowerCase() === labels.at(-2).toLowerCase() && commonEndings.includes(tld);
    const concatenatedEnding = commonEndings.some(ending => tld === ending + ending);
    if (repeatedEnding || concatenatedEnding) {
        validationError("Check the email ending. Addresses such as me.test@gmail.comcom or me.test@gmail.com.com are not accepted.");
    }

    return email;
}

function validatePhone(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (!/^[+0-9() .-]+$/.test(raw)) {
        validationError("Enter a Philippine mobile number using digits and normal phone separators only.");
    }

    const compact = raw.replace(/[() .-]/g, "");
    let normalized = "";
    if (/^09\d{9}$/.test(compact)) normalized = `+63${compact.slice(1)}`;
    else if (/^\+639\d{9}$/.test(compact)) normalized = compact;
    else validationError("Enter a valid Philippine mobile number such as 09171234567 or +639171234567.");

    const subscriber = normalized.replace(/\D/g, "").slice(3);
    if (/^(\d)\1{8}$/.test(subscriber) || ["123456789", "987654321", "000000000"].includes(subscriber)) {
        validationError("Enter a real Philippine mobile number instead of an obvious placeholder number.");
    }

    return normalized;
}

function validateText(value, label, maxLength, required = false) {
    const text = String(value || "").trim();
    if (required && !text) validationError(`${label} is required.`);
    if (text.length > maxLength) validationError(`${label} must be ${maxLength} characters or fewer.`);
    return text;
}

function validatePassword(value) {
    const password = String(value || "");
    if (password.length < 6 || password.length > 128) {
        validationError("Password must be between 6 and 128 characters.");
    }
    return password;
}

// Applies a stronger password rule when an existing user changes their password
function validateNewPassword(value) {
    const password = String(value || "");
    if (password.length < 8 || password.length > 128) {
        validationError("New password must be between 8 and 128 characters.");
    }
    if (!/[A-Z]/.test(password)) validationError("New password must include at least one uppercase letter.");
    if (!/[a-z]/.test(password)) validationError("New password must include at least one lowercase letter.");
    if (!/\d/.test(password)) validationError("New password must include at least one number.");
    return password;
}

function validateProductID(value) {
    const productID = String(value || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(productID)) {
        validationError("Product ID must be 2 to 40 characters and use only letters, numbers, hyphens, or underscores.");
    }
    return productID;
}

function validateProductName(value) {
    const name = String(value || "").trim();
    if (name.length < 2 || name.length > 100) {
        validationError("Product name must be between 2 and 100 characters.");
    }
    return name;
}

function validateCategory(value) {
    const category = String(value || "").trim();
    if (!["Industrial Chemical", "Janitorial Chemical", "Cleaning Supply", "Other"].includes(category)) {
        validationError("Select a valid product category.");
    }
    return category;
}

function validatePositiveWholeNumber(value, label = "Quantity") {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || number > 1000000) {
        validationError(`${label} must be a positive whole number no greater than 1,000,000.`);
    }
    return number;
}

function validateFutureDate(value, label = "Date") {
    const text = String(value || "").trim();
    const date = new Date(`${text}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || datePart(date) !== text || text < todayYMD()) {
        validationError(`${label} must be a valid date that is today or later.`);
    }
    return text;
}

// Shows a temporary notification message
function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}

// Shows an error or success message in a form
function setMessage(id, message, kind = "error") {
    const element = $(id);
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("success", kind === "success");
}

// Shows or hides the loading overlay
function updateLoading() {
    $("loadingOverlay")?.classList.toggle("hidden", pendingRequests <= 0);
}

// Sends an authenticated request to the backend API
async function api(url, opts = {}) {
    const silent = opts.silent === true;
    delete opts.silent;
    opts.headers = opts.headers || {};
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (opts.body && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";

    if (!silent) {
        pendingRequests++;
        updateLoading();
    }

    try {
        const response = await fetch(url, opts);
        let data = {};
        try { data = await response.json(); } catch {}
        if (!response.ok) {
            const error = new Error(data.message || `Request failed (${response.status})`);
            error.status = response.status;
            Object.assign(error, data);
            throw error;
        }
        return data;
    } finally {
        if (!silent) {
            pendingRequests = Math.max(0, pendingRequests - 1);
            updateLoading();
        }
    }
}

// Disables a button while an action is running
async function busy(button, work, workingText = "Please wait…") {
    if (!button) return work();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = workingText;
    try { return await work(); }
    finally {
        button.disabled = false;
        button.textContent = original;
    }
}

// Creates a colored status badge
function badge(status) {
    const className = String(status || "").toLowerCase().replace(/\s+/g, "-");
    return `<span class="badge ${className}">${esc(status || "Unknown")}</span>`;
}

// Calculates the stock status of a product
function stockStatus(product) {
    const quantity = Number(product.quantity || 0);
    const reorder = Number(product.reorderLevel || 0);
    if (quantity <= 0) return "Out of Stock";
    if (quantity <= reorder) return "Low Stock";
    return "In Stock";
}

// Converts stock movement codes into readable names
function movementTypeLabel(type) {
    return ({
        STOCK_IN: "Stock In (Added)",
        STOCK_OUT: "Stock Out (Released)",
        PICKUP_OUT: "Pickup Completion",
        SALE_OUT: "Sale Confirmation",
        INITIAL_STOCK: "Initial Stock"
    })[type] || String(type || "Movement").replaceAll("_", " ");
}

// Converts role codes into names shown to users
function roleDisplayName(role) {
    return ({ admin: "Admin", owner: "Admin", secretary: "Secretary", warehouse: "Warehouse", customer: "Customer" })[role] || "User";
}

// Finds a customer's name from their ID
function customerNameFor(id, fallback = "Walk-in / No registered customer") {
    if (!id) return fallback;
    const customer = customers.find(item => item.id === id || item.customerID === id);
    return customer?.name || fallback;
}

// Finds a product from its product ID
function productById(id) {
    return products.find(product => product.productID === id);
}

// Builds product choices for dropdown menus
function productOptions(includeOutOfStock = false) {
    if (!products.length) return '<option value="">No active products available</option>';
    return '<option value="">Select a product</option>' + products.map(product => {
        const disabled = !includeOutOfStock && Number(product.quantity) <= 0 ? "disabled" : "";
        return `<option value="${esc(product.productID)}" ${disabled}>${esc(product.productName)} (${esc(product.productID)}) — ${product.quantity} ${esc(product.unit || "units")} available</option>`;
    }).join("");
}

// Updates every product dropdown with current inventory data
function updateProductSelectors() {
    ["pickupProduct", "saleProduct"].forEach(id => {
        const select = $(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = productOptions(false);
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });

    if ($("pickupProduct")) syncPickupQuantityLimit();

    const filter = $("transactionProduct");
    if (filter) {
        const previous = filter.value;
        filter.innerHTML = '<option value="">All Products</option>' + products.map(product =>
            `<option value="${esc(product.productID)}">${esc(product.productName)} (${esc(product.productID)})</option>`
        ).join("");
        if ([...filter.options].some(option => option.value === previous)) filter.value = previous;
    }
}

// Builds customer choices for dropdown menus
function customerOptions(includeWalkIn = true) {
    const active = customers.filter(customer => customer.active !== false);
    return (includeWalkIn ? '<option value="">Walk-in / No registered customer</option>' : '<option value="">All Customers</option>') +
        active.map(customer => `<option value="${esc(customer.id || customer.customerID)}">${esc(customer.name)}${customer.company ? ` — ${esc(customer.company)}` : ""}</option>`).join("");
}

// Updates every customer dropdown with current customer data
function updateCustomerSelectors() {
    ["pickupCustomerID", "saleCustomerID"].forEach(id => {
        const select = $(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = customerOptions(true);
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });
    const saleFilter = $("saleCustomerFilter");
    if (saleFilter) {
        const previous = saleFilter.value;
        saleFilter.innerHTML = customerOptions(false);
        if ([...saleFilter.options].some(option => option.value === previous)) saleFilter.value = previous;
    }
}

// Loads the product and customer data needed by forms
async function ensureFormData({ needCustomers = true } = {}) {
    const requests = [api("/api/products", { silent: true }).then(data => { products = data.products || []; updateProductSelectors(); })];
    if (needCustomers && profile?.role !== "customer") {
        requests.push(api("/api/customers", { silent: true }).then(data => { customers = data.customers || []; updateCustomerSelectors(); }));
    }
    await Promise.all(requests);
}

// Adds a product to a form list or increases its quantity
function mergeFormItem(list, productID, quantity) {
    const existing = list.find(item => item.productID === productID);
    if (existing) existing.quantity += quantity;
    else list.push({ productID, quantity });
}

// Displays the products added to a pickup request
function renderPickupFormItems() {
    const container = $("pickupItemList");
    if (!container) return;
    container.innerHTML = pickupFormItems.length ? pickupFormItems.map(item => {
        const product = productById(item.productID);
        return `<div class="item-row">
            <div><strong>${esc(product?.productName || item.productID)}</strong><small>${esc(item.productID)} · Available: ${Number(product?.quantity ?? 0)} ${esc(product?.unit || "units")}</small></div>
            <span>Requested: <strong>${item.quantity}</strong></span>
            <button type="button" class="small-btn ghost dark-ghost" onclick="removePickupItem('${esc(item.productID)}')">Remove</button>
        </div>`;
    }).join("") : '<div class="empty-state">No products added to this pickup request yet.</div>';
}

// Keeps pickup quantities synchronized with the same inventory values shown to admin users.
function syncPickupQuantityLimit() {
    const select = $("pickupProduct");
    const input = $("pickupQuantity");
    const hint = $("pickupStockHint");
    if (!select || !input) return;

    const product = productById(select.value);
    if (!product) {
        input.max = "1";
        input.value = "1";
        input.disabled = true;
        if ($("addPickupItem")) $("addPickupItem").disabled = true;
        if (hint) hint.textContent = "Select a product to view the current admin inventory quantity.";
        return;
    }

    const alreadyAdded = pickupFormItems.find(item => item.productID === product.productID)?.quantity || 0;
    const adminStock = Math.max(0, Number(product.quantity || 0));
    const remaining = Math.max(0, adminStock - alreadyAdded);

    input.max = String(Math.max(1, remaining));
    input.disabled = remaining <= 0;
    if ($("addPickupItem")) $("addPickupItem").disabled = remaining <= 0;
    if (Number(input.value) > remaining || Number(input.value) < 1) input.value = remaining > 0 ? "1" : "";

    if (hint) {
        hint.textContent = remaining > 0
            ? `Admin inventory: ${adminStock} ${product.unit || "units"}. ${alreadyAdded} already added to this request; ${remaining} can still be added.`
            : `Admin inventory: ${adminStock} ${product.unit || "units"}. No more can be added to this request.`;
    }
}

// Reloads the authoritative product stock used by the admin account.
async function refreshPickupInventory() {
    const data = await api("/api/products", { silent: true });
    products = data.products || [];
    updateProductSelectors();
    renderPickupFormItems();
    syncPickupQuantityLimit();
}

// Displays products and quantities in the current sale
function renderSaleFormItems() {
    const container = $("saleItemList");
    if (!container) return;
    container.innerHTML = saleFormItems.length ? saleFormItems.map(item => {
        const product = productById(item.productID);
        return `<div class="item-row">
            <div><strong>${esc(product?.productName || item.productID)}</strong><small>${esc(item.productID)} · Available: ${Number(product?.quantity ?? 0)} ${esc(product?.unit || "units")}</small></div>
            <span><strong>${Number(item.quantity)}</strong> ${esc(product?.unit || "units")}</span>
            <button type="button" class="small-btn ghost dark-ghost" onclick="removeSaleItem('${esc(item.productID)}')">Remove</button>
        </div>`;
    }).join("") : '<div class="empty-state">No products added to this sale yet.</div>';
}

// Changes the visible page section and loads its data
function showSection(name) {
    const nav = document.querySelector(`.nav[data-section="${name}"]`);
    if (nav && nav.style.display === "none") return;
    document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === name));
    document.querySelectorAll(".nav").forEach(item => item.classList.toggle("active", item.dataset.section === name));

    currentSectionName = name;
    updateAiContextLabel();
    renderAiQuickActions();

    if (name === "dashboard") loadDashboard();
    if (name === "inventory") loadInventory();
    if (name === "transactions") loadTransactions();
    if (name === "customers") loadCustomers();
    if (name === "pickups") loadPickups();
    if (name === "sales") loadSales();
    if (name === "users") loadUsers();
    if (name === "reports") loadReports();
    if (name === "profile") loadProfile();
    if (name === "security") loadSecurity();
}

// Shows only the pages and controls allowed for the current role
function applyRole() {
    const role = profile?.role === "owner" ? "admin" : (profile?.role || "customer");
    profile.role = role;
    const allowedSections = {
        admin: ["dashboard", "inventory", "transactions", "customers", "pickups", "sales", "users", "reports", "security"],
        secretary: ["dashboard", "transactions", "customers", "pickups", "sales", "security"],
        warehouse: ["dashboard", "inventory", "transactions", "security"],
        customer: ["pickups", "profile", "security"]
    };
    const allowed = new Set(allowedSections[role] || []);
    document.querySelectorAll(".nav").forEach(nav => nav.style.display = allowed.has(nav.dataset.section) ? "" : "none");
    document.querySelectorAll(".admin-only, .admin-only-section").forEach(element => element.style.display = role === "admin" ? "" : "none");
    document.querySelectorAll(".customer-only, .customer-only-section").forEach(element => element.style.display = role === "customer" ? "" : "none");

    if ($("pickupCustomerField")) $("pickupCustomerField").style.display = role === "customer" ? "none" : "";
    if ($("pickupCustomerHelp")) {
        $("pickupCustomerHelp").textContent = role === "customer"
            ? "This request will automatically be linked to your customer profile."
            : "Select a registered customer when applicable. Walk-in requests can use “Walk-in / No registered customer”.";
    }
}

// Loads the Firebase modular SDK used by password, TOTP, and custom-token email-code sign in
async function loadFirebaseAuthApi() {
    if (firebaseAuthApi) return firebaseAuthApi;

    const [appModule, authModule] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js")
    ]);

    firebaseAuthApi = { ...appModule, ...authModule };
    return firebaseAuthApi;
}

// Loads the Firebase settings and starts Firebase Authentication
async function initFirebase() {
    const config = await api("/api/config", { silent: true });
    if (!config.apiKey || !config.projectId || !config.appId) {
        throw new Error("Firebase web configuration is missing. Check FIREBASE_API_KEY, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID in .env.");
    }

    const firebaseApi = await loadFirebaseAuthApi();
    if (!firebaseAppInstance) firebaseAppInstance = firebaseApi.initializeApp(config);
    if (!firebaseAuthInstance) firebaseAuthInstance = firebaseApi.getAuth(firebaseAppInstance);
    return firebaseAuthInstance;
}

// Stores the email OTP screen state so a page refresh does not reset the resend countdown
function saveEmailOtpSession() {
    if (!pendingEmailOtpEmail || !emailOtpExpiresAt) return;
    try {
        sessionStorage.setItem(EMAIL_OTP_SESSION_KEY, JSON.stringify({
            email: pendingEmailOtpEmail,
            maskedEmail: pendingEmailOtpMaskedEmail,
            resendAvailableAt: emailOtpResendAvailableAt,
            expiresAt: emailOtpExpiresAt
        }));
    } catch (error) {
        // The backend still enforces the cooldown if browser storage is unavailable.
    }
}

// Stops the live resend timer
function stopEmailOtpCountdown() {
    if (emailOtpCountdownTimer) {
        clearInterval(emailOtpCountdownTimer);
        emailOtpCountdownTimer = null;
    }
}

// Removes the locally saved email OTP sign-in state
function clearEmailOtpSession() {
    stopEmailOtpCountdown();
    pendingEmailOtpEmail = "";
    pendingEmailOtpMaskedEmail = "";
    emailOtpResendAvailableAt = 0;
    emailOtpExpiresAt = 0;
    try {
        sessionStorage.removeItem(EMAIL_OTP_SESSION_KEY);
    } catch (error) {
        // Ignores storage errors when session storage is unavailable.
    }

    if ($("resendEmailOtp")) {
        $("resendEmailOtp").disabled = false;
        $("resendEmailOtp").textContent = "Resend Code";
    }
    if ($("emailOtpCooldown")) $("emailOtpCooldown").textContent = "";
}

// Updates the resend button and countdown once per second
function updateEmailOtpCountdown() {
    const button = $("resendEmailOtp");
    const countdown = $("emailOtpCooldown");
    if (!button || !countdown) return;

    const remainingSeconds = Math.max(0, Math.ceil((emailOtpResendAvailableAt - Date.now()) / 1000));
    if (remainingSeconds > 0) {
        button.disabled = true;
        button.textContent = `Resend Code (${remainingSeconds}s)`;
        countdown.textContent = `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before requesting another code.`;
        return;
    }

    button.disabled = false;
    button.textContent = "Resend Code";
    countdown.textContent = "You can request another code now.";
    stopEmailOtpCountdown();
}

// Starts a live resend countdown using an absolute timestamp
function startEmailOtpCountdown() {
    stopEmailOtpCountdown();
    updateEmailOtpCountdown();
    if (emailOtpResendAvailableAt > Date.now()) {
        emailOtpCountdownTimer = setInterval(updateEmailOtpCountdown, 250);
    }
}

// Restores an unfinished email OTP sign-in after the page is refreshed
function restoreEmailOtpSession() {
    let saved = null;
    try {
        saved = JSON.parse(sessionStorage.getItem(EMAIL_OTP_SESSION_KEY) || "null");
    } catch (error) {
        saved = null;
    }

    if (!saved?.email || !saved?.expiresAt || Number(saved.expiresAt) <= Date.now()) {
        clearEmailOtpSession();
        return false;
    }

    pendingEmailOtpEmail = String(saved.email);
    pendingEmailOtpMaskedEmail = String(saved.maskedEmail || saved.email);
    emailOtpResendAvailableAt = Number(saved.resendAvailableAt || 0);
    emailOtpExpiresAt = Number(saved.expiresAt || 0);

    setSignInMethod("email-otp", { preserveOtpSession: true });
    $("emailOtpEmail").value = pendingEmailOtpEmail;
    $("loginForm").classList.add("hidden");
    $("registerForm").classList.add("hidden");
    $("emailOtpForm").classList.remove("hidden");
    $("emailOtpDestination").textContent = `Code sent to ${pendingEmailOtpMaskedEmail}.`;

    const minutesRemaining = Math.max(1, Math.ceil((emailOtpExpiresAt - Date.now()) / 60000));
    setMessage("emailOtpMessage", `Enter the 6-digit code. It expires in about ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`, "success");
    startEmailOtpCountdown();
    return true;
}

// Hides the extra security forms and returns to the selected sign-in method
function resetSecurityForms({ clearOtpSession = false } = {}) {
    pendingMfaResolver = null;
    pendingMfaHint = null;
    pendingTotpSecret = null;
    if (clearOtpSession) clearEmailOtpSession();
    else stopEmailOtpCountdown();
    $("totpChallengeForm").classList.add("hidden");
    $("totpEnrollForm").classList.add("hidden");
    $("emailOtpForm").classList.add("hidden");
    $("loginForm").classList.remove("hidden");
    $("totpChallengeCode").value = "";
    $("totpEnrollCode").value = "";
    $("emailOtpCode").value = "";
    $("totpQr").innerHTML = "";
    $("totpSecretKey").textContent = "—";
    $("emailOtpDestination").textContent = "Enter the 6-digit code sent to your email.";
    setMessage("totpChallengeMessage", "");
    setMessage("totpEnrollMessage", "");
    setMessage("emailOtpMessage", "");
}

// Switches between password plus authenticator and email-code sign in
function setSignInMethod(method, { preserveOtpSession = false } = {}) {
    selectedSignInMethod = method === "email-otp" ? "email-otp" : "password-totp";
    const emailOtp = selectedSignInMethod === "email-otp";

    if (!emailOtp && !preserveOtpSession) clearEmailOtpSession();

    $("passwordTotpFields").classList.toggle("hidden", emailOtp);
    $("emailOtpFields").classList.toggle("hidden", !emailOtp);
    $("passwordTotpMethod").classList.toggle("active", !emailOtp);
    $("emailOtpMethod").classList.toggle("active", emailOtp);
    $("loginSubmit").textContent = emailOtp ? "Send 6-Digit Email Code" : "Continue with Password + Authenticator";
    setMessage("loginMessage", "");
}

// Switches between the login and registration forms
function showAuthMode(mode, { preserveOtpSession = false } = {}) {
    const login = mode === "login";
    resetSecurityForms({ clearOtpSession: !preserveOtpSession });
    $("loginForm").classList.toggle("hidden", !login);
    $("registerForm").classList.toggle("hidden", login);
    $("showLoginBtn").classList.toggle("active", login);
    $("showRegisterBtn").classList.toggle("active", !login);
    setMessage("loginMessage", "");
    setMessage("registerMessage", "");
}

// Applies light or dark mode instantly and saves the choice
function applyTheme(themeName = "light") {
    const darkMode = themeName === "dark";

    // Temporarily disables transitions while the theme changes
    document.body.classList.add("theme-switching");

    document.body.classList.toggle("dark", darkMode);

    document.querySelectorAll(".theme-toggle").forEach(toggle => {
        const label = toggle.querySelector(".theme-label");
        const icon = toggle.querySelector(".theme-icon");
        if (label) label.textContent = darkMode ? "Light mode" : "Dark mode";
        if (icon) icon.textContent = darkMode ? "☀" : "☾";
        toggle.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
    });

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", darkMode ? "#080d18" : "#f5f7fb");

    try {
        localStorage.setItem("xtech-theme", darkMode ? "dark" : "light");
    } catch (error) {
        // Ignores storage errors if the browser blocks local storage.
    }

    // Forces the new theme to render before transitions are enabled again
    void document.body.offsetHeight;

    requestAnimationFrame(() => {
        document.body.classList.remove("theme-switching");
    });

    // Redraws the charts after the theme changes
    if (token && Object.keys(charts).length) loadDashboard();
}

// Loads the saved theme and connects the theme buttons
function initTheme() {
    document.querySelectorAll(".theme-toggle").forEach(toggle => {
        toggle.addEventListener("click", () => {
            const darkMode = !document.body.classList.contains("dark");
            applyTheme(darkMode ? "dark" : "light");
        });
    });

    try {
        const storedTheme = localStorage.getItem("xtech-theme");
        if (storedTheme === "dark" || storedTheme === "light") {
            applyTheme(storedTheme);
            return;
        }
    } catch (error) {
        // Ignores storage errors if the browser blocks local storage.
    }

    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
}

// Opens the main application for an authenticated user
async function finishSignedInUser(user) {
    token = await firebaseAuthApi.getIdToken(user, true);
    const me = await api("/api/auth/me");
    currentUser = user;
    profile = me.profile;
    $("userEmail").textContent = user.email || "";
    $("roleLabel").textContent = `${roleDisplayName(profile.role)} account`;
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    applyRole();
    showSection(profile.role === "customer" ? "pickups" : "dashboard");
}

// Returns the page to the signed-out state
function showSignedOutState() {
    token = "";
    currentUser = null;
    profile = null;
    resetPasswordChangeMfa();
    resetChatPanel();
    $("loginScreen").classList.remove("hidden");
    $("app").classList.add("hidden");
}

// Shows the TOTP challenge when Firebase requires a second factor
function beginTotpChallenge(error) {
    pendingMfaResolver = firebaseAuthApi.getMultiFactorResolver(firebaseAuthInstance, error);
    pendingMfaHint = pendingMfaResolver.hints.find(hint => hint.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID);

    if (!pendingMfaHint) {
        authFlowInProgress = false;
        throw new Error("This account requires a multi-factor method that XTECH does not support.");
    }

    $("loginForm").classList.add("hidden");
    $("registerForm").classList.add("hidden");
    $("totpEnrollForm").classList.add("hidden");
    $("totpChallengeForm").classList.remove("hidden");
    $("totpChallengeCode").focus();
    setMessage("totpChallengeMessage", "Enter the current code from your authenticator app.", "success");
}

// Starts authenticator enrollment for an account that has no TOTP factor yet
async function beginTotpEnrollment(user) {
    if (!user.emailVerified) {
        await firebaseAuthApi.sendEmailVerification(user);
        await firebaseAuthApi.signOut(firebaseAuthInstance);
        authFlowInProgress = false;
        resetSecurityForms();
        setMessage("loginMessage", "Your email must be verified before Authenticator setup. A verification email was sent. Verify it, then sign in again.", "success");
        return;
    }

    const session = await firebaseAuthApi.multiFactor(user).getSession();
    pendingTotpSecret = await firebaseAuthApi.TotpMultiFactorGenerator.generateSecret(session);
    const qrUri = pendingTotpSecret.generateQrCodeUrl(user.email || "XTECH user", "XTECH Automation");

    $("loginForm").classList.add("hidden");
    $("registerForm").classList.add("hidden");
    $("totpChallengeForm").classList.add("hidden");
    $("totpEnrollForm").classList.remove("hidden");
    $("totpSecretKey").textContent = pendingTotpSecret.secretKey;
    $("totpQr").innerHTML = "";

    if (window.QRCode) {
        new window.QRCode($("totpQr"), {
            text: qrUri,
            width: 180,
            height: 180,
            correctLevel: window.QRCode.CorrectLevel.M
        });
    } else {
        $("totpQr").textContent = "QR code library could not load. Use the manual setup key below.";
    }

    $("totpEnrollCode").focus();
    setMessage("totpEnrollMessage", "Scan the QR code with Google Authenticator or another TOTP app, then enter the 6-digit code.", "success");
}

// Starts authentication and loads the app after sign in
async function boot() {
    try {
        const auth = await initFirebase();

        firebaseAuthApi.onAuthStateChanged(auth, async user => {
            if (authFlowInProgress) return;

            if (!user) {
                showSignedOutState();
                return;
            }

            try {
                await finishSignedInUser(user);
            } catch (error) {
                setMessage("loginMessage", error.message);
                await firebaseAuthApi.signOut(auth);
            }
        });

    } catch (error) {
        setMessage("loginMessage", error.message);
    }
}

// Adds the show and hide button to a password field
function setupPasswordToggle(targetId) {
    const input = $(targetId);
    const toggle = document.querySelector(`[data-target="${targetId}"]`);
    if (!input || !toggle) return;

    toggle.addEventListener("click", () => {
        const shouldShow = input.type === "password";
        input.type = shouldShow ? "text" : "password";
        toggle.textContent = shouldShow ? "Hide" : "Show";
        toggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
    });
}

["loginPassword", "registerPassword", "registerPassword2", "userPassword", "currentPassword", "newPassword", "confirmNewPassword"].forEach(setupPasswordToggle);

window.addEventListener("DOMContentLoaded", initTheme);

$("showLoginBtn").addEventListener("click", () => showAuthMode("login"));
$("showRegisterBtn").addEventListener("click", () => showAuthMode("register"));
$("passwordTotpMethod").addEventListener("click", () => setSignInMethod("password-totp"));
$("emailOtpMethod").addEventListener("click", () => setSignInMethod("email-otp"));

// Sends a Firebase password-reset email from the signed-out login screen
$("forgotPasswordBtn").addEventListener("click", async event => {
    setMessage("loginMessage", "");
    try {
        const email = validateEmail($("loginEmail").value);
        const auth = await initFirebase();
        await busy(event.currentTarget, () => firebaseAuthApi.sendPasswordResetEmail(auth, email), "Sending…");
        setMessage("loginMessage", `If an XTECH account exists for ${email}, a password-reset email has been sent.`, "success");
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            setMessage("loginMessage", "If an XTECH account exists for that email, a password-reset email has been sent.", "success");
            return;
        }
        setMessage("loginMessage", error.message || "Could not send the password-reset email.");
    }
});

// Signs in with password plus Authenticator or sends a one-time email code
$("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("loginMessage", "");

    if (selectedSignInMethod === "email-otp") {
        try {
            const email = validateEmail($("emailOtpEmail").value);
            const result = await busy(event.submitter, () => api("/api/auth/email-otp/request", {
                method: "POST",
                body: JSON.stringify({ email }),
                silent: true
            }), "Sending Code…");

            pendingEmailOtpEmail = email;
            pendingEmailOtpMaskedEmail = result.maskedEmail || email;
            emailOtpResendAvailableAt = Date.now() + (Number(result.resendAfterSeconds || 60) * 1000);
            emailOtpExpiresAt = Date.now() + (Number(result.expiresInSeconds || 600) * 1000);
            saveEmailOtpSession();
            $("loginForm").classList.add("hidden");
            $("registerForm").classList.add("hidden");
            $("emailOtpForm").classList.remove("hidden");
            $("emailOtpDestination").textContent = `Code sent to ${pendingEmailOtpMaskedEmail}.`;
            setMessage("emailOtpMessage", `Enter the 6-digit code. It expires in ${Math.ceil(Number(result.expiresInSeconds || 600) / 60)} minutes.`, "success");
            startEmailOtpCountdown();
            $("emailOtpCode").focus();
        } catch (error) {
            setMessage("loginMessage", error.message);
        }
        return;
    }

    authFlowInProgress = true;
    setMessage("loginMessage", "Checking your account…", "success");

    try {
        const email = validateEmail($("loginEmail").value);
        const password = validateText($("loginPassword").value, "Password", 128, true);
        const credential = await busy(event.submitter, () => firebaseAuthApi.signInWithEmailAndPassword(firebaseAuthInstance, email, password), "Signing In…");

        const factors = firebaseAuthApi.multiFactor(credential.user).enrolledFactors;
        const hasTotp = factors.some(factor => factor.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID);

        if (!hasTotp) {
            await beginTotpEnrollment(credential.user);
            return;
        }

        authFlowInProgress = false;
        await finishSignedInUser(credential.user);
    } catch (error) {
        if (error.code === "auth/multi-factor-auth-required") {
            try {
                beginTotpChallenge(error);
            } catch (challengeError) {
                setMessage("loginMessage", challengeError.message);
            }
            return;
        }
        authFlowInProgress = false;
        setMessage("loginMessage", error.message);
    }
});

// Verifies a 6-digit code that was sent to the registered email address
$("emailOtpForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("emailOtpMessage", "");

    try {
        const code = String($("emailOtpCode").value || "").trim();
        if (!/^\d{6}$/.test(code)) validationError("Enter the 6-digit code from your email.");
        if (!pendingEmailOtpEmail) validationError("The email-code session has expired. Request a new code.");

        authFlowInProgress = true;
        const result = await busy(event.submitter, () => api("/api/auth/email-otp/verify", {
            method: "POST",
            body: JSON.stringify({ email: pendingEmailOtpEmail, code }),
            silent: true
        }), "Verifying…");

        const credential = await firebaseAuthApi.signInWithCustomToken(firebaseAuthInstance, result.customToken);
        const user = credential.user;
        clearEmailOtpSession();
        authFlowInProgress = false;
        resetSecurityForms();
        await finishSignedInUser(user);
    } catch (error) {
        authFlowInProgress = false;
        setMessage("emailOtpMessage", error.message || "The email sign-in code could not be verified.");
    }
});

// Sends another email code after the resend cooldown
$("resendEmailOtp").addEventListener("click", async event => {
    setMessage("emailOtpMessage", "");

    try {
        if (!pendingEmailOtpEmail) validationError("The email-code session has expired. Start again.");

        const remainingSeconds = Math.ceil((emailOtpResendAvailableAt - Date.now()) / 1000);
        if (remainingSeconds > 0) {
            validationError(`Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before requesting another code.`);
        }

        const result = await busy(event.currentTarget, () => api("/api/auth/email-otp/request", {
            method: "POST",
            body: JSON.stringify({ email: pendingEmailOtpEmail }),
            silent: true
        }), "Sending…");

        pendingEmailOtpMaskedEmail = result.maskedEmail || pendingEmailOtpEmail;
        emailOtpResendAvailableAt = Date.now() + (Number(result.resendAfterSeconds || 60) * 1000);
        emailOtpExpiresAt = Date.now() + (Number(result.expiresInSeconds || 600) * 1000);
        saveEmailOtpSession();
        $("emailOtpCode").value = "";
        $("emailOtpDestination").textContent = `New code sent to ${pendingEmailOtpMaskedEmail}.`;
        setMessage("emailOtpMessage", "A new 6-digit code was sent.", "success");
        startEmailOtpCountdown();
        $("emailOtpCode").focus();
    } catch (error) {
        if (Number(error?.retryAfterSeconds) > 0) {
            emailOtpResendAvailableAt = Date.now() + (Number(error.retryAfterSeconds) * 1000);
            if (!emailOtpExpiresAt) emailOtpExpiresAt = Date.now() + (10 * 60 * 1000);
            saveEmailOtpSession();
            startEmailOtpCountdown();
            setMessage("emailOtpMessage", "A recent code is still active. Use the countdown before requesting another code.");
        } else {
            setMessage("emailOtpMessage", error.message || "Could not resend the email code.");
        }
    }
});

// Cancels email-code sign in and returns to the login form
$("cancelEmailOtp").addEventListener("click", () => {
    clearEmailOtpSession();
    resetSecurityForms();
    setSignInMethod("email-otp", { preserveOtpSession: true });
    $("emailOtpEmail").focus();
});

// Verifies the 6-digit code for a previously enrolled authenticator
$("totpChallengeForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("totpChallengeMessage", "");

    try {
        const code = String($("totpChallengeCode").value || "").trim();
        if (!/^\d{6}$/.test(code)) validationError("Enter the 6-digit code from your authenticator app.");
        if (!pendingMfaResolver || !pendingMfaHint) validationError("The authentication session has expired. Start sign-in again.");

        const assertion = firebaseAuthApi.TotpMultiFactorGenerator.assertionForSignIn(pendingMfaHint.uid, code);
        const credential = await busy(event.submitter, () => pendingMfaResolver.resolveSignIn(assertion), "Verifying…");
        pendingMfaResolver = null;
        pendingMfaHint = null;
        authFlowInProgress = false;
        resetSecurityForms();
        await finishSignedInUser(credential.user);
    } catch (error) {
        setMessage("totpChallengeMessage", error.message || "Invalid or expired authenticator code.");
    }
});

// Finishes first-time TOTP enrollment
$("totpEnrollForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("totpEnrollMessage", "");

    try {
        const code = String($("totpEnrollCode").value || "").trim();
        if (!/^\d{6}$/.test(code)) validationError("Enter the 6-digit code from your authenticator app.");
        if (!pendingTotpSecret || !firebaseAuthInstance.currentUser) validationError("The authenticator setup session has expired. Start sign-in again.");

        const assertion = firebaseAuthApi.TotpMultiFactorGenerator.assertionForEnrollment(pendingTotpSecret, code);
        await busy(event.submitter, () => firebaseAuthApi.multiFactor(firebaseAuthInstance.currentUser).enroll(assertion, "XTECH Authenticator"), "Enabling…");
        pendingTotpSecret = null;
        authFlowInProgress = false;
        const user = firebaseAuthInstance.currentUser;
        resetSecurityForms();
        await finishSignedInUser(user);
        toast("Authenticator enabled successfully");
    } catch (error) {
        setMessage("totpEnrollMessage", error.message || "Could not enable the authenticator.");
    }
});

// Cancels an authenticator verification attempt
$("cancelTotpChallenge").addEventListener("click", async () => {
    authFlowInProgress = false;
    pendingMfaResolver = null;
    pendingMfaHint = null;
    resetSecurityForms();
    if (firebaseAuthInstance?.currentUser) await firebaseAuthApi.signOut(firebaseAuthInstance);
});

// Cancels first-time authenticator setup
$("cancelTotpEnroll").addEventListener("click", async () => {
    authFlowInProgress = false;
    pendingTotpSecret = null;
    if (firebaseAuthInstance?.currentUser) await firebaseAuthApi.signOut(firebaseAuthInstance);
    resetSecurityForms();
    setMessage("loginMessage", "Authenticator setup was cancelled.");
});

// Creates a pending customer account and requires the emailed 6-digit code to finish registration
$("registerForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("registerMessage", "");
    authFlowInProgress = true;

    try {
        const name = validateName($("registerName").value, "Full name");
        const email = validateEmail($("registerEmail").value);
        const phone = validatePhone($("registerPhone").value);
        const company = validateText($("registerCompany").value, "Company / Organization", 120);
        const address = validateText($("registerAddress").value, "Address", 250);
        const password = validatePassword($("registerPassword").value);
        if (password !== $("registerPassword2").value) {
            validationError("Passwords do not match.");
        }

        const result = await busy(event.submitter, () => api("/api/auth/register-customer", {
            method: "POST",
            body: JSON.stringify({ name, email, phone, company, address, password })
        }), "Creating Account…");

        pendingEmailOtpEmail = email;
        pendingEmailOtpMaskedEmail = result.maskedEmail || email;
        emailOtpResendAvailableAt = Date.now() + (Number(result.resendAfterSeconds || 60) * 1000);
        emailOtpExpiresAt = Date.now() + (Number(result.expiresInSeconds || 600) * 1000);
        saveEmailOtpSession();

        authFlowInProgress = false;
        showAuthMode("login", { preserveOtpSession: true });
        setSignInMethod("email-otp", { preserveOtpSession: true });
        $("emailOtpEmail").value = email;
        $("loginForm").classList.add("hidden");
        $("registerForm").classList.add("hidden");
        $("emailOtpForm").classList.remove("hidden");
        $("emailOtpDestination").textContent = `Registration code sent to ${pendingEmailOtpMaskedEmail}.`;
        setMessage("emailOtpMessage", "Enter the 6-digit code to verify your email and finish creating your XTECH account.", "success");
        startEmailOtpCountdown();
        $("emailOtpCode").focus();
    } catch (error) {
        authFlowInProgress = false;
        setMessage("registerMessage", error.message);
    }
});

$("logoutBtn").addEventListener("click", () => firebaseAuthApi.signOut(firebaseAuthInstance));
document.querySelectorAll(".nav").forEach(nav => nav.addEventListener("click", () => showSection(nav.dataset.section)));

// Handles inventory products and stock actions
// Loads active products from the backend
async function loadInventory() {
    try {
        const data = await api("/api/products");
        products = data.products || [];

        // Adds all active product quantities and shows the current total stock
        const totalCurrentStock = products.reduce((total, product) => total + Number(product.quantity || 0), 0);
        if ($("inventoryCurrentStock")) $("inventoryCurrentStock").textContent = totalCurrentStock.toLocaleString();

        renderProducts();
        updateProductSelectors();
    } catch (error) { toast(error.message); }
}

// Filters products and displays them in the inventory table
function renderProducts() {
    const search = $("productSearch").value.trim().toLowerCase();
    const category = $("categoryFilter").value;
    const status = $("statusFilter").value;
    const canManage = ["admin", "warehouse"].includes(profile?.role);
    const rows = products.filter(product =>
        (!search || `${product.productID} ${product.productName}`.toLowerCase().includes(search)) &&
        (!category || product.category === category) &&
        (!status || stockStatus(product) === status)
    );

    $("productTable").innerHTML = rows.length ? rows.map(product => `<tr>
        <td><strong>${esc(product.productID)}</strong></td><td>${esc(product.productName)}</td><td>${esc(product.category)}</td>
        <td>${badge(stockStatus(product))}</td>
        <td>${canManage ? `<button class="small-btn secondary" onclick="editProduct('${esc(product.productID)}')">Edit</button><button class="small-btn ghost dark-ghost" onclick="archiveProduct('${esc(product.productID)}')">Archive</button>` : "—"}</td>
    </tr>`).join("") : '<tr><td colspan="5"><div class="table-empty">No products match the current filters.</div></td></tr>';
}

["productSearch", "categoryFilter", "statusFilter"].forEach(id => $(id).addEventListener("input", renderProducts));

$("productForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("productMessage", "");
    try {
        const productID = validateProductID($("productID").value);
        const productName = validateProductName($("productName").value);
        const category = validateCategory($("category").value);
        const description = validateText($("description").value, "Product description", 500);

        await busy(event.submitter, () => api("/api/products", {
            method: "POST",
            body: JSON.stringify({
                productID, productName, category,
                unit: "", quantity: 0, reorderLevel: 0, description
            })
        }), "Adding Product…");
        event.target.reset();
        setMessage("productMessage", "Product added successfully.", "success");
        await Promise.all([loadInventory(), loadDashboard()]);
        toast("Product added successfully");
    } catch (error) { setMessage("productMessage", error.message); }
});

// Opens the form used to edit a product
window.editProduct = id => {
    const product = productById(id);
    if (!product) return;
    $("modalBody").innerHTML = `<h2>Edit Product</h2>
      <form id="editProductForm" class="form-grid">
        <label>Product Name<input id="editProductName" value="${esc(product.productName)}" required></label>
        <label>Category<select id="editProductCategory"><option ${product.category === "Industrial Chemical" ? "selected" : ""}>Industrial Chemical</option><option ${product.category === "Janitorial Chemical" ? "selected" : ""}>Janitorial Chemical</option><option ${product.category === "Cleaning Supply" ? "selected" : ""}>Cleaning Supply</option><option ${product.category === "Other" ? "selected" : ""}>Other</option></select></label>
        <label class="wide">Description<textarea id="editProductDescription">${esc(product.description || "")}</textarea></label>
        <button class="primary wide">Save Product Changes</button>
      </form>`;
    $("modal").classList.remove("hidden");
    $("editProductForm").addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const productName = validateProductName($("editProductName").value);
            const category = validateCategory($("editProductCategory").value);
            const description = validateText($("editProductDescription").value, "Product description", 500);

            await busy(event.submitter, () => api(`/api/products/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: JSON.stringify({
                    productName, category,
                    unit: product.unit || "", reorderLevel: Number(product.reorderLevel || 0), description
                })
            }), "Saving…");
            closeModal();
            await loadInventory();
            toast("Product updated successfully");
        } catch (error) { toast(error.message); }
    });
};

// Archives a product so it cannot be used in transactions
window.archiveProduct = async id => {
    if (!confirm(`Archive product ${id}? It will no longer be available for stock, pickup, or sale transactions.`)) return;
    try {
        await api(`/api/products/${encodeURIComponent(id)}/archive`, { method: "PATCH" });
        await Promise.all([loadInventory(), loadDashboard()]);
        toast("Product archived");
    } catch (error) { toast(error.message); }
};

$("archiveBtn").addEventListener("click", async () => {
    try {
        const data = await api("/api/products/archived");
        const archived = data.products || [];
        $("modalBody").innerHTML = `<h2>Archived Products</h2><div class="table-wrap"><table><thead><tr><th>Product ID</th><th>Product Name</th><th>Category</th><th>Action</th></tr></thead><tbody>${archived.length ? archived.map(product => `<tr><td>${esc(product.productID)}</td><td>${esc(product.productName)}</td><td>${esc(product.category)}</td><td><button class="small-btn secondary" onclick="restoreProduct('${esc(product.productID)}')">Restore Product</button></td></tr>`).join("") : '<tr><td colspan="4"><div class="table-empty">There are no archived products.</div></td></tr>'}</tbody></table></div>`;
        $("modal").classList.remove("hidden");
    } catch (error) { toast(error.message); }
});

// Restores an archived product
window.restoreProduct = async id => {
    try {
        await api(`/api/products/${encodeURIComponent(id)}/restore`, { method: "PATCH" });
        closeModal();
        await Promise.all([loadInventory(), loadDashboard()]);
        toast("Product restored");
    } catch (error) { toast(error.message); }
};

// Opens and processes the Stock In or Stock Out form
async function stock(type) {
    try {
        const data = await api("/api/products");
        products = data.products || [];
        if (!products.length) return toast("No active products are available.");
        const options = products.map(product => `<option value="${esc(product.productID)}" ${type === "out" && Number(product.quantity) <= 0 ? "disabled" : ""}>${esc(product.productName)} (${esc(product.productID)}) — ${product.quantity} ${esc(product.unit || "units")} available</option>`).join("");
        $("modalBody").innerHTML = `<h2>${type === "in" ? "Stock In — Add Stock" : "Stock Out — Release Stock"}</h2>
          <form id="stockForm" class="form-grid">
            <label>Product<select id="stockProduct" required>${options}</select></label>
            <label>Quantity to ${type === "in" ? "Add" : "Release"}<input id="stockQuantity" type="number" min="1" step="1" required></label>
            <label class="wide">Reason / Reference<input id="stockReason" placeholder="${type === "in" ? "e.g. Supplier delivery / purchase received" : "e.g. Damaged stock / manual release"}" required></label>
            <button class="primary wide">Confirm ${type === "in" ? "Stock In" : "Stock Out"}</button>
          </form>`;
        $("modal").classList.remove("hidden");
        $("stockForm").addEventListener("submit", async event => {
            event.preventDefault();
            try {
                const quantity = validatePositiveWholeNumber($("stockQuantity").value);
                const reason = validateText($("stockReason").value, "Reason / Reference", 200, true);
                if (reason.length < 2) validationError("Reason / Reference must be at least 2 characters.");

                await busy(event.submitter, () => api(`/api/inventory/stock-${type}`, {
                    method: "POST",
                    body: JSON.stringify({ productID: $("stockProduct").value, quantity, reason })
                }), "Updating Stock…");
                closeModal();
                await Promise.all([loadInventory(), loadTransactions(), loadDashboard()]);
                toast(type === "in" ? "Stock added successfully" : "Stock released successfully");
            } catch (error) { toast(error.message); }
        });
    } catch (error) { toast(error.message); }
}

$("stockInBtn").addEventListener("click", () => stock("in"));
$("stockOutBtn").addEventListener("click", () => stock("out"));

// Loads and filters stock movement history
// Loads stock movement records from the backend
async function loadTransactions() {
    try {
        const [transactionData] = await Promise.all([api("/api/inventory/transactions"), ensureFormData({ needCustomers: false })]);
        transactions = transactionData.transactions || [];
        renderTransactions();
    } catch (error) { toast(error.message); }
}

// Filters and displays stock movement records
function renderTransactions() {
    const search = $("transactionSearch").value.trim().toLowerCase();
    const type = $("transactionType").value;
    const productID = $("transactionProduct").value;
    const start = $("transactionFrom").value;
    const end = $("transactionTo").value;
    const rows = transactions.filter(item =>
        (!search || `${item.productID} ${item.productName} ${item.reason} ${item.performedBy} ${movementTypeLabel(item.type)}`.toLowerCase().includes(search)) &&
        (!type || item.type === type) && (!productID || item.productID === productID) && within(item.createdAt, start, end)
    );
    $("transactionTable").innerHTML = rows.length ? rows.map(item => {
        const increase = ["STOCK_IN", "INITIAL_STOCK"].includes(item.type);
        return `<tr><td>${fmtDateTime(item.createdAt)}</td><td>${esc(movementTypeLabel(item.type))}</td><td><strong>${esc(item.productName)}</strong><br><small>Product ID: ${esc(item.productID)}</small></td><td><strong>${increase ? "+" : "−"}${Number(item.quantity)}</strong></td><td>${Number(item.previousQuantity)}</td><td>${Number(item.newQuantity)}</td><td>${esc(item.reason || "—")}</td><td>${esc(item.performedBy || "System")}</td></tr>`;
    }).join("") : '<tr><td colspan="8"><div class="table-empty">No stock movements match the current filters.</div></td></tr>';
}

["transactionSearch", "transactionType", "transactionProduct", "transactionFrom", "transactionTo"].forEach(id => $(id).addEventListener("input", renderTransactions));
$("refreshTransactions").addEventListener("click", loadTransactions);
$("clearTransactionFilters").addEventListener("click", () => {
    ["transactionSearch", "transactionType", "transactionProduct", "transactionFrom", "transactionTo"].forEach(id => $(id).value = "");
    renderTransactions();
});

// Handles customer records and customer history
// Loads customer records from the backend
async function loadCustomers() {
    try {
        const data = await api("/api/customers");
        customers = data.customers || [];
        renderCustomers();
        updateCustomerSelectors();
    } catch (error) { toast(error.message); }
}

// Closes the customer action dropdown
function closeCustomerActionMenu() {
    document.querySelector(".customer-action-menu")?.remove();
}

// Opens the customer action dropdown beside the menu button or mouse pointer
function openCustomerActionMenu(customerID, anchor = null, point = null) {
    closeCustomerActionMenu();

    const customer = customers.find(item => item.id === customerID);
    if (!customer) return;

    const active = customer.active !== false;
    const menu = document.createElement("div");
    menu.className = "customer-action-menu";
    menu.setAttribute("role", "menu");

    menu.innerHTML = `
        <button type="button" data-action="edit" role="menuitem">Edit customer</button>
        <button type="button" data-action="history" role="menuitem">View history</button>
        <button type="button" class="${active ? "customer-menu-danger" : "customer-menu-activate"}" data-action="status" role="menuitem">
            ${active ? "Deactivate" : "Activate"}
        </button>
    `;

    document.body.appendChild(menu);

    let left = point?.x ?? 0;
    let top = point?.y ?? 0;

    if (anchor) {
        const rect = anchor.getBoundingClientRect();
        left = rect.right - menu.offsetWidth;
        top = rect.bottom + 6;
    }

    const padding = 8;
    const maxLeft = window.innerWidth - menu.offsetWidth - padding;
    const maxTop = window.innerHeight - menu.offsetHeight - padding;

    left = Math.max(padding, Math.min(left, maxLeft));
    top = Math.max(padding, Math.min(top, maxTop));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.addEventListener("click", event => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const action = button.dataset.action;
        closeCustomerActionMenu();

        if (action === "edit") editCustomer(customerID);
        if (action === "history") customerHistory(customerID);
        if (action === "status") setCustomerStatus(customerID, !active);
    });
}

// Filters and displays customer records
function renderCustomers() {
    closeCustomerActionMenu();

    const search = $("customerSearch").value.trim().toLowerCase();
    const status = $("customerStatusFilter").value;
    const rows = customers.filter(customer => {
        const active = customer.active !== false;
        return (!search || `${customer.name} ${customer.email} ${customer.phone} ${customer.company}`.toLowerCase().includes(search)) &&
            (!status || (status === "active" ? active : !active));
    });

    $("customerTable").innerHTML = rows.length ? rows.map(customer => {
        const active = customer.active !== false;

        return `<tr class="customer-row" data-customer-id="${esc(customer.id)}">
          <td><strong>${esc(customer.name)}</strong></td>
          <td>${esc(customer.email)}</td>
          <td>${esc(customer.phone || "—")}</td>
          <td>${esc(customer.company || "—")}</td>
          <td>${badge(active ? "Active" : "Inactive")}</td>
          <td>${customer.userUID ? badge("Linked") : "No login account"}</td>
          <td class="customer-action-cell">
            <button
              type="button"
              class="customer-menu-btn"
              data-customer-menu="${esc(customer.id)}"
              aria-label="Open actions for ${esc(customer.name)}"
              title="Customer actions"
            >⋮</button>
          </td>
        </tr>`;
    }).join("") : '<tr><td colspan="7"><div class="table-empty">No customers match the current filters.</div></td></tr>';

    // Opens the menu when the three-dot button is clicked
    document.querySelectorAll(".customer-menu-btn").forEach(button => {
        button.addEventListener("click", event => {
            event.stopPropagation();
            openCustomerActionMenu(button.dataset.customerMenu, button);
        });
    });

    // Opens the same menu when a customer row is right-clicked
    document.querySelectorAll(".customer-row").forEach(row => {
        row.addEventListener("contextmenu", event => {
            if (event.target.closest("button, input, select, textarea, a")) return;
            event.preventDefault();
            openCustomerActionMenu(row.dataset.customerId, null, {
                x: event.clientX,
                y: event.clientY
            });
        });
    });
}

["customerSearch", "customerStatusFilter"].forEach(id => $(id).addEventListener("input", renderCustomers));

// Closes the customer action menu when clicking somewhere else
document.addEventListener("click", event => {
    if (!event.target.closest(".customer-action-menu, .customer-menu-btn")) closeCustomerActionMenu();
});

// Closes the customer action menu if the page moves
window.addEventListener("resize", closeCustomerActionMenu);
window.addEventListener("scroll", closeCustomerActionMenu, true);

// Closes the customer action menu with the Escape key
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeCustomerActionMenu();
});

$("customerForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("customerMessage", "");
    try {
        const name = validateName($("customerName").value, "Customer name");
        const email = validateEmail($("customerEmail").value);
        const phone = validatePhone($("customerPhone").value);
        const company = validateText($("customerCompany").value, "Company / Organization", 120);
        const address = validateText($("customerAddress").value, "Address", 250);

        await busy(event.submitter, () => api("/api/customers", {
            method: "POST",
            body: JSON.stringify({ name, email, phone, company, address })
        }), "Registering…");
        event.target.reset();
        setMessage("customerMessage", "Customer registered successfully.", "success");
        await Promise.all([loadCustomers(), loadDashboard()]);
        toast("Customer registered");
    } catch (error) { setMessage("customerMessage", error.message); }
});

// Opens the form used to edit a customer
window.editCustomer = id => {
    const customer = customers.find(item => item.id === id);
    if (!customer) return;
    $("modalBody").innerHTML = `<h2>Edit Customer</h2><form id="editCustomerForm" class="form-grid">
      <label>Customer Name<input id="editCustomerName" value="${esc(customer.name)}" maxlength="80" required></label>
      <label>Email Address<input id="editCustomerEmail" type="email" value="${esc(customer.email)}" maxlength="254" required></label>
      <label>Phone Number<input id="editCustomerPhone" type="tel" value="${esc(customer.phone || "")}" maxlength="18" inputmode="tel" placeholder="09171234567 or +639171234567"></label>
      <label>Company / Organization<input id="editCustomerCompany" value="${esc(customer.company || "")}" maxlength="120"></label>
      <label class="wide">Address<input id="editCustomerAddress" value="${esc(customer.address || "")}" maxlength="250"></label>
      <button class="primary wide">Save Customer Changes</button>
    </form>`;
    $("modal").classList.remove("hidden");
    $("editCustomerForm").addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const name = validateName($("editCustomerName").value, "Customer name");
            const email = validateEmail($("editCustomerEmail").value);
            const phone = validatePhone($("editCustomerPhone").value);
            const company = validateText($("editCustomerCompany").value, "Company / Organization", 120);
            const address = validateText($("editCustomerAddress").value, "Address", 250);

            await busy(event.submitter, () => api(`/api/customers/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: JSON.stringify({ name, email, phone, company, address })
            }), "Saving…");
            closeModal(); await loadCustomers(); toast("Customer updated successfully");
        } catch (error) { toast(error.message); }
    });
};

// Activates or deactivates a customer record
window.setCustomerStatus = async (id, active) => {
    const customer = customers.find(item => item.id === id);
    const verb = active ? "activate" : "deactivate";
    if (!confirm(`${verb[0].toUpperCase() + verb.slice(1)} ${customer?.name || "this customer"}?${!active && customer?.userUID ? " Their login account will also be disabled." : ""}`)) return;
    try {
        await api(`/api/customers/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ active }) });
        await Promise.all([loadCustomers(), loadDashboard()]);
        toast(`Customer ${active ? "activated" : "deactivated"}`);
    } catch (error) { toast(error.message); }
};

// Creates a short readable list of products and quantities
function itemSummary(items = []) {
    return items.length ? items.map(item => `${esc(item.productName || productById(item.productID)?.productName || item.productID)} × ${Number(item.quantity)}`).join("<br>") : "—";
}

// Shows the selected customer's pickup and sales history
window.customerHistory = async id => {
    try {
        const data = await api(`/api/customers/${encodeURIComponent(id)}/history`);
        const pickupRows = data.pickups.length ? data.pickups.map(item => `<tr><td>${fmtDateTime(item.createdAt)}</td><td>${esc(item.pickupID)}</td><td>${fmtDate(item.requestedDate)}</td><td>${badge(item.status)}</td><td>${itemSummary(item.items)}</td></tr>`).join("") : '<tr><td colspan="5">No pickup history.</td></tr>';
        const saleRows = data.sales.length ? data.sales.map(item => `<tr><td>${fmtDateTime(item.createdAt)}</td><td>${esc(item.saleID)}</td><td>${badge(item.status)}</td><td>${itemSummary(item.items)}</td></tr>`).join("") : '<tr><td colspan="4">No sales history.</td></tr>';
        $("modalBody").innerHTML = `<h2>${esc(data.customer.name)} — Customer History</h2><div class="detail-grid"><div><span>Email</span><strong>${esc(data.customer.email)}</strong></div><div><span>Phone</span><strong>${esc(data.customer.phone || "—")}</strong></div><div><span>Company</span><strong>${esc(data.customer.company || "—")}</strong></div><div><span>Status</span><strong>${data.customer.active !== false ? "Active" : "Inactive"}</strong></div></div>
          <h3>Pickup History (${data.pickups.length})</h3><div class="table-wrap"><table><thead><tr><th>Created</th><th>Pickup Reference</th><th>Pickup Date</th><th>Status</th><th>Products</th></tr></thead><tbody>${pickupRows}</tbody></table></div>
          <h3>Sales History (${data.sales.length})</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Sale Reference</th><th>Status</th><th>Products</th></tr></thead><tbody>${saleRows}</tbody></table></div>`;
        $("modal").classList.remove("hidden");
    } catch (error) { toast(error.message); }
};

// Handles pickup requests and pickup status changes
// Loads pickup requests from the backend
async function loadPickups() {
    try {
        $("pickupDate").min = todayYMD();
        const needCustomers = profile?.role !== "customer";
        const [pickupData] = await Promise.all([api("/api/pickups"), ensureFormData({ needCustomers })]);
        pickups = pickupData.pickups || [];
        renderPickupFormItems();
        renderPickups();
    } catch (error) { toast(error.message); }
}

// Filters and displays pickup requests
function renderPickups() {
    const search = $("pickupSearch").value.trim().toLowerCase();
    const status = $("pickupStatusFilter").value;
    const start = $("pickupFrom").value;
    const end = $("pickupTo").value;
    const rows = pickups.filter(pickup => {
        const productText = (pickup.items || []).map(item => `${item.productID} ${productById(item.productID)?.productName || ""}`).join(" ");
        return (!search || `${pickup.pickupID} ${pickup.customerName} ${productText} ${pickup.notes || ""}`.toLowerCase().includes(search)) &&
            (!status || pickup.status === status) && within(pickup.requestedDate, start, end);
    });

    $("pickupTable").innerHTML = rows.length ? rows.map(pickup => {
        let actions = "—";
        if (profile?.role === "customer" && pickup.status === "Pending") {
            actions = `<button class="small-btn ghost dark-ghost" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Cancelled')">Cancel Request</button>`;
        } else if (profile?.role !== "customer" && pickup.status === "Pending") {
            actions = `<button class="small-btn secondary" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Approved')">Approve</button><button class="small-btn ghost dark-ghost" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Cancelled')">Cancel</button>`;
        } else if (profile?.role !== "customer" && pickup.status === "Approved") {
            actions = `<button class="small-btn primary" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Completed')">Complete Pickup</button><button class="small-btn ghost dark-ghost" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Cancelled')">Cancel</button>`;
        }
        return `<tr><td>${fmtDateTime(pickup.createdAt)}</td><td><strong>${esc(pickup.pickupID)}</strong></td><td>${esc(pickup.customerName || customerNameFor(pickup.customerID, "Walk-in / No registered customer"))}</td><td>${fmtDate(pickup.requestedDate)}</td><td>${badge(pickup.status)}</td><td>${itemSummary(pickup.items)}<small class="table-subtext">Total ordered: ${Number(pickup.totalQuantity ?? (pickup.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0))}</small></td><td class="wrap-cell">${esc(pickup.notes || "—")}</td><td>${actions}</td></tr>`;
    }).join("") : '<tr><td colspan="8"><div class="table-empty">No pickup requests match the current filters.</div></td></tr>';
}

["pickupSearch", "pickupStatusFilter", "pickupFrom", "pickupTo"].forEach(id => $(id).addEventListener("input", renderPickups));

$("pickupProduct").addEventListener("change", syncPickupQuantityLimit);

$("addPickupItem").addEventListener("click", async event => {
    try {
        // Refresh first so the customer is checked against the same current stock the admin account uses.
        await busy(event.currentTarget, refreshPickupInventory, "Checking Stock…");
        syncPickupQuantityLimit();

        const productID = $("pickupProduct").value;
        const quantity = Number($("pickupQuantity").value);
        const product = productById(productID);
        if (!product) return toast("Select a product first.");

        validatePositiveWholeNumber(quantity, "Pickup quantity");

        const existing = pickupFormItems.find(item => item.productID === productID);
        const requestedTotal = quantity + (existing?.quantity || 0);
        const adminStock = Number(product.quantity || 0);
        if (requestedTotal > adminStock) {
            return toast(`Order cannot proceed. Admin inventory shows only ${adminStock} ${product.unit || "units"} of ${product.productName}, but this request would total ${requestedTotal}.`);
        }

        mergeFormItem(pickupFormItems, productID, quantity);
        $("pickupQuantity").value = "1";
        renderPickupFormItems();
        syncPickupQuantityLimit();
    } catch (error) {
        toast(error.message);
    }
});

// Removes a product from the current pickup request
window.removePickupItem = productID => {
    pickupFormItems = pickupFormItems.filter(item => item.productID !== productID);
    renderPickupFormItems();
    syncPickupQuantityLimit();
};

$("pickupForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("pickupMessage", "");
    if (!pickupFormItems.length) return setMessage("pickupMessage", "Add at least one product to the pickup request.");
    try {
        const requestedDate = validateFutureDate($("pickupDate").value, "Requested pickup date");
        const notes = validateText($("pickupNotes").value, "Pickup notes", 500);

        // Recheck immediately before submission so stale browser data cannot be used.
        await refreshPickupInventory();
        for (const item of pickupFormItems) {
            const product = productById(item.productID);
            if (!product) throw new Error(`Product ${item.productID} is no longer available.`);
            const adminStock = Number(product.quantity || 0);
            if (item.quantity > adminStock) {
                throw new Error(`Order cannot proceed. Admin inventory shows ${adminStock} ${product.unit || "units"} of ${product.productName}, but ${item.quantity} were ordered.`);
            }
        }

        await busy(event.submitter, () => api("/api/pickups", {
            method: "POST",
            body: JSON.stringify({
                customerID: profile?.role === "customer" ? null : ($("pickupCustomerID").value || null),
                requestedDate, notes, items: pickupFormItems
            })
        }), "Submitting Pickup…");
        event.target.reset();
        $("pickupDate").min = todayYMD();
        pickupFormItems = [];
        renderPickupFormItems(); updateCustomerSelectors(); updateProductSelectors(); syncPickupQuantityLimit();
        setMessage("pickupMessage", "Pickup request submitted successfully.", "success");
        await Promise.all([loadPickups(), profile?.role === "customer" ? Promise.resolve() : loadDashboard()]);
        toast("Pickup request submitted");
    } catch (error) { setMessage("pickupMessage", error.message); }
});

// Changes the status of a pickup request
window.setPickup = async (id, status) => {
    const wording = status === "Completed" ? "complete this pickup and deduct its products from inventory" : status === "Cancelled" ? "cancel this pickup request" : "approve this pickup request";
    if (!confirm(`Are you sure you want to ${wording}?`)) return;
    try {
        await api(`/api/pickups/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
        const reloads = [loadPickups()];
        if (profile?.role !== "customer") reloads.push(loadInventory(), loadTransactions(), loadDashboard());
        await Promise.all(reloads);
        toast(status === "Cancelled" ? "Pickup cancelled" : `Pickup marked ${status}`);
    } catch (error) { toast(error.message); }
};

// Handles sales records and sale details
// Loads sales records from the backend
async function loadSales() {
    try {
        const [saleData] = await Promise.all([api("/api/sales"), ensureFormData({ needCustomers: true })]);
        sales = saleData.sales || [];
        renderSaleFormItems(); renderSales();
    } catch (error) { toast(error.message); }
}

// Filters and displays sales records
function renderSales() {
    const search = $("saleSearch").value.trim().toLowerCase();
    const customerID = $("saleCustomerFilter").value;
    const status = $("saleStatusFilter").value;
    const start = $("saleFrom").value;
    const end = $("saleTo").value;
    const rows = sales.filter(sale => {
        const productText = (sale.items || []).map(item => `${item.productName} ${item.productID}`).join(" ");
        return (!search || `${sale.saleID} ${sale.customerName} ${productText} ${sale.notes || ""}`.toLowerCase().includes(search)) &&
            (!customerID || sale.customerID === customerID) && (!status || sale.status === status) && within(sale.createdAt, start, end);
    });
    $("saleTable").innerHTML = rows.length ? rows.map(sale => `<tr><td>${fmtDateTime(sale.createdAt)}</td><td><strong>${esc(sale.saleID)}</strong></td><td>${esc(sale.customerName || customerNameFor(sale.customerID))}</td><td>${badge(sale.status)}</td><td>${itemSummary(sale.items)}</td><td>${esc(sale.createdByName || "—")}</td><td><button class="small-btn secondary" onclick="viewSale('${esc(sale.id || sale.saleID)}')">View Details</button></td></tr>`).join("") : '<tr><td colspan="7"><div class="table-empty">No sales transactions match the current filters.</div></td></tr>';
}

["saleSearch", "saleCustomerFilter", "saleStatusFilter", "saleFrom", "saleTo"].forEach(id => $(id).addEventListener("input", renderSales));

$("addSaleItem").addEventListener("click", () => {
    const productID = $("saleProduct").value;
    const quantity = Number($("saleQuantity").value);
    const product = productById(productID);
    if (!product) return toast("Select a product first.");
    try {
        validatePositiveWholeNumber(quantity, "Sale quantity");
    } catch (error) {
        return toast(error.message);
    }
    const existing = saleFormItems.find(item => item.productID === productID);
    if (quantity + (existing?.quantity || 0) > Number(product.quantity)) return toast(`Only ${product.quantity} ${product.unit || "units"} of ${product.productName} are currently available.`);
    mergeFormItem(saleFormItems, productID, quantity);
    $("saleQuantity").value = "1";
    renderSaleFormItems();
});

// Removes a product from the current sale
window.removeSaleItem = productID => { saleFormItems = saleFormItems.filter(item => item.productID !== productID); renderSaleFormItems(); };

$("saleForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("saleMessage", "");
    if (!saleFormItems.length) return setMessage("saleMessage", "Add at least one product before confirming the sale.");
    try {
        const notes = validateText($("saleNotes").value, "Sale notes", 500);
        if (!confirm("Confirm this sale? Inventory will be deducted immediately.")) return;

        const data = await busy(event.submitter, () => api("/api/sales", {
            method: "POST",
            body: JSON.stringify({ customerID: $("saleCustomerID").value || null, items: saleFormItems, notes })
        }), "Recording Sale…");
        event.target.reset(); saleFormItems = []; renderSaleFormItems(); updateCustomerSelectors(); updateProductSelectors();
        setMessage("saleMessage", `Sale ${data.sale.saleID} recorded successfully.`, "success");
        await Promise.all([loadSales(), loadInventory(), loadTransactions(), loadDashboard()]);
        toast("Sale recorded successfully");
    } catch (error) { setMessage("saleMessage", error.message); }
});

// Opens the details of a selected sale
window.viewSale = id => {
    const sale = sales.find(item => item.id === id || item.saleID === id);
    if (!sale) return;
    const rows = (sale.items || []).map(item => `<tr><td>${esc(item.productName)}</td><td>${esc(item.productID)}</td><td>${Number(item.quantity)}</td></tr>`).join("");
    $("modalBody").innerHTML = `<h2>Sale Details</h2><div class="detail-grid"><div><span>Sale Reference</span><strong>${esc(sale.saleID)}</strong></div><div><span>Date & Time</span><strong>${fmtDateTime(sale.createdAt)}</strong></div><div><span>Customer</span><strong>${esc(sale.customerName || customerNameFor(sale.customerID))}</strong></div><div><span>Status</span><strong>${esc(sale.status)}</strong></div><div><span>Processed By</span><strong>${esc(sale.createdByName || "—")}</strong></div></div><h3>Products Sold</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th>Product ID</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table></div><h3>Notes</h3><p>${esc(sale.notes || "No notes recorded.")}</p>`;
    $("modal").classList.remove("hidden");
};

// Handles staff accounts and account status
// Loads staff accounts from the backend
async function loadUsers() {
    try {
        const data = await api("/api/users");
        users = data.users || [];
        renderUsers();
    } catch (error) { toast(error.message); }
}

// Filters and displays staff accounts
function renderUsers() {
    const search = $("userSearch").value.trim().toLowerCase();
    const status = $("userStatusFilter").value;
    const rows = users.filter(user => {
        const active = user.active !== false;
        return (!search || `${user.name} ${user.email} ${roleDisplayName(user.role)}`.toLowerCase().includes(search)) && (!status || (status === "active" ? active : !active));
    });
    $("userTable").innerHTML = rows.length ? rows.map(user => {
        const active = user.active !== false;
        const isSelf = user.uid === currentUser?.uid;
        return `<tr><td><strong>${esc(user.name || "—")}</strong></td><td>${esc(user.email || "—")}</td><td>${esc(roleDisplayName(user.role))}</td><td>${badge(active ? "Active" : "Inactive")}</td><td>${isSelf ? "Current account" : `<button class="small-btn ghost dark-ghost" onclick="setUserStatus('${esc(user.uid || user.id)}', ${!active})">${active ? "Deactivate" : "Activate"}</button>`}</td></tr>`;
    }).join("") : '<tr><td colspan="5"><div class="table-empty">No user accounts match the current filters.</div></td></tr>';
}

["userSearch", "userStatusFilter"].forEach(id => $(id).addEventListener("input", renderUsers));
$("refreshUsers").addEventListener("click", loadUsers);

$("userForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("userMessage", "");
    try {
        const name = validateName($("userName").value, "Staff name");
        const email = validateEmail($("userAccountEmail").value);
        const password = validatePassword($("userPassword").value);
        const role = $("userRole").value;
        if (!["secretary", "warehouse"].includes(role)) validationError("Select a valid staff role.");

        await busy(event.submitter, () => api("/api/users", {
            method: "POST",
            body: JSON.stringify({ name, email, password, role })
        }), "Creating Account…");
        event.target.reset();
        setMessage("userMessage", "Staff account created successfully.", "success");
        await loadUsers(); toast("Staff account created");
    } catch (error) { setMessage("userMessage", error.message); }
});

// Activates or deactivates a staff account
window.setUserStatus = async (uid, active) => {
    if (!confirm(`${active ? "Activate" : "Deactivate"} this staff account?`)) return;
    try {
        await api(`/api/users/${encodeURIComponent(uid)}/status`, { method: "PATCH", body: JSON.stringify({ active }) });
        await loadUsers(); toast(`Account ${active ? "activated" : "deactivated"}`);
    } catch (error) { toast(error.message); }
};

// Loads account and MFA details shown on the Account & Security page
function loadSecurity() {
    if (!currentUser || !firebaseAuthApi) return;

    $("securityEmail").textContent = currentUser.email || "—";
    $("securityRole").textContent = roleDisplayName(profile?.role || "customer");

    const factors = firebaseAuthApi.multiFactor(currentUser).enrolledFactors || [];
    const hasTotp = factors.some(factor => factor.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID);
    $("securityMfaStatus").textContent = hasTotp ? "Authenticator enabled" : "Not enabled";
    $("securityEmailOtpStatus").textContent = currentUser.email ? "Available" : "Unavailable";

    const lastSignIn = currentUser.metadata?.lastSignInTime;
    $("securityLastSignIn").textContent = lastSignIn ? new Date(lastSignIn).toLocaleString() : "—";
}

// Clears any unfinished Authenticator verification for a password change
function resetPasswordChangeMfa() {
    pendingPasswordChangeMfaResolver = null;
    pendingPasswordChangeMfaHint = null;
    $("changePasswordTotpWrap")?.classList.add("hidden");
    if ($("changePasswordTotpCode")) $("changePasswordTotpCode").value = "";
}

// Sends a Firebase password-reset link to the signed-in account
$("sendResetPasswordBtn").addEventListener("click", async event => {
    setMessage("securityResetMessage", "");
    try {
        if (!currentUser?.email) validationError("This account does not have an email address.");
        await busy(event.currentTarget, () => firebaseAuthApi.sendPasswordResetEmail(firebaseAuthInstance, currentUser.email), "Sending…");
        setMessage("securityResetMessage", `Password reset email sent to ${currentUser.email}.`, "success");
    } catch (error) {
        setMessage("securityResetMessage", error.message || "Could not send the password reset email.");
    }
});

// Verifies the current password, optional TOTP code, then changes the Firebase password
$("changePasswordForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("changePasswordMessage", "");

    try {
        if (!currentUser?.email) validationError("This account does not have an email address.");

        const currentPassword = validateText($("currentPassword").value, "Current password", 128, true);
        const newPassword = validateNewPassword($("newPassword").value);
        const confirmPassword = String($("confirmNewPassword").value || "");

        if (newPassword !== confirmPassword) validationError("New password and confirmation do not match.");
        if (newPassword === currentPassword) validationError("Your new password must be different from your current password.");

        // If Firebase already requested MFA, verify that code and continue the password change.
        if (pendingPasswordChangeMfaResolver && pendingPasswordChangeMfaHint) {
            const code = String($("changePasswordTotpCode").value || "").trim();
            if (!/^\d{6}$/.test(code)) validationError("Enter the 6-digit code from your authenticator app.");

            const assertion = firebaseAuthApi.TotpMultiFactorGenerator.assertionForSignIn(pendingPasswordChangeMfaHint.uid, code);
            await busy(event.submitter, () => pendingPasswordChangeMfaResolver.resolveSignIn(assertion), "Verifying…");
            resetPasswordChangeMfa();
        } else {
            // Re-sign in with the current password so Firebase treats this as a recent, security-sensitive login.
            try {
                await firebaseAuthApi.signInWithEmailAndPassword(firebaseAuthInstance, currentUser.email, currentPassword);
            } catch (error) {
                if (error.code !== "auth/multi-factor-auth-required") throw error;

                pendingPasswordChangeMfaResolver = firebaseAuthApi.getMultiFactorResolver(firebaseAuthInstance, error);
                pendingPasswordChangeMfaHint = pendingPasswordChangeMfaResolver.hints.find(
                    hint => hint.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID
                );

                if (!pendingPasswordChangeMfaHint) {
                    resetPasswordChangeMfa();
                    validationError("This account requires an unsupported multi-factor method.");
                }

                $("changePasswordTotpWrap").classList.remove("hidden");
                $("changePasswordTotpCode").focus();
                setMessage("changePasswordMessage", "Current password verified. Enter your 6-digit Authenticator code to continue.", "success");
                return;
            }
        }

        const user = firebaseAuthInstance.currentUser;
        if (!user) validationError("Your authentication session expired. Sign in again.");

        await busy(event.submitter, () => firebaseAuthApi.updatePassword(user, newPassword), "Changing…");
        $("changePasswordForm").reset();
        resetPasswordChangeMfa();
        toast("Password changed successfully");

        // Require a fresh sign-in using the new password after the change.
        await firebaseAuthApi.signOut(firebaseAuthInstance);
        setMessage("loginMessage", "Password changed successfully. Sign in again using your new password.", "success");
    } catch (error) {
        const friendly = ({
            "auth/invalid-credential": "The current password is incorrect.",
            "auth/wrong-password": "The current password is incorrect.",
            "auth/weak-password": "The new password is too weak.",
            "auth/requires-recent-login": "Please sign out, sign in again, and retry the password change."
        })[error.code] || error.message || "Could not change the password.";
        setMessage("changePasswordMessage", friendly);
    }
});

// Loads and updates the customer's profile
// Loads the signed-in customer's profile
async function loadProfile() {
    try {
        const data = await api("/api/profile");
        const customer = data.customer;
        $("profileName").value = customer.name || "";
        $("profileEmail").value = customer.email || currentUser?.email || "";
        $("profilePhone").value = customer.phone || "";
        $("profileCompany").value = customer.company || "";
        $("profileAddress").value = customer.address || "";
        setMessage("profileMessage", "");
    } catch (error) { setMessage("profileMessage", error.message); }
}

$("profileForm").addEventListener("submit", async event => {
    event.preventDefault();
    setMessage("profileMessage", "");
    try {
        const name = validateName($("profileName").value, "Full name");
        const phone = validatePhone($("profilePhone").value);
        const company = validateText($("profileCompany").value, "Company / Organization", 120);
        const address = validateText($("profileAddress").value, "Address", 250);

        await busy(event.submitter, () => api("/api/profile", {
            method: "PUT",
            body: JSON.stringify({ name, phone, company, address })
        }), "Saving Profile…");
        setMessage("profileMessage", "Profile updated successfully.", "success");
        toast("Profile updated");
    } catch (error) { setMessage("profileMessage", error.message); }
});

// Loads dashboard totals, low-stock products, and chart data
async function loadDashboard() {
    try {
        const data = await api("/api/dashboard");
        $("mProducts").textContent = data.metrics.totalProducts;
        $("mLow").textContent = data.metrics.lowStock;
        $("mCustomers").textContent = data.metrics.customers;
        $("mPickups").textContent = data.metrics.pendingPickups;
        $("mSales").textContent = data.metrics.totalSales;
        $("mUnitsSold").textContent = Number(data.metrics.totalUnitsSold || 0).toLocaleString();
        drawCharts(data);

        $("dashboardLowStock").innerHTML = data.lowStockProducts.length ? data.lowStockProducts.map(product => `<tr><td>${esc(product.productName)}</td><td>${Number(product.quantity)} ${esc(product.unit || "")}</td><td>${Number(product.reorderLevel)}</td><td>${badge(stockStatus(product))}</td></tr>`).join("") : '<tr><td colspan="4">No low-stock products.</td></tr>';
    } catch (error) { toast(error.message); }
}

// Draws the inventory, pickup, and sales charts
function drawCharts(data) {
    Object.values(charts).forEach(chart => chart?.destroy());
    charts = {};

    const darkMode = document.body.classList.contains("dark");
    const textColor = darkMode ? "#cbd5e1" : "#475569";
    const gridColor = darkMode ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.20)";
    const blue = darkMode ? "#60a5fa" : "#2563eb";
    const purple = darkMode ? "#a78bfa" : "#7c3aed";
    const green = darkMode ? "#4ade80" : "#16a34a";

    const commonScales = {
        x: { grid: { display: false }, ticks: { color: textColor, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } }
    };
    const commonPlugins = {
        legend: { labels: { color: textColor, boxWidth: 12, usePointStyle: true } }
    };

    charts.inventory = new Chart($("inventoryChart"), {
        type: "bar",
        data: {
            labels: data.inventory.map(item => item.name),
            datasets: [{
                label: "Quantity in Stock",
                data: data.inventory.map(item => item.quantity),
                backgroundColor: darkMode ? "rgba(96, 165, 250, 0.55)" : "rgba(37, 99, 235, 0.72)",
                borderColor: blue,
                borderWidth: 1,
                borderRadius: 6,
                maxBarThickness: 42
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: commonPlugins, scales: commonScales }
    });

    charts.pickups = new Chart($("pickupChart"), {
        type: "line",
        data: {
            labels: data.weeklyPickups.map(item => item.date),
            datasets: [{
                label: "Pickup Requests",
                data: data.weeklyPickups.map(item => item.count),
                borderColor: purple,
                backgroundColor: darkMode ? "rgba(167, 139, 250, 0.12)" : "rgba(124, 58, 237, 0.10)",
                pointBackgroundColor: purple,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: commonPlugins,
            scales: {
                x: commonScales.x,
                y: { ...commonScales.y, ticks: { ...commonScales.y.ticks, precision: 0 } }
            }
        }
    });

    charts.sales = new Chart($("salesChart"), {
        type: "line",
        data: {
            labels: data.weeklySales.map(item => item.date),
            datasets: [{
                label: "Units Sold",
                data: data.weeklySales.map(item => item.unitsSold),
                borderColor: green,
                backgroundColor: darkMode ? "rgba(74, 222, 128, 0.10)" : "rgba(22, 163, 74, 0.09)",
                pointBackgroundColor: green,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.35,
                fill: true
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: commonPlugins, scales: commonScales }
    });
}

$("refreshDashboard").addEventListener("click", loadDashboard);

// Builds, displays, prints, and exports reports
// Builds the selected report date range for API requests
function reportQuery() {
    const start = $("reportStart").value;
    const end = $("reportEnd").value;
    if (start && end && start > end) throw new Error("Report start date cannot be after the end date.");
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return params.toString();
}

// Loads report data and summary totals
async function loadReports() {
    try {
        const query = reportQuery();
        reportCache = await api(`/api/reports/summary${query ? `?${query}` : ""}`);
        reportCacheQuery = query;
        $("rProducts").textContent = reportCache.metrics.totalProducts;
        $("rLow").textContent = reportCache.metrics.lowStock;
        $("rCustomers").textContent = reportCache.metrics.activeCustomers;
        $("rSales").textContent = reportCache.metrics.sales;
        $("rUnitsSold").textContent = Number(reportCache.metrics.unitsSold || 0).toLocaleString();
        $("rPickups").textContent = reportCache.metrics.pickups;
        $("reportGeneratedAt").textContent = `Generated ${fmtDateTime(reportCache.generatedAt)}`;
        const start = reportCache.period.start;
        const end = reportCache.period.end;
        $("reportPeriodLabel").textContent = start || end
            ? `Reporting period: ${start ? fmtDate(start) : "Beginning"} to ${end ? fmtDate(end) : "Present"}`
            : "Reporting period: All available records / current inventory";
        renderReportTable();
        return reportCache;
    } catch (error) {
        toast(error.message);
        return null;
    }
}

// Reloads reports when the date filters changed after the last generation
async function ensureCurrentReportData() {
    const query = reportQuery();
    if (!reportCache || reportCacheQuery !== query) {
        const loaded = await loadReports();
        if (!loaded) throw new Error("Generate the report before exporting or printing.");
    }
    return reportCache;
}

// Converts report data into table headings and rows
function reportTableRows(type) {
    if (!reportCache) return { title: "Report", headers: [], rows: [] };
    if (type === "inventory") return {
        title: "Inventory Report",
        headers: ["Product ID", "Product Name", "Category", "Unit", "Quantity", "Reorder Level", "Stock Status"],
        rows: reportCache.inventory.map(item => [item.productID, item.productName, item.category, item.unit || "—", item.quantity, item.reorderLevel, stockStatus(item)])
    };
    if (type === "transactions") return {
        title: "Stock Movement Report",
        headers: ["Date & Time", "Movement Type", "Product", "Quantity Changed", "Stock Before", "Stock After", "Reason / Reference", "Performed By"],
        rows: reportCache.transactions.map(item => [fmtDateTime(item.createdAt), movementTypeLabel(item.type), `${item.productName} (${item.productID})`, `${["STOCK_IN", "INITIAL_STOCK"].includes(item.type) ? "+" : "−"}${item.quantity}`, item.previousQuantity, item.newQuantity, item.reason || "—", item.performedBy || "System"])
    };
    if (type === "sales") return {
        title: "Sales Report",
        headers: ["Date & Time", "Sale Reference", "Customer", "Status", "Products / Quantity", "Processed By"],
        rows: reportCache.sales.map(item => [fmtDateTime(item.createdAt), item.saleID, item.customerName || "Walk-in / No registered customer", item.status, (item.items || []).map(product => `${product.productName || product.productID} × ${Number(product.quantity)}`).join("; ") || "—", item.createdByName || "—"])
    };
    return {
        title: "Pickup Report",
        headers: ["Request Date & Time", "Pickup Reference", "Customer", "Requested Pickup Date", "Status", "Notes"],
        rows: reportCache.pickups.map(item => [fmtDateTime(item.createdAt), item.pickupID, item.customerName || "Walk-in / No registered customer", fmtDate(item.requestedDate), item.status, item.notes || "—"])
    };
}

// Displays the currently selected report table
function renderReportTable() {
    const model = reportTableRows($("reportType").value);
    $("reportTableTitle").textContent = model.title;
    $("reportRowCount").textContent = `${model.rows.length.toLocaleString()} ${model.rows.length === 1 ? "row" : "rows"}`;
    $("reportTableHead").innerHTML = `<tr>${model.headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr>`;
    $("reportTableBody").innerHTML = model.rows.length
        ? model.rows.map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${model.headers.length || 1}"><div class="table-empty">No records are available for this report and date range.</div></td></tr>`;
}

// Builds summary values that are useful for the selected report
function reportPrintSummary(type) {
    if (!reportCache) return [];

    if (type === "inventory") {
        const totalStock = reportCache.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const categories = new Set(reportCache.inventory.map(item => item.category).filter(Boolean)).size;
        return [
            ["Active Products", reportCache.inventory.length.toLocaleString()],
            ["Current Total Stock", totalStock.toLocaleString()],
            ["Low / Out of Stock", reportCache.lowStock.length.toLocaleString()],
            ["Categories", categories.toLocaleString()]
        ];
    }

    if (type === "transactions") {
        const addedTypes = new Set(["STOCK_IN", "INITIAL_STOCK"]);
        const removedTypes = new Set(["STOCK_OUT", "PICKUP_OUT", "SALE_OUT"]);
        const added = reportCache.transactions.filter(item => addedTypes.has(item.type)).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const removed = reportCache.transactions.filter(item => removedTypes.has(item.type)).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        return [
            ["Movements", reportCache.transactions.length.toLocaleString()],
            ["Stock Added", added.toLocaleString()],
            ["Stock Removed", removed.toLocaleString()],
            ["Net Change", (added - removed).toLocaleString()]
        ];
    }

    if (type === "sales") {
        const confirmed = reportCache.sales.filter(item => item.status === "Confirmed");
        const unitsSold = confirmed.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
        const productIDs = new Set(confirmed.flatMap(sale => (sale.items || []).map(item => item.productID)).filter(Boolean));
        return [
            ["Sales Transactions", reportCache.sales.length.toLocaleString()],
            ["Confirmed Sales", confirmed.length.toLocaleString()],
            ["Units Sold", unitsSold.toLocaleString()],
            ["Distinct Products Sold", productIDs.size.toLocaleString()]
        ];
    }

    const countStatus = status => reportCache.pickups.filter(item => item.status === status).length;
    return [
        ["Pickup Requests", reportCache.pickups.length.toLocaleString()],
        ["Pending", countStatus("Pending").toLocaleString()],
        ["Completed", countStatus("Completed").toLocaleString()],
        ["Cancelled", countStatus("Cancelled").toLocaleString()]
    ];
}

// Returns the date range text used by the clean print view
function reportPrintPeriod(type) {
    if (type === "inventory") return "Current inventory snapshot";
    const start = reportCache?.period?.start;
    const end = reportCache?.period?.end;
    if (!start && !end) return "All available records";
    return `${start ? fmtDate(start) : "Beginning"} to ${end ? fmtDate(end) : "Present"}`;
}

// Opens a report-only print document so the browser can print it or save it as PDF
function printCurrentReport() {
    const type = $("reportType").value;
    const model = reportTableRows(type);
    const summary = reportPrintSummary(type);
    const generatedBy = profile?.name || currentUser?.displayName || currentUser?.email || "XTECH user";
    const generatedAt = fmtDateTime(reportCache?.generatedAt || new Date().toISOString());
    const period = reportPrintPeriod(type);
    const orientation = ["inventory", "transactions"].includes(type) ? "landscape" : "portrait";
    const safeTitle = `${model.title} - XTECH Automation`;
    const tableBody = model.rows.length
        ? model.rows.map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${model.headers.length || 1}" class="empty">No records are available for this report and date range.</td></tr>`;

    const frame = document.createElement("iframe");
    frame.className = "report-print-frame";
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);

    const printDocument = frame.contentDocument;
    printDocument.open();
    printDocument.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(safeTitle)}</title>
<style>
  @page { size: ${orientation}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #2563eb; }
  .brand { margin: 0; font-size: 19px; font-weight: 800; }
  .brand span { color: #2563eb; }
  .company { margin: 3px 0 0; color: #4b5563; font-size: 10px; }
  .meta { min-width: 220px; text-align: right; color: #4b5563; font-size: 9px; }
  .meta strong { color: #111827; }
  .report-heading { margin: 18px 0 4px; font-size: 17px; }
  .period { margin: 0 0 13px; color: #4b5563; }
  .summary { display: grid; grid-template-columns: repeat(${Math.min(4, Math.max(1, summary.length))}, 1fr); gap: 8px; margin-bottom: 14px; }
  .summary-item { padding: 9px 10px; border: 1px solid #d1d5db; border-radius: 7px; background: #f9fafb; }
  .summary-item span { display: block; margin-bottom: 3px; color: #6b7280; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .summary-item strong { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { padding: 6px 6px; border: 1px solid #d1d5db; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #eef2f7; font-size: 8.5px; text-align: left; font-weight: 800; }
  td { font-size: 8.5px; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .empty { padding: 22px; text-align: center; color: #6b7280; }
  .footer { margin-top: 12px; padding-top: 8px; border-top: 1px solid #d1d5db; display: flex; justify-content: space-between; gap: 16px; color: #6b7280; font-size: 8px; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="brand">XTECH <span>Automation</span></h1>
      <p class="company">AGB XTECH Industrial Sales</p>
    </div>
    <div class="meta">
      <div><strong>Generated:</strong> ${esc(generatedAt)}</div>
      <div><strong>Generated by:</strong> ${esc(generatedBy)}</div>
      <div><strong>Rows:</strong> ${model.rows.length.toLocaleString()}</div>
    </div>
  </div>
  <h2 class="report-heading">${esc(model.title)}</h2>
  <p class="period">${esc(period)}</p>
  <div class="summary">
    ${summary.map(([label, value]) => `<div class="summary-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}
  </div>
  <table>
    <thead><tr>${model.headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead>
    <tbody>${tableBody}</tbody>
  </table>
  <div class="footer">
    <span>Generated by XTECH Automation</span>
    <span>${esc(model.title)} - ${esc(period)}</span>
  </div>
</body>
</html>`);
    printDocument.close();

    const cleanup = () => setTimeout(() => frame.remove(), 500);
    frame.contentWindow.onafterprint = cleanup;
    setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => { if (frame.isConnected) frame.remove(); }, 60000);
    }, 150);
}

$("refreshReports").addEventListener("click", loadReports);
$("reportType").addEventListener("change", renderReportTable);
$("clearReportDates").addEventListener("click", () => { $("reportStart").value = ""; $("reportEnd").value = ""; loadReports(); });

$("exportCurrentCsv").addEventListener("click", async event => {
    try {
        await ensureCurrentReportData();
        const type = $("reportType").value;
        const query = reportQuery();
        pendingRequests++;
        updateLoading();
        const response = await fetch(`/api/reports/csv/${type}${query ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
            let message = "Export failed.";
            try { message = (await response.json()).message || message; } catch {}
            throw new Error(message);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `xtech-${type}-report.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast("Current report exported as CSV");
    } catch (error) {
        toast(error.message);
    } finally {
        pendingRequests = Math.max(0, pendingRequests - 1);
        updateLoading();
    }
});

$("printReport").addEventListener("click", async () => {
    try {
        await ensureCurrentReportData();
        printCurrentReport();
    } catch (error) {
        toast(error.message);
    }
});

// Handles the XTECH AI chat and each user's saved history
const CHAT_GREETING = "Hello! I’m the XTECH Help Assistant. I can guide you through the page you’re viewing or answer questions about XTECH features.";
let chatHistoryLoadedForUid = null;
let aiRequestInProgress = false;

const AI_SECTION_LABELS = {
    dashboard: "Dashboard",
    inventory: "Inventory Management",
    transactions: "Stock Movement History",
    customers: "Customer Management",
    pickups: "Pickup Services",
    sales: "Sales Transactions",
    users: "User Accounts",
    reports: "Reports",
    profile: "My Profile",
    security: "Account & Security"
};

const AI_PAGE_SUGGESTIONS = {
    dashboard: [
        "What does this dashboard show?",
        "What should I check when a product needs attention?",
        "What can I do on this page?"
    ],
    inventory: [
        "How do I add a product?",
        "How do I Stock In or Stock Out?",
        "Why can't I edit quantity directly?"
    ],
    transactions: [
        "What does Stock Movement History show?",
        "How do I find a stock change?",
        "What do the movement types mean?"
    ],
    customers: [
        "How do I edit a customer?",
        "How do I deactivate or activate a customer?",
        "How do I view customer history?"
    ],
    pickups: [
        "How do pickup requests work?",
        "Why can a pickup request be blocked?",
        "When does a pickup deduct stock?"
    ],
    sales: [
        "How do I record a sale?",
        "What happens if there is not enough stock?",
        "How are sold quantities recorded?"
    ],
    users: [
        "How do I create a staff account?",
        "Which staff roles can I create?",
        "What can each role access?"
    ],
    reports: [
        "How do I save a report as PDF?",
        "How do I export the selected report as CSV?",
        "What is included in the printed report?"
    ],
    profile: [
        "How do I update my profile?",
        "Why can't I change my email here?",
        "What profile information can I edit?"
    ],
    security: [
        "How do I change my password?",
        "What if I forgot my password?",
        "How does Email OTP sign-in work?"
    ]
};

// Updates the AI header with the page the user is currently viewing.
function updateAiContextLabel() {
    const label = $("aiContextLabel");
    if (!label) return;
    label.textContent = `Viewing: ${AI_SECTION_LABELS[currentSectionName] || "XTECH Automation"}`;
}

// Shows quick questions that match the currently visible XTECH page.
function renderAiQuickActions() {
    const container = $("aiQuickActions");
    if (!container) return;

    const suggestions = AI_PAGE_SUGGESTIONS[currentSectionName] || ["What can I do on this page?"];
    container.innerHTML = "";

    for (const question of suggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ai-suggestion-chip";
        button.textContent = question;
        button.addEventListener("click", () => {
            const input = $("chatInput");
            if (!input) return;
            input.value = question;
            $("chatForm")?.requestSubmit();
        });
        container.appendChild(button);
    }
}

// Prevents multiple AI requests from being sent at the same time.
function setAiQuickActionsDisabled(disabled) {
    document.querySelectorAll(".ai-suggestion-chip").forEach(button => {
        button.disabled = disabled;
    });
}

// Copies an AI answer without copying message labels or interface controls.
async function copyAiAnswer(text, button) {
    const value = String(text || "");
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            const area = document.createElement("textarea");
            area.value = value;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }

        const original = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1200);
    } catch {
        toast("Unable to copy the AI answer");
    }
}

// Converts common Markdown into safe HTML for AI answers
function renderAssistantMarkdown(value) {
    const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);

    const formatInline = value => {
        let text = escapeHtml(value);

        // Formats the Markdown styles used in XTECH AI responses.
        text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
        text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
        text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        text = text.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?;:])/g, "$1<em>$2</em>");
        text = text.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?;:])/g, "$1<em>$2</em>");
        return text;
    };

    const lines = String(value ?? "").replace(/\r\n/g, "\n").split("\n");
    const output = [];
    let listType = null;

    const closeList = () => {
        if (!listType) return;
        output.push(`</${listType}>`);
        listType = null;
    };

    for (const originalLine of lines) {
        const line = originalLine.trim();

        if (!line) {
            closeList();
            continue;
        }

        // Converts Markdown separators into a subtle divider.
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
            closeList();
            output.push('<hr class="ai-divider">');
            continue;
        }

        // Supports normal Markdown headings without showing the # characters.
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            closeList();
            const level = Math.min(5, heading[1].length + 1);
            output.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
            continue;
        }

        // Supports numbered Markdown lists such as "1. Item" and "1) Item".
        const ordered = line.match(/^\d+[.)]\s+(.+)$/);
        if (ordered) {
            if (listType !== "ol") {
                closeList();
                listType = "ol";
                output.push("<ol>");
            }
            output.push(`<li>${formatInline(ordered[1])}</li>`);
            continue;
        }

        // Supports *, -, +, and • as Markdown bullet markers.
        const unordered = line.match(/^(?:[-+*•])\s+(.+)$/);
        if (unordered) {
            if (listType !== "ul") {
                closeList();
                listType = "ul";
                output.push("<ul>");
            }
            output.push(`<li>${formatInline(unordered[1])}</li>`);
            continue;
        }

        closeList();

        // Turns short Note/Tip/Warning lines into a highlighted callout.
        const noteText = line.replace(/^\*(?!\s)/, "").replace(/\*$/, "");
        if (/^(note|important|tip|warning):/i.test(noteText)) {
            output.push(`<div class="ai-note">${formatInline(noteText)}</div>`);
            continue;
        }

        output.push(`<p>${formatInline(line)}</p>`);
    }

    closeList();
    return output.join("");
}

// Adds a message bubble to the AI chat
function addChatMessage(text, who = "assistant") {
    const messages = $("chatMessages");
    if (!messages) return;

    const row = document.createElement("div");
    row.className = `chat-message ${who}`;

    if (who === "assistant") {
        const avatar = document.createElement("div");
        avatar.className = "chat-avatar";
        avatar.textContent = "✦";
        avatar.setAttribute("aria-hidden", "true");
        row.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "chat-message-content";

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const label = document.createElement("div");
    label.className = "chat-message-label";
    label.textContent = who === "assistant" ? "XTECH AI" : "You";
    meta.appendChild(label);

    if (who === "assistant") {
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "chat-copy-btn";
        copyButton.textContent = "Copy";
        copyButton.addEventListener("click", () => copyAiAnswer(text, copyButton));
        meta.appendChild(copyButton);
    }

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    if (who === "assistant") {
        bubble.innerHTML = renderAssistantMarkdown(text);
    } else {
        bubble.textContent = text;
    }

    content.appendChild(meta);
    content.appendChild(bubble);
    row.appendChild(content);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
}

// Shows a small typing indicator while the assistant is generating a response.
function showAiTyping() {
    if ($("aiTypingIndicator")) return;
    const messages = $("chatMessages");
    if (!messages) return;

    const row = document.createElement("div");
    row.id = "aiTypingIndicator";
    row.className = "chat-message assistant";
    row.innerHTML = `
        <div class="chat-avatar" aria-hidden="true">✦</div>
        <div class="chat-message-content">
            <div class="chat-message-meta"><div class="chat-message-label">XTECH AI</div></div>
            <div class="chat-bubble ai-typing-bubble" aria-label="XTECH AI is typing">
                <span></span><span></span><span></span>
            </div>
        </div>`;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
}

function hideAiTyping() {
    $("aiTypingIndicator")?.remove();
}

// Clears the visible chat and shows the greeting
function resetChatPanel() {
    chatHistoryLoadedForUid = null;
    const panel = $("aiChatPanel");
    if (panel) panel.classList.add("hidden");
    const messages = $("chatMessages");
    if (!messages) return;
    messages.innerHTML = "";
    addChatMessage(CHAT_GREETING, "assistant");
}

// Loads the signed-in user's saved AI chat history
async function loadChatHistory(force = false) {
    const uid = currentUser?.uid;
    if (!uid || !$("chatMessages")) return;
    if (!force && chatHistoryLoadedForUid === uid) return;

    try {
        const result = await api("/api/chat/history", { silent: true });
        const messages = $("chatMessages");
        messages.innerHTML = "";

        if (!Array.isArray(result.messages) || result.messages.length === 0) {
            addChatMessage(CHAT_GREETING, "assistant");
        } else {
            for (const item of result.messages) {
                const who = item.role === "user" ? "user" : "assistant";
                addChatMessage(String(item.text || ""), who);
            }
        }

        chatHistoryLoadedForUid = uid;
    } catch (error) {
        resetChatPanel();
        addChatMessage("I couldn't load your saved conversation history, but you can still start a new chat.", "assistant");
        console.error("Chat history load failed:", error);
    }
}


// Opens the floating AI Help Assistant popup
$("aiBubble")?.addEventListener("click", async () => {
    const panel = $("aiChatPanel");
    if (!panel) return;

    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);

    if (opening) {
        updateAiContextLabel();
        renderAiQuickActions();
        await loadChatHistory();
        $("chatInput")?.focus();
    }
});

// Closes the floating AI Help Assistant popup
$("closeAiChat")?.addEventListener("click", () => {
    $("aiChatPanel")?.classList.add("hidden");
});

// Closes the AI popup when Escape is pressed
document.addEventListener("keydown", event => {
    if (event.key === "Escape") $("aiChatPanel")?.classList.add("hidden");
});

$("chatForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (aiRequestInProgress) return;

    const input = $("chatInput");
    const question = input.value.trim();
    if (!question) return;

    aiRequestInProgress = true;
    setAiQuickActionsDisabled(true);
    addChatMessage(question, "user");
    input.value = "";
    showAiTyping();

    try {
        const result = await busy($("chatSend"), () => api("/api/chat", {
            method: "POST",
            body: JSON.stringify({ message: question, section: currentSectionName }),
            silent: true
        }), "Thinking…");
        addChatMessage(result.reply || "I couldn't produce an answer.", "assistant");
        chatHistoryLoadedForUid = currentUser?.uid || null;
    } catch (error) {
        addChatMessage(error.message || "The XTECH Help Assistant is unavailable.", "assistant");
    } finally {
        hideAiTyping();
        aiRequestInProgress = false;
        setAiQuickActionsDisabled(false);
    }
});

$("chatInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("chatForm")?.requestSubmit();
    }
});

$("clearChat")?.addEventListener("click", async () => {
    if (!currentUser) return;
    if (!window.confirm("Clear your saved AI conversation history? This only clears the current user's chat.")) return;

    try {
        await busy($("clearChat"), () => api("/api/chat/history", {
            method: "DELETE"
        }), "Clearing…");
        resetChatPanel();
        chatHistoryLoadedForUid = currentUser.uid;
        toast("Your AI chat history was cleared");
    } catch (error) {
        toast(error.message || "Unable to clear chat history");
    }
});

// Opens and closes popup windows
// Hides the open popup window
function closeModal() { $("modal").classList.add("hidden"); }
$("modalClose").addEventListener("click", closeModal);
$("modal").addEventListener("click", event => { if (event.target === $("modal")) closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });

showAuthMode("login", { preserveOtpSession: true });
restoreEmailOtpSession();
boot();