// Stores the current user session and data used by the page
let token = "";
let currentUser = null;
let profile = null;
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
if (!window.XTechSharedUtils || !window.XTechApiClient || !window.XTechAuthClient || !window.XTechAppState) {
    throw new Error("XTECH frontend dependencies are missing. Check script loading order.");
}
// Stage 4.42: one store supplies live operational data across extracted UI modules.
const appState = window.XTechAppState.createAppState();
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
    $("loadingOverlay")?.classList.toggle("hidden", appState.getPendingRequests() <= 0);
}

// Both API requests and report CSV transfers share one pending counter.
function changePending(delta) {
    appState.adjustPendingRequests(delta);
    updateLoading();
}
const api = window.XTechApiClient.createApiClient({
    getToken: () => token,
    onPendingChange: changePending
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
    const customer = appState.getCustomers().find(item => item.id === id || item.customerID === id);
    return customer?.name || fallback;
}

// Finds a product from its product ID
function productById(id) {
    return appState.getProducts().find(product => product.productID === id);
}

// Builds product choices for dropdown menus
function productOptions(includeOutOfStock = false) {
    if (!appState.getProducts().length) return '<option value="">No active products available</option>';
    return '<option value="">Select a product</option>' + appState.getProducts().map(product => {
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
        filter.innerHTML = '<option value="">All Products</option>' + appState.getProducts().map(product =>
            `<option value="${esc(product.productID)}">${esc(product.productName)} (${esc(product.productID)})</option>`
        ).join("");
        if ([...filter.options].some(option => option.value === previous)) filter.value = previous;
    }
}

// Builds customer choices for dropdown menus
function customerOptions(includeWalkIn = true) {
    const active = appState.getCustomers().filter(customer => customer.active !== false);
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
    const requests = [api("/api/products", { silent: true }).then(data => { appState.setProducts(data.products || []); updateProductSelectors(); })];
    if (needCustomers && profile?.role !== "customer") {
        requests.push(api("/api/customers", { silent: true }).then(data => { appState.setCustomers(data.customers || []); updateCustomerSelectors(); }));
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

// Stage 4.41: shared page shell owns navigation, role visibility, theme, and modal controls.
if (!window.XTechAppShellUi) throw new Error("XTECH application shell is missing. Check script order.");
const appShellUi = window.XTechAppShellUi.createAppShellUi({
    $, document, window, localStorage, requestAnimationFrame,
    getProfile: () => profile,
    getToken: () => token,
    setCurrentSectionName: name => { currentSectionName = name; },
    updateAiContextLabel, renderAiQuickActions,
    hasDashboardCharts: () => dashboardUi.hasCharts(),
    loadDashboard, loadInventory, loadTransactions, loadCustomers,
    loadPickups, loadNotifications, loadSales, loadUsers, loadReports,
    loadProfile, loadSecurity
});
function showSection(name) { return appShellUi.showSection(name); }
function applyRole() { return appShellUi.applyRole(); }
function closeModal() { return appShellUi.closeModal(); }

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

// Stage 4.39: notification UI handles message display, read flags, and polling.
async function loadNotifications(options) { return notificationUi.loadNotifications(options); }
function startNotificationPolling() { return notificationUi.startNotificationPolling(); }

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
    getProducts: appState.getProducts,
    setProducts: appState.setProducts,
    getTransactions: appState.getTransactions,
    setTransactions: appState.setTransactions,
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
    fmtDate, getCustomers: appState.getCustomers, setCustomers: appState.setCustomers,
    confirm, document, window
});
const pickupUi = window.XTechPickupUi.createPickupUi({
    $, api, toast, setMessage, busy, esc, badge, todayYMD, within, fmtDateTime, fmtDate,
    validateFutureDate, validateText, validatePositiveWholeNumber, getProfile: () => profile,
    productById, customerNameFor, itemSummary, ensureFormData, mergeFormItem,
    updateProductSelectors, updateCustomerSelectors, loadDashboard, loadInventory,
    loadTransactions, setProducts: appState.setProducts,
    getPickups: appState.getPickups, setPickups: appState.setPickups,
    getPickupFormItems: appState.getPickupFormItems, setPickupFormItems: appState.setPickupFormItems,
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
    onPendingChange: changePending,
    document, fetch: (...args) => fetch(...args), URL, URLSearchParams, setTimeout
});
async function loadReports() { return reportsUi.loadReports(); }

// Stage 4.40: AI Assistant UI keeps chat state private; session/page identity stays in app.js.
if (!window.XTechAiAssistantUi) throw new Error("XTECH AI Assistant UI module is missing. Check script order.");
const aiAssistantUi = window.XTechAiAssistantUi.createAiAssistantUi({
    $, api, toast, busy, document, window, navigator, setTimeout, console,
    getCurrentUser: () => currentUser, getCurrentSectionName: () => currentSectionName
});
function updateAiContextLabel() { return aiAssistantUi.updateAiContextLabel(); }
function renderAiQuickActions() { return aiAssistantUi.renderAiQuickActions(); }
function resetChatPanel() { return aiAssistantUi.resetChatPanel(); }

// Stage 4.39: customer notification UI is registered before the app boots.
if (!window.XTechNotificationUi) throw new Error("XTECH notification UI module is missing. Check script order.");
const notificationUi = window.XTechNotificationUi.createNotificationUi({
    $, api, toast, esc, fmtDateTime, getProfile: () => profile, showSection,
    document, setInterval, clearInterval
});

showAuthMode("login", { preserveOtpSession: true });
restoreEmailOtpSession();
boot();