// Stores the current user session and data used by the page
let token = "";
let currentUser = null;
let profile = null;
let products = [];
let transactions = [];
let customers = [];
let pickups = [];
let pickupFormItems = [];
let pendingRequests = 0;
let currentSectionName = "dashboard";
let appConfig = {};

// Stores Firebase modular authentication helpers and temporary MFA state
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

// Finds an element by its ID
const $ = id => document.getElementById(id);

// Frontend service modules must load before the UI application starts.
if (!window.XTechSharedUtils || !window.XTechApiClient || !window.XTechAuthClient) {
    throw new Error("XTECH frontend dependencies are missing. Check script loading order.");
}
const {
    esc,
    fmtDateTime,
    fmtDate,
    todayYMD,
    within,
    validationError,
    validateName,
    validateEmail,
    validatePhone,
    validateText,
    validatePassword,
    validateNewPassword,
    validateProductID,
    validateProductName,
    validateCategory,
    validatePositiveWholeNumber,
    validateFutureDate
} = window.XTechSharedUtils;

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

// Shared API client reads the current token and updates the existing loading overlay.
const api = window.XTechApiClient.createApiClient({
    getToken: () => token,
    onPendingChange: delta => {
        pendingRequests = Math.max(0, pendingRequests + delta);
        updateLoading();
    }
});

// Firebase SDK bootstrapping and OTP persistence are independent of UI event handlers.
const firebaseClient = window.XTechAuthClient.createFirebaseAuthClient({ request: api });
const emailOtpStore = window.XTechAuthClient.createEmailOtpStore({
    key: EMAIL_OTP_SESSION_KEY
});

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

// Inventory product selectors still delegate pickup quantity checks to the pickup UI.
function syncPickupQuantityLimit() { return pickupUi.syncPickupQuantityLimit(); }

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
    if (name === "notifications") loadNotifications({ silent: true });
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
        customer: ["pickups", "notifications", "profile", "security"]
    };
    const allowed = new Set(allowedSections[role] || []);
    document.querySelectorAll(".nav").forEach(nav => nav.style.display = allowed.has(nav.dataset.section) ? "" : "none");
    document.querySelectorAll(".admin-only, .admin-only-section").forEach(element => element.style.display = role === "admin" ? "" : "none");
    document.querySelectorAll(".customer-only, .customer-only-section").forEach(element => element.style.display = role === "customer" ? "" : "none");
    $("notificationCenter")?.classList.toggle("hidden", role !== "customer");

    if ($("pickupCustomerField")) $("pickupCustomerField").style.display = role === "customer" ? "none" : "";
    if ($("pickupCustomerHelp")) {
        $("pickupCustomerHelp").textContent = role === "customer"
            ? "This request will automatically be linked to your customer profile."
            : "Select a registered customer when applicable. Walk-in requests can use “Walk-in / No registered customer”.";
    }
}

// Initializes the shared Firebase client and keeps the existing UI-facing state.
async function initFirebase() {
    const result = await firebaseClient.initFirebase();
    firebaseAuthApi = result.firebaseApi;
    firebaseAuthInstance = result.auth;
    appConfig = result.config;
    return result.auth;
}

// Stage 4.39: auth UI has private handlers; app.js retains session and Firebase initialization.
// Auth flow state is shared with the isolated UI through explicit getters/setters.
const authUiState = {
  get selectedSignInMethod() { return selectedSignInMethod; },
  set selectedSignInMethod(value) { selectedSignInMethod = value; },
  get authFlowInProgress() { return authFlowInProgress; },
  set authFlowInProgress(value) { authFlowInProgress = value; },
  get pendingMfaResolver() { return pendingMfaResolver; },
  set pendingMfaResolver(value) { pendingMfaResolver = value; },
  get pendingMfaHint() { return pendingMfaHint; },
  set pendingMfaHint(value) { pendingMfaHint = value; },
  get pendingTotpSecret() { return pendingTotpSecret; },
  set pendingTotpSecret(value) { pendingTotpSecret = value; },
  get pendingEmailOtpEmail() { return pendingEmailOtpEmail; },
  set pendingEmailOtpEmail(value) { pendingEmailOtpEmail = value; },
  get pendingEmailOtpMaskedEmail() { return pendingEmailOtpMaskedEmail; },
  set pendingEmailOtpMaskedEmail(value) { pendingEmailOtpMaskedEmail = value; },
  get emailOtpResendAvailableAt() { return emailOtpResendAvailableAt; },
  set emailOtpResendAvailableAt(value) { emailOtpResendAvailableAt = value; },
  get emailOtpExpiresAt() { return emailOtpExpiresAt; },
  set emailOtpExpiresAt(value) { emailOtpExpiresAt = value; },
  get emailOtpCountdownTimer() { return emailOtpCountdownTimer; },
  set emailOtpCountdownTimer(value) { emailOtpCountdownTimer = value; }
};

function showAuthMode(mode, options) { return authUi.showAuthMode(mode, options); }
function restoreEmailOtpSession() { return authUi.restoreEmailOtpSession(); }

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
    } catch {
        // Ignores storage errors if the browser blocks local storage.
    }

    // Forces the new theme to render before transitions are enabled again
    void document.body.offsetHeight;

    requestAnimationFrame(() => {
        document.body.classList.remove("theme-switching");
    });

    // Redraws the charts after the theme changes
    if (token && dashboardUi.hasCharts()) loadDashboard();
}

// Stage 4.39: notification UI handles message display, read flags, and polling.
async function loadNotifications(options) { return notificationUi.loadNotifications(options); }
function startNotificationPolling() { return notificationUi.startNotificationPolling(); }

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
    } catch {
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
    if (profile.role === "customer") {
        await loadNotifications({ silent: true });
        startNotificationPolling();
    }
}

// Returns the page to the signed-out state
function showSignedOutState() {
    token = "";
    currentUser = null;
    profile = null;
    notificationUi.resetNotifications();
    resetPasswordChangeMfa();
    resetChatPanel();
    $("loginScreen").classList.remove("hidden");
    $("app").classList.add("hidden");
}

// Stage 4.39: TOTP challenge and enrollment screens are managed by auth-ui.js.

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

// Stage 4.39: keep theme, session, logout and navigation orchestration in app.js.
window.addEventListener("DOMContentLoaded", initTheme);
if (!window.XTechAuthUi) throw new Error("XTECH auth UI module is missing. Check script order.");
const authUi = window.XTechAuthUi.createAuthUi({
    $, api, toast, setMessage, busy, validateName, validateEmail, validatePhone,
    validateText, validatePassword, validationError, emailOtpStore, state: authUiState,
    initFirebase, finishSignedInUser,
    getFirebaseAuthApi: () => firebaseAuthApi,
    getFirebaseAuthInstance: () => firebaseAuthInstance,
    getAppConfig: () => appConfig, document, window, setInterval, clearInterval
});
$("logoutBtn").addEventListener("click", () => firebaseAuthApi.signOut(firebaseAuthInstance));
document.querySelectorAll(".nav").forEach(nav => nav.addEventListener("click", () => showSection(nav.dataset.section)));

// Connects the inventory UI to existing shared application data and API services.
if (!window.XTechInventoryUi) {
    throw new Error("XTECH inventory UI is missing. Check script loading order.");
}
const inventoryUi = window.XTechInventoryUi.createInventoryUi({
    $,
    api,
    toast,
    setMessage,
    busy,
    esc,
    badge,
    stockStatus,
    productById,
    updateProductSelectors,
    validateProductID,
    validateProductName,
    validateCategory,
    validateText,
    validatePositiveWholeNumber,
    validationError,
    closeModal,
    loadDashboard,
    ensureFormData,
    within,
    movementTypeLabel,
    fmtDateTime,
    getProducts: () => products,
    setProducts: value => { products = value; },
    getTransactions: () => transactions,
    setTransactions: value => { transactions = value; },
    getProfile: () => profile,
    confirm
});
async function loadInventory() { return inventoryUi.loadInventory(); }
async function loadTransactions() { return inventoryUi.loadTransactions(); }

// Customer history and sales reuse the same summary helper.
// Creates a short readable list of products and quantities
function itemSummary(items = []) {
    return items.length ? items.map(item => `${esc(item.productName || productById(item.productID)?.productName || item.productID)} × ${Number(item.quantity)}`).join("<br>") : "—";
}

// Customer and pickup modules register UI events without changing application state ownership.
if (!window.XTechCustomerUi || !window.XTechPickupUi) {
    throw new Error("XTECH customer or pickup UI module is missing. Check script loading order.");
}
const customerUi = window.XTechCustomerUi.createCustomerUi({
    $, api, toast, setMessage, busy, esc, badge, validateName, validateEmail, validatePhone,
    validateText, closeModal, loadDashboard, updateCustomerSelectors, itemSummary, fmtDateTime,
    fmtDate, getCustomers: () => customers, setCustomers: value => { customers = value; },
    confirm, document, window
});
const pickupUi = window.XTechPickupUi.createPickupUi({
    $, api, toast, setMessage, busy, esc, badge, todayYMD, within, fmtDateTime, fmtDate,
    validateFutureDate, validateText, validatePositiveWholeNumber, getProfile: () => profile,
    productById, customerNameFor, itemSummary, ensureFormData, mergeFormItem,
    updateProductSelectors, updateCustomerSelectors, loadDashboard, loadInventory,
    loadTransactions, setProducts: value => { products = value; },
    getPickups: () => pickups, setPickups: value => { pickups = value; },
    getPickupFormItems: () => pickupFormItems, setPickupFormItems: value => { pickupFormItems = value; },
    confirm, window
});
async function loadCustomers() { return customerUi.loadCustomers(); }
async function loadPickups() { return pickupUi.loadPickups(); }

// Stage 4.37: register sales handlers, preserving existing API and shared refresh functions.
if (!window.XTechSalesUi) throw new Error("XTECH sales UI module is missing. Check script order.");
const salesUi = window.XTechSalesUi.createSalesUi({
    $, api, toast, setMessage, busy, esc, badge, within, fmtDateTime, customerNameFor,
    itemSummary, productById, validatePositiveWholeNumber, mergeFormItem, validateText,
    updateCustomerSelectors, updateProductSelectors, loadInventory, loadTransactions, loadDashboard,
    ensureFormData, confirm, window
});
async function loadSales() { return salesUi.loadSales(); }

// Stage 4.38: isolated staff account UI; app.js retains session ownership.
if (!window.XTechStaffUi) throw new Error("XTECH staff UI module is missing. Check script order.");
const staffUi = window.XTechStaffUi.createStaffUi({
    $, api, toast, setMessage, busy, esc, badge, roleDisplayName,
    validateName, validateEmail, validatePassword, validationError,
    getCurrentUser: () => currentUser, confirm, window
});
async function loadUsers() { return staffUi.loadUsers(); }

// Stage 4.38: account security uses fresh authentication state via getters.
if (!window.XTechSecurityUi) throw new Error("XTECH security UI module is missing. Check script order.");
const securityUi = window.XTechSecurityUi.createSecurityUi({
    $, toast, setMessage, busy, roleDisplayName, validationError,
    validateText, validateNewPassword,
    getCurrentUser: () => currentUser, getProfile: () => profile,
    getFirebaseAuthApi: () => firebaseAuthApi, getFirebaseAuthInstance: () => firebaseAuthInstance
});
function loadSecurity() { return securityUi.loadSecurity(); }
function resetPasswordChangeMfa() { return securityUi.resetPasswordChangeMfa(); }

// Stage 4.38: customer profile UI; API and authenticated session remain shared.
if (!window.XTechProfileUi) throw new Error("XTECH profile UI module is missing. Check script order.");
const profileUi = window.XTechProfileUi.createProfileUi({
    $, api, toast, setMessage, busy, validateName, validatePhone, validateText,
    getCurrentUser: () => currentUser
});
async function loadProfile() { return profileUi.loadProfile(); }

// Stage 4.37: dashboard owns its Chart.js instances and refresh action.
if (!window.XTechDashboardUi) throw new Error("XTECH dashboard UI module is missing. Check script order.");
const dashboardUi = window.XTechDashboardUi.createDashboardUi({
    $, api, toast, esc, badge, stockStatus, document,
    makeChart: (element, options) => new Chart(element, options)
});
async function loadDashboard() { return dashboardUi.loadDashboard(); }

// Stage 4.37: reports maintain a private cache and share the app's loading counter.
if (!window.XTechReportsUi) throw new Error("XTECH reports UI module is missing. Check script order.");
const reportsUi = window.XTechReportsUi.createReportsUi({
    $, api, toast, esc, fmtDateTime, fmtDate, stockStatus, movementTypeLabel,
    getProfile: () => profile, getCurrentUser: () => currentUser, getToken: () => token,
    onPendingChange: delta => {
        pendingRequests = Math.max(0, pendingRequests + delta);
        updateLoading();
    },
    document, fetch: (...args) => fetch(...args), URL, URLSearchParams, setTimeout
});
async function loadReports() { return reportsUi.loadReports(); }

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

// Stage 4.39: customer notification UI is registered before the app boots.
if (!window.XTechNotificationUi) throw new Error("XTECH notification UI module is missing. Check script order.");
const notificationUi = window.XTechNotificationUi.createNotificationUi({
    $, api, toast, esc, fmtDateTime, getProfile: () => profile, showSection,
    document, setInterval, clearInterval
});

showAuthMode("login", { preserveOtpSession: true });
restoreEmailOtpSession();
boot();