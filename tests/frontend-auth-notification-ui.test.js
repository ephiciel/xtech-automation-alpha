"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const authCode = read("frontend/js/auth-ui.js");
const notificationCode = read("frontend/js/notification-ui.js");
const appCode = read("frontend/js/app.js");
const html = read("frontend/index.html");

function harness({
    role = "customer",
    apiOverrides = {},
    currentUser = null,
    appConfig = {}
} = {}) {
    const elements = new Map();
    const calls = [];
    const messages = [];
    const toasts = [];
    const saved = [];
    const sessions = [];
    const finish = [];
    const timers = new Map();
    const docHandlers = {};
    const win = {};
    let intervalId = 0;
    let session = null;
    let authUser = currentUser;
    let activeRole = role;
    let signedOut = 0;
    const classList = () => ({
        _classes: new Set(),
        add(name) {
            this._classes.add(name);
        },
        remove(name) {
            this._classes.delete(name);
        },
        contains(name) {
            return this._classes.has(name);
        },
        toggle(name, on) {
            const enabled = on === undefined ? !this.contains(name) : Boolean(on);
            if (enabled) this.add(name);
            else this.remove(name);
            return enabled;
        }
    });
    const $ = (id) => {
        if (!elements.has(id)) {
            const handlers = {};
            elements.set(id, {
                handlers,
                value: "",
                textContent: "",
                innerHTML: "",
                disabled: false,
                type: "password",
                dataset: {},
                classList: classList(),
                setAttribute(name, value) {
                    this[name] = value;
                },
                addEventListener(name, callback) {
                    handlers[name] = callback;
                },
                querySelectorAll() {
                    return [];
                },
                focus() {
                    this.focused = true;
                },
                reset() {
                    this.wasReset = true;
                }
            });
        }
        return elements.get(id);
    };
    const document = {
        hidden: false,
        addEventListener(name, callback) {
            docHandlers[name] = callback;
        },
        querySelector(query) {
            if (query.startsWith("[data-target=")) return $("passwordToggle");
            return null;
        }
    };
    const window = win;
    const globals = { window, document, setInterval, clearInterval };
    vm.runInNewContext(authCode, globals, { filename: "auth-ui.js" });
    vm.runInNewContext(notificationCode, globals, { filename: "notification-ui.js" });
    const state = {
        selectedSignInMethod: "password-totp",
        authFlowInProgress: false,
        pendingMfaResolver: null,
        pendingMfaHint: null,
        pendingTotpSecret: null,
        pendingEmailOtpEmail: "",
        pendingEmailOtpMaskedEmail: "",
        emailOtpResendAvailableAt: 0,
        emailOtpExpiresAt: 0,
        emailOtpCountdownTimer: null
    };
    function setInterval(fn, interval) {
        const id = ++intervalId;
        timers.set(id, { fn, interval });
        return id;
    }
    function clearInterval(id) {
        timers.delete(id);
    }
    const auth = { currentUser: authUser };
    const apiClient = {
        multiFactor(user) {
            return {
                enrolledFactors: user?.factors || [],
                async getSession() {
                    return "firebase-session";
                },
                async enroll(assertion) {
                    sessions.push(assertion);
                }
            };
        },
        TotpMultiFactorGenerator: {
            FACTOR_ID: "totp",
            generateSecret: async () => ({
                secretKey: "TEST-KEY",
                generateQrCodeUrl: () => "otpauth://test"
            }),
            assertionForSignIn: (uid, code) => ({ uid, code }),
            assertionForEnrollment: (secret, code) => ({ secret, code })
        },
        async signInWithEmailAndPassword(_auth, email) {
            calls.push({ url: "firebase-sign-in", email });
            const override = apiOverrides["firebase-sign-in"];
            if (override instanceof Error) throw override;
            const user = override?.user || {
                uid: "abc",
                email,
                emailVerified: true,
                factors: [{ factorId: "totp" }]
            };
            auth.currentUser = user;
            return { user };
        },
        async signInWithCustomToken(_auth, token) {
            calls.push({ url: "firebase-custom-token", token });
            const user = { uid: "custom-user", email: "test@example.com" };
            auth.currentUser = user;
            return { user };
        },
        async sendPasswordResetEmail(_auth, email) {
            calls.push({ url: "firebase-reset", email });
        },
        async signOut() {
            signedOut++;
            auth.currentUser = null;
        },
        async sendEmailVerification(user) {
            calls.push({ url: "firebase-email-verification", email: user.email });
        },
        async updatePassword() {},
        getMultiFactorResolver(_auth, error) {
            return error.resolver;
        }
    };
    const api = async (url, opts = {}) => {
        calls.push({ url, opts });
        const response = apiOverrides[url];
        if (response instanceof Error) throw response;
        if (typeof response === "function") return response(url, opts);
        if (response !== undefined) return response;
        if (url.endsWith("/email-otp/request"))
            return {
                maskedEmail: "t***@example.com",
                resendAfterSeconds: 40,
                expiresInSeconds: 600
            };
        if (url.endsWith("/email-otp/verify")) return { customToken: "token-1" };
        if (url.endsWith("/register-customer"))
            return {
                maskedEmail: "n***@example.com",
                resendAfterSeconds: 45,
                expiresInSeconds: 600
            };
        if (url === "/api/notifications") return { notifications: [] };
        return {};
    };
    const validationError = (message) => {
        throw new Error(message);
    };
    const deps = {
        $,
        api,
        toast: (message) => toasts.push(message),
        setMessage: (id, message, kind = "error") => messages.push({ id, message, kind }),
        busy: async (_button, fn) => fn(),
        validateName: (value) => String(value || "").trim(),
        validateEmail: (value) => {
            const value2 = String(value || "")
                .trim()
                .toLowerCase();
            if (!value2.includes("@")) validationError("Invalid email");
            return value2;
        },
        validatePhone: (value) => String(value || ""),
        validateText: (value) => String(value || ""),
        validatePassword: (value) => String(value || ""),
        validationError,
        emailOtpStore: {
            save(data) {
                session = { ...data };
                saved.push({ ...data });
            },
            read() {
                return session;
            },
            clear() {
                session = null;
            }
        },
        state,
        initFirebase: async () => auth,
        finishSignedInUser: async (user) => {
            finish.push(user);
        },
        getFirebaseAuthApi: () => apiClient,
        getFirebaseAuthInstance: () => auth,
        getAppConfig: () => appConfig,
        document,
        window,
        setInterval,
        clearInterval,
        esc: (value) =>
            String(value ?? "").replace(
                /[&<>"']/g,
                (char) =>
                    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]
            ),
        fmtDateTime: (value) => String(value),
        getProfile: () => ({ role: activeRole }),
        showSection: (value) => {
            calls.push({ url: "show-section", value });
        }
    };
    const authUi = window.XTechAuthUi.createAuthUi(deps);
    const notificationUi = window.XTechNotificationUi.createNotificationUi(deps);
    async function emit(id, name, event = {}) {
        const handler = $(id).handlers[name];
        assert.equal(typeof handler, "function", `${id}.${name} not wired`);
        await handler({
            preventDefault() {},
            stopPropagation() {},
            submitter: $("submitter"),
            currentTarget: $(id),
            target: $(id),
            ...event
        });
    }
    return {
        authUi,
        notificationUi,
        $,
        state,
        calls,
        messages,
        toasts,
        saved,
        finish,
        timers,
        docHandlers,
        emit,
        apiClient,
        auth,
        setSession(value) {
            session = value;
        },
        setRole(value) {
            activeRole = value;
        },
        getSignouts: () => signedOut
    };
}

// Module registration / source integration.
test("auth and notification factories register independent frozen APIs", () => {
    const h = harness();
    assert.ok(Object.isFrozen(h.authUi));
    assert.ok(Object.isFrozen(h.notificationUi));
    assert.equal(typeof h.authUi.restoreEmailOtpSession, "function");
    assert.equal(typeof h.notificationUi.resetNotifications, "function");
});
test("HTML loads authentication and notifications before app, after profile", () => {
    const order = ["profile-ui.js", "auth-ui.js", "notification-ui.js", "app.js"].map((name) =>
        html.indexOf(`<script src="js/${name}"></script>`)
    );
    assert.ok(order.every((pos, i) => pos >= 0 && (i === 0 || pos > order[i - 1])));
});
test("app keeps Firebase session ownership and delegates notification reset", () => {
    assert.match(appCode, /async function finishSignedInUser\(/);
    assert.match(appCode, /function showSignedOutState\(/);
    assert.match(appCode, /notificationUi\.resetNotifications\(\)/);
    assert.match(appCode, /XTechAuthUi\.createAuthUi/);
    assert.match(appCode, /XTechNotificationUi\.createNotificationUi/);
});
test("login/register tabs and email-code mode keep original visibility and labels", () => {
    const h = harness();
    h.authUi.showAuthMode("register");
    assert.equal(h.$("registerForm").classList.contains("hidden"), false);
    h.authUi.setSignInMethod("email-otp");
    assert.equal(h.state.selectedSignInMethod, "email-otp");
    assert.equal(h.$("passwordTotpFields").classList.contains("hidden"), true);
    h.authUi.showAuthMode("login", { preserveOtpSession: true });
    assert.equal(h.$("loginForm").classList.contains("hidden"), false);
});
test("restoring expired OTP clears the stored challenge", () => {
    const h = harness();
    h.setSession({ email: "x@example.com", expiresAt: Date.now() - 1000 });
    assert.equal(h.authUi.restoreEmailOtpSession(), false);
    assert.equal(h.state.pendingEmailOtpEmail, "");
});
test("restoring active OTP preserves challenge and starts resend cooldown", () => {
    const h = harness();
    h.setSession({
        email: "x@example.com",
        maskedEmail: "x***@example.com",
        expiresAt: Date.now() + 60000,
        resendAvailableAt: Date.now() + 10000
    });
    assert.equal(h.authUi.restoreEmailOtpSession(), true);
    assert.equal(h.state.pendingEmailOtpEmail, "x@example.com");
    assert.equal(h.$("emailOtpForm").classList.contains("hidden"), false);
    assert.equal(h.$("resendEmailOtp").disabled, true);
    assert.equal(h.timers.size, 1);
});
test("changing to password method clears a pending OTP session", () => {
    const h = harness();
    h.setSession({ email: "x@example.com", expiresAt: Date.now() + 60000 });
    h.authUi.restoreEmailOtpSession();
    h.authUi.setSignInMethod("password-totp");
    assert.equal(h.state.pendingEmailOtpEmail, "");
    assert.equal(h.timers.size, 0);
});
test("email OTP request keeps original endpoint and masked destination", async () => {
    const h = harness();
    h.authUi.setSignInMethod("email-otp");
    h.$("emailOtpEmail").value = "TEST@example.com";
    await h.emit("loginForm", "submit");
    assert.ok(
        h.calls.some(
            (v) =>
                v.url === "/api/auth/email-otp/request" &&
                JSON.parse(v.opts.body).email === "test@example.com"
        )
    );
    assert.equal(h.state.pendingEmailOtpEmail, "test@example.com");
    assert.equal(h.$("emailOtpForm").classList.contains("hidden"), false);
    assert.ok(h.saved.length > 0);
});
test("OTP verification rejects malformed codes before API request", async () => {
    const h = harness();
    h.state.pendingEmailOtpEmail = "test@example.com";
    h.$("emailOtpCode").value = "ab";
    await h.emit("emailOtpForm", "submit");
    assert.equal(
        h.calls.some((x) => x.url === "/api/auth/email-otp/verify"),
        false
    );
    assert.ok(h.messages.some((m) => m.id === "emailOtpMessage" && m.message.includes("6-digit")));
});
test("verified email code signs in using Firebase custom token and clears state", async () => {
    const h = harness();
    h.state.pendingEmailOtpEmail = "test@example.com";
    h.$("emailOtpCode").value = "123456";
    await h.emit("emailOtpForm", "submit");
    assert.ok(h.calls.some((x) => x.url === "/api/auth/email-otp/verify"));
    assert.ok(h.calls.some((x) => x.url === "firebase-custom-token" && x.token === "token-1"));
    assert.equal(h.finish.length, 1);
    assert.equal(h.state.pendingEmailOtpEmail, "");
});
test("resend refuses cooldown without a second request", async () => {
    const h = harness();
    h.state.pendingEmailOtpEmail = "test@example.com";
    h.state.emailOtpResendAvailableAt = Date.now() + 30000;
    await h.emit("resendEmailOtp", "click");
    assert.equal(h.calls.filter((x) => x.url === "/api/auth/email-otp/request").length, 0);
});
test("cancel OTP resets temporary values without signing in", async () => {
    const h = harness();
    h.state.pendingEmailOtpEmail = "test@example.com";
    await h.emit("cancelEmailOtp", "click");
    assert.equal(h.state.pendingEmailOtpEmail, "");
    assert.equal(h.finish.length, 0);
});
test("password reset uses validated email and Firebase API", async () => {
    const h = harness();
    h.$("loginEmail").value = "RESET@example.com";
    await h.emit("forgotPasswordBtn", "click");
    assert.ok(h.calls.some((x) => x.url === "firebase-reset" && x.email === "reset@example.com"));
});
test("registration rejects password mismatch before posting", async () => {
    const h = harness();
    h.$("registerName").value = "Test User";
    h.$("registerEmail").value = "user@example.com";
    h.$("registerPassword").value = "strongpassword";
    h.$("registerPassword2").value = "notthesame";
    await h.emit("registerForm", "submit");
    assert.equal(
        h.calls.some((x) => x.url === "/api/auth/register-customer"),
        false
    );
    assert.equal(h.state.authFlowInProgress, false);
});
test("customer registration retains POST payload and email verification state", async () => {
    const h = harness();
    h.$("registerName").value = "Test User";
    h.$("registerEmail").value = "USER@example.com";
    h.$("registerPhone").value = "09171234567";
    h.$("registerCompany").value = "XTech";
    h.$("registerAddress").value = "Davao";
    h.$("registerPassword").value = "securePass!";
    h.$("registerPassword2").value = "securePass!";
    await h.emit("registerForm", "submit");
    const request = h.calls.find((x) => x.url === "/api/auth/register-customer");
    assert.equal(JSON.parse(request.opts.body).email, "user@example.com");
    assert.equal(h.state.pendingEmailOtpEmail, "user@example.com");
    assert.equal(h.state.authFlowInProgress, false);
});
test("password login completes when TOTP is already enabled", async () => {
    const h = harness();
    h.$("loginEmail").value = "staff@example.com";
    h.$("loginPassword").value = "secretpass";
    await h.emit("loginForm", "submit");
    assert.equal(h.finish.length, 1);
    assert.equal(h.state.authFlowInProgress, false);
});
test("MFA-required sign-in opens challenge and only completes with valid OTP", async () => {
    const e = new Error("MFA required");
    e.code = "auth/multi-factor-auth-required";
    let attempts = 0;
    e.resolver = {
        hints: [{ factorId: "totp", uid: "factor-id" }],
        async resolveSignIn(assertion) {
            attempts++;
            return { user: { uid: "staff", email: "staff@example.com" } };
        }
    };
    const h = harness({ apiOverrides: { "firebase-sign-in": e } });
    h.$("loginEmail").value = "staff@example.com";
    h.$("loginPassword").value = "secretpass";
    await h.emit("loginForm", "submit");
    assert.equal(h.$("totpChallengeForm").classList.contains("hidden"), false);
    h.$("totpChallengeCode").value = "123456";
    await h.emit("totpChallengeForm", "submit");
    assert.equal(attempts, 1);
    assert.equal(h.finish.length, 1);
});
test("first-time authenticator enrollment does not bypass MFA", async () => {
    const h = harness({
        apiOverrides: {
            "firebase-sign-in": {
                user: { uid: "staff", email: "staff@example.com", emailVerified: true, factors: [] }
            }
        }
    });
    h.$("loginEmail").value = "staff@example.com";
    h.$("loginPassword").value = "secretpass";
    await h.emit("loginForm", "submit");
    assert.equal(h.$("totpEnrollForm").classList.contains("hidden"), false);
    assert.equal(h.finish.length, 0);
    h.$("totpEnrollCode").value = "123456";
    await h.emit("totpEnrollForm", "submit");
    assert.equal(h.finish.length, 1);
});
test("unverified first-time account is signed out before TOTP enrollment", async () => {
    const h = harness({
        apiOverrides: {
            "firebase-sign-in": {
                user: { uid: "new", email: "new@example.com", emailVerified: false, factors: [] }
            }
        }
    });
    h.$("loginEmail").value = "new@example.com";
    h.$("loginPassword").value = "secretpass";
    await h.emit("loginForm", "submit");
    assert.equal(h.finish.length, 0);
    assert.ok(h.calls.some((x) => x.url === "firebase-email-verification"));
    assert.equal(h.getSignouts(), 1);
});

// Customer notification flows.
test("noncustomer accounts never request customer notification history", async () => {
    const h = harness({ role: "admin" });
    await h.notificationUi.loadNotifications();
    assert.equal(
        h.calls.some((x) => x.url === "/api/notifications"),
        false
    );
});
test("customer notification list sorts UI into menu and page and counts unread", async () => {
    const h = harness({
        apiOverrides: {
            "/api/notifications": {
                notifications: [
                    { id: "1", title: "Pickup", read: false },
                    { id: "2", title: "Purchase", read: true }
                ]
            }
        }
    });
    await h.notificationUi.loadNotifications();
    assert.equal(h.notificationUi.notificationUnreadCount(), 1);
    assert.match(h.$("notificationMenuList").innerHTML, /Pickup/);
    assert.match(h.$("notificationPageList").innerHTML, /Purchase/);
});
test("notification rendering escapes untrusted title, reference and message", async () => {
    const h = harness({
        apiOverrides: {
            "/api/notifications": {
                notifications: [
                    {
                        id: "one",
                        title: "<script>alert(1)</script>",
                        message: "<img src=x>",
                        relatedId: "<tag>",
                        read: false
                    }
                ]
            }
        }
    });
    await h.notificationUi.loadNotifications();
    const markup = h.$("notificationPageList").innerHTML;
    assert.ok(!markup.includes("<script>"));
    assert.ok(!markup.includes("<img src"));
    assert.ok(markup.includes("&lt;script&gt;"));
});
test("reading one unread notification preserves PATCH endpoint and updates badge", async () => {
    const h = harness({
        apiOverrides: { "/api/notifications": { notifications: [{ id: "one", read: false }] } }
    });
    await h.notificationUi.loadNotifications();
    await h.notificationUi.markNotificationRead("one");
    assert.ok(
        h.calls.some((x) => x.url === "/api/notifications/one/read" && x.opts.method === "PATCH")
    );
    assert.equal(h.notificationUi.notificationUnreadCount(), 0);
});
test("reading all unread notifications calls original batch route", async () => {
    const h = harness({
        apiOverrides: {
            "/api/notifications": {
                notifications: [
                    { id: "one", read: false },
                    { id: "two", read: false }
                ]
            }
        }
    });
    await h.notificationUi.loadNotifications();
    await h.notificationUi.markAllNotificationsRead();
    assert.ok(
        h.calls.some((x) => x.url === "/api/notifications/read-all" && x.opts.method === "PATCH")
    );
    assert.equal(h.notificationUi.notificationUnreadCount(), 0);
});
test("mark-all skips API write when there is nothing unread", async () => {
    const h = harness();
    await h.notificationUi.markAllNotificationsRead();
    assert.equal(
        h.calls.some((x) => x.url === "/api/notifications/read-all"),
        false
    );
});
test("customer polling uses 30s interval and does not duplicate timers", () => {
    const h = harness();
    h.notificationUi.startNotificationPolling();
    h.notificationUi.startNotificationPolling();
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].interval, 30000);
});
test("staff does not start customer notification polling", () => {
    const h = harness({ role: "warehouse" });
    h.notificationUi.startNotificationPolling();
    assert.equal(h.timers.size, 0);
});
test("signout resets unread state and cancels polling", async () => {
    const h = harness({
        apiOverrides: { "/api/notifications": { notifications: [{ id: "one", read: false }] } }
    });
    await h.notificationUi.loadNotifications();
    h.notificationUi.startNotificationPolling();
    h.notificationUi.resetNotifications();
    assert.equal(h.notificationUi.notificationUnreadCount(), 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.$("notificationBadge").classList.contains("hidden"), true);
});
test("notification API failures show error without throwing", async () => {
    const h = harness({ apiOverrides: { "/api/notifications": new Error("Offline") } });
    await h.notificationUi.loadNotifications();
    assert.ok(h.toasts.includes("Offline"));
});
test("notification visibility refresh only uses customer role", async () => {
    const h = harness({ role: "admin" });
    assert.equal(typeof h.docHandlers.visibilitychange, "function");
    await h.docHandlers.visibilitychange();
    assert.equal(
        h.calls.some((x) => x.url === "/api/notifications"),
        false
    );
});
