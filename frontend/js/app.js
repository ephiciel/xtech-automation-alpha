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
let notifications = [];
let notificationPollTimer = null;
let lastNotificationUnreadCount = 0;

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

// Stores the email OTP screen state so a page refresh does not reset the resend countdown
function saveEmailOtpSession() {
    if (!pendingEmailOtpEmail || !emailOtpExpiresAt) return;
    emailOtpStore.save({
        email: pendingEmailOtpEmail,
        maskedEmail: pendingEmailOtpMaskedEmail,
        resendAvailableAt: emailOtpResendAvailableAt,
        expiresAt: emailOtpExpiresAt
    });
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
    emailOtpStore.clear();

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
    const saved = emailOtpStore.read();

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

// Returns the current number of unread customer notifications
function notificationUnreadCount() {
    return notifications.filter(item => item.read !== true).length;
}

function notificationIcon(type) {
    if (type === "purchase_recorded") return "✓";
    if (type === "pickup_approved") return "⇄";
    if (type === "pickup_completed") return "✓";
    return "•";
}

function notificationItemHtml(item) {
    const id = item.id || item.notificationID || "";
    const unread = item.read !== true;
    const reference = item.relatedId
        ? `<span class="notification-reference">Reference: ${esc(item.relatedId)}</span>`
        : "";
    return `<button type="button" class="notification-item ${unread ? "unread" : "read"}" data-notification-id="${esc(id)}">
        <span class="notification-item-icon" aria-hidden="true">${notificationIcon(item.type)}</span>
        <span class="notification-item-body">
            <span class="notification-item-title">${esc(item.title || "XTECH notification")}</span>
            <span class="notification-item-message">${esc(item.message || "")}</span>
            <span class="notification-item-meta">${esc(fmtDateTime(item.createdAt))}${reference}</span>
        </span>
        ${unread ? '<span class="notification-unread-dot" aria-label="Unread"></span>' : ""}
    </button>`;
}

function bindNotificationItems(container) {
    if (!container) return;
    container.querySelectorAll("[data-notification-id]").forEach(button => {
        button.addEventListener("click", async () => {
            const id = button.dataset.notificationId;
            if (!id) return;
            await markNotificationRead(id);
        });
    });
}

function renderNotifications() {
    const unread = notificationUnreadCount();
    const badge = $("notificationBadge");
    if (badge) {
        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.classList.toggle("hidden", unread === 0);
    }

    if ($("notificationMenuSummary")) {
        $("notificationMenuSummary").textContent = unread
            ? `${unread} unread notification${unread === 1 ? "" : "s"}`
            : "No unread notifications";
    }

    const menuList = $("notificationMenuList");
    if (menuList) {
        const recent = notifications.slice(0, 5);
        menuList.innerHTML = recent.length
            ? recent.map(notificationItemHtml).join("")
            : '<div class="notification-empty">No notifications yet.</div>';
        bindNotificationItems(menuList);
    }

    const pageList = $("notificationPageList");
    if (pageList) {
        pageList.innerHTML = notifications.length
            ? notifications.map(notificationItemHtml).join("")
            : '<div class="notification-empty">No purchase or pickup notifications yet.</div>';
        bindNotificationItems(pageList);
    }
}

async function loadNotifications({ silent = false, announce = false } = {}) {
    if (profile?.role !== "customer") return;
    try {
        const previousUnread = lastNotificationUnreadCount;
        const data = await api("/api/notifications", { silent });
        notifications = data.notifications || [];
        const unread = notificationUnreadCount();
        renderNotifications();

        if (announce && unread > previousUnread) {
            const added = unread - previousUnread;
            toast(added === 1 ? "You have a new notification." : `You have ${added} new notifications.`);
        }
        lastNotificationUnreadCount = unread;
    } catch (error) {
        if (!silent) toast(error.message || "Unable to load notifications.");
    }
}

async function markNotificationRead(id) {
    const item = notifications.find(notification => (notification.id || notification.notificationID) === id);
    if (!item || item.read === true) return;
    try {
        await api(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", silent: true });
        item.read = true;
        item.readAt = new Date().toISOString();
        lastNotificationUnreadCount = notificationUnreadCount();
        renderNotifications();
    } catch (error) {
        toast(error.message || "Unable to update notification.");
    }
}

async function markAllNotificationsRead() {
    if (!notifications.some(item => item.read !== true)) return;
    try {
        await api("/api/notifications/read-all", { method: "PATCH", silent: true });
        const readAt = new Date().toISOString();
        notifications.forEach(item => {
            item.read = true;
            item.readAt = readAt;
        });
        lastNotificationUnreadCount = 0;
        renderNotifications();
        toast("All notifications marked as read");
    } catch (error) {
        toast(error.message || "Unable to mark notifications as read.");
    }
}

function closeNotificationMenu() {
    $("notificationMenu")?.classList.add("hidden");
    $("notificationBell")?.setAttribute("aria-expanded", "false");
}

function stopNotificationPolling() {
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = null;
}

function startNotificationPolling() {
    stopNotificationPolling();
    if (profile?.role !== "customer") return;
    notificationPollTimer = setInterval(() => {
        if (!document.hidden) loadNotifications({ silent: true, announce: true });
    }, 30000);
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
    notifications = [];
    lastNotificationUnreadCount = 0;
    stopNotificationPolling();
    closeNotificationMenu();
    renderNotifications();
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
        const auth = await initFirebase();
        const credential = await busy(event.submitter, () => firebaseAuthApi.signInWithEmailAndPassword(auth, email, password), "Signing In…");

        const factors = firebaseAuthApi.multiFactor(credential.user).enrolledFactors;
        const hasTotp = factors.some(factor => factor.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID);

        const adminMfaBypass =
            appConfig.adminMfaBypass === true &&
            credential.user.email?.toLowerCase() === appConfig.adminEmail?.toLowerCase();

        if (!hasTotp && !adminMfaBypass) {
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

        const auth = await initFirebase();
        const credential = await firebaseAuthApi.signInWithCustomToken(auth, result.customToken);
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

$("notificationBell")?.addEventListener("click", event => {
    event.stopPropagation();
    const menu = $("notificationMenu");
    if (!menu) return;
    const opening = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !opening);
    $("notificationBell")?.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) loadNotifications({ silent: true });
});

$("notificationMenu")?.addEventListener("click", event => event.stopPropagation());
$("markAllNotificationsReadTop")?.addEventListener("click", markAllNotificationsRead);
$("markAllNotificationsRead")?.addEventListener("click", markAllNotificationsRead);
$("refreshNotifications")?.addEventListener("click", () => loadNotifications());
$("viewAllNotifications")?.addEventListener("click", () => {
    closeNotificationMenu();
    showSection("notifications");
});
document.addEventListener("click", closeNotificationMenu);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && profile?.role === "customer") loadNotifications({ silent: true, announce: true });
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeNotificationMenu();
});

showAuthMode("login", { preserveOtpSession: true });
restoreEmailOtpSession();
boot();