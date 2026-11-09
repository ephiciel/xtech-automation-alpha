"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const src = {
    staff: fs.readFileSync(path.join(root, "frontend/js/staff-ui.js"), "utf8"),
    security: fs.readFileSync(path.join(root, "frontend/js/security-ui.js"), "utf8"),
    profile: fs.readFileSync(path.join(root, "frontend/js/profile-ui.js"), "utf8")
};
const app = fs.readFileSync(path.join(root, "frontend/js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");

function harness(options = {}) {
    const elements = new Map();
    const calls = [];
    const toasts = [];
    const messages = [];
    const authCalls = [];
    const role = options.role || "admin";
    let currentUser =
        options.user === null
            ? null
            : options.user || {
                  uid: "self-uid",
                  email: "admin@example.com",
                  displayName: "Admin",
                  metadata: { lastSignInTime: "2026-11-09T07:00:00Z" }
              };
    let currentProfile = options.profile === null ? null : options.profile || { role };
    let authInstance = { currentUser };
    let authApi;
    let ask = options.confirm !== false;
    const elementsFor = (id) => {
        if (!elements.has(id)) {
            const handlers = new Map();
            const classSet = new Set();
            elements.set(id, {
                value: "",
                textContent: "",
                innerHTML: "",
                disabled: false,
                handlers,
                classList: {
                    add(name) {
                        classSet.add(name);
                    },
                    remove(name) {
                        classSet.delete(name);
                    },
                    contains(name) {
                        return classSet.has(name);
                    },
                    toggle(name) {
                        if (classSet.has(name)) classSet.delete(name);
                        else classSet.add(name);
                    }
                },
                addEventListener(name, callback) {
                    handlers.set(name, callback);
                },
                focus() {
                    this.focused = true;
                },
                reset() {
                    this.resetCalled = true;
                },
                classSet
            });
        }
        return elements.get(id);
    };
    const window = {};
    for (const [filename, code] of Object.entries(src)) {
        vm.runInNewContext(code, { window }, { filename: filename + "-ui.js" });
    }
    const safe = (value) =>
        String(value ?? "").replace(
            /[&<>"']/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]
        );
    const defaults = {
        "/api/users": { users: options.users || [] },
        "/api/profile": {
            customer: options.customer || {
                name: "Jane Doe",
                email: "jane@example.com",
                phone: "09171234567",
                company: "XTECH",
                address: "Davao"
            }
        }
    };
    const api = async (url, opts = {}) => {
        calls.push({ url, opts });
        const v = Object.hasOwn(options.responses || {}, url)
            ? options.responses[url]
            : defaults[url] || {};
        if (v instanceof Error) throw v;
        return typeof v === "function" ? v(url, opts) : v;
    };
    const validated = (v, label) => {
        const x = String(v ?? "").trim();
        if (!x && label) throw new Error(label + " is required");
        return x;
    };
    const validationError = (m) => {
        throw new Error(m);
    };
    const mfa = options.mfa || { factors: [], challenge: false };
    const resolver = {
        hints: [{ factorId: "totp", uid: "totp-hint" }],
        async resolveSignIn(assertion) {
            authCalls.push({ kind: "mfa-resolve", assertion });
            return { user: currentUser };
        }
    };
    authApi = {
        TotpMultiFactorGenerator: {
            FACTOR_ID: "totp",
            assertionForSignIn: (uid, code) => ({ uid, code })
        },
        multiFactor: () => ({ enrolledFactors: mfa.factors || [] }),
        sendPasswordResetEmail: async (_instance, email) => {
            authCalls.push({ kind: "reset", email });
            if (options.resetError) throw options.resetError;
        },
        signInWithEmailAndPassword: async (_instance, email, password) => {
            authCalls.push({ kind: "reauth", email, password });
            if (mfa.challenge) {
                const err = new Error("MFA required");
                err.code = "auth/multi-factor-auth-required";
                throw err;
            }
            if (options.loginError) throw options.loginError;
            return { user: currentUser };
        },
        getMultiFactorResolver: () => resolver,
        updatePassword: async (_user, password) => {
            authCalls.push({ kind: "password-update", password });
            if (options.updatePasswordError) throw options.updatePasswordError;
        },
        signOut: async () => {
            authCalls.push({ kind: "signout" });
        }
    };
    const core = {
        $: elementsFor,
        api,
        toast: (msg) => toasts.push(msg),
        setMessage: (id, message, kind = "error") => messages.push({ id, message, kind }),
        busy: async (_button, cb) => cb(),
        esc: safe,
        badge: (value) => `<span>${safe(value)}</span>`,
        roleDisplayName: (role) =>
            ({
                admin: "Admin",
                secretary: "Secretary",
                warehouse: "Warehouse",
                customer: "Customer"
            })[role] || "User",
        validateName: validated,
        validateEmail: validated,
        validatePassword: (v) => {
            if (String(v).length < 6) throw new Error("Weak password");
            return String(v);
        },
        validatePhone: (v) => String(v),
        validateText: (v) => String(v ?? "").trim(),
        validateNewPassword: (v) => {
            if (String(v).length < 6) throw new Error("Weak password");
            return String(v);
        },
        validationError,
        getCurrentUser: () => currentUser,
        getProfile: () => currentProfile,
        getFirebaseAuthApi: () => authApi,
        getFirebaseAuthInstance: () => authInstance,
        confirm: () => ask,
        window
    };
    const staff = window.XTechStaffUi.createStaffUi(core);
    const security = window.XTechSecurityUi.createSecurityUi(core);
    const profile = window.XTechProfileUi.createProfileUi(core);
    async function trigger(id, name = "click") {
        const handler = elementsFor(id).handlers.get(name);
        assert.equal(typeof handler, "function", `missing ${id}:${name}`);
        const event = {
            currentTarget: { textContent: "Send" },
            submitter: { textContent: "Save" },
            target: elementsFor(id),
            preventDefault() {
                this.prevented = true;
            }
        };
        await handler(event);
        return event;
    }
    return {
        staff,
        security,
        profile,
        window,
        $: elementsFor,
        calls,
        toasts,
        messages,
        authCalls,
        authApi,
        authInstance,
        trigger,
        setCurrentUser: (user) => {
            currentUser = user;
            authInstance.currentUser = user;
        },
        setRole: (value) => {
            currentProfile = { role: value };
        },
        setConfirm: (value) => {
            ask = value;
        },
        lastMessage: (id) => messages.filter((x) => x.id === id).at(-1)
    };
}

const accounts = [
    {
        uid: "self-uid",
        name: "Administrator",
        email: "admin@example.com",
        role: "admin",
        active: true
    },
    {
        uid: "other",
        name: "Secretary <b>",
        email: "sec@example.com",
        role: "secretary",
        active: true
    },
    {
        uid: "off",
        name: "Warehouse Worker",
        email: "wh@example.com",
        role: "warehouse",
        active: false
    }
];

test("all three module factories exist, are immutable, and expose documented methods", () => {
    const h = harness();
    for (const key of ["XTechStaffUi", "XTechSecurityUi", "XTechProfileUi"])
        assert.ok(Object.isFrozen(h.window[key]));
    for (const obj of [h.staff, h.security, h.profile]) assert.ok(Object.isFrozen(obj));
    assert.equal(typeof h.staff.loadUsers, "function");
    assert.equal(typeof h.security.resetPasswordChangeMfa, "function");
    assert.equal(typeof h.profile.loadProfile, "function");
});
test("staff accounts GET uses original endpoint and displays roles", async () => {
    const h = harness({ users: accounts });
    await h.staff.loadUsers();
    assert.equal(h.calls[0].url, "/api/users");
    assert.match(h.$("userTable").innerHTML, /Administrator/);
    assert.match(h.$("userTable").innerHTML, /Secretary/);
    assert.match(h.$("userTable").innerHTML, /Inactive/);
});
test("staff table escapes HTML and excludes status button for self", async () => {
    const h = harness({ users: accounts });
    await h.staff.loadUsers();
    const html = h.$("userTable").innerHTML;
    assert.match(html, /Secretary &lt;b&gt;/);
    assert.doesNotMatch(html, /Secretary <b>/);
    assert.match(html, /Current account/);
    assert.match(html, /setUserStatus\('other'/);
    assert.doesNotMatch(html, /setUserStatus\('self-uid'/);
});
test("staff filters search and active/inactive state", async () => {
    const h = harness({ users: accounts });
    await h.staff.loadUsers();
    h.$("userSearch").value = "warehouse";
    h.staff.renderUsers();
    assert.match(h.$("userTable").innerHTML, /Warehouse Worker/);
    assert.doesNotMatch(h.$("userTable").innerHTML, /Administrator/);
    h.$("userSearch").value = "";
    h.$("userStatusFilter").value = "active";
    h.staff.renderUsers();
    assert.doesNotMatch(h.$("userTable").innerHTML, /Warehouse Worker/);
});
test("staff creation retains POST endpoint, role, and account refresh", async () => {
    const h = harness();
    h.$("userName").value = "Secretary Jane";
    h.$("userAccountEmail").value = "jane@example.com";
    h.$("userPassword").value = "secret123";
    h.$("userRole").value = "secretary";
    await h.trigger("userForm", "submit");
    const post = h.calls.find((c) => c.opts.method === "POST");
    assert.equal(post.url, "/api/users");
    assert.deepEqual(JSON.parse(post.opts.body), {
        name: "Secretary Jane",
        email: "jane@example.com",
        password: "secret123",
        role: "secretary"
    });
    assert.equal(h.calls.at(-1).url, "/api/users");
    assert.equal(h.lastMessage("userMessage").kind, "success");
});
test("staff creation rejects privileged roles before HTTP POST", async () => {
    const h = harness();
    h.$("userName").value = "Danger";
    h.$("userAccountEmail").value = "test@example.com";
    h.$("userPassword").value = "secret123";
    h.$("userRole").value = "admin";
    await h.trigger("userForm", "submit");
    assert.equal(h.calls.length, 0);
    assert.match(h.lastMessage("userMessage").message, /valid staff role/i);
});
test("staff creation displays API failure and preserves form state", async () => {
    const h = harness({ responses: { "/api/users": new Error("Registration refused") } });
    h.$("userName").value = "Test";
    h.$("userAccountEmail").value = "test@example.com";
    h.$("userPassword").value = "secret123";
    h.$("userRole").value = "warehouse";
    await h.trigger("userForm", "submit");
    assert.equal(h.lastMessage("userMessage").message, "Registration refused");
});
test("staff status change is confirmed and PATCHed with active flag", async () => {
    const h = harness({ users: accounts });
    await h.window.setUserStatus("off", true);
    const patch = h.calls.find((c) => c.opts.method === "PATCH");
    assert.equal(patch.url, "/api/users/off/status");
    assert.equal(JSON.parse(patch.opts.body).active, true);
    assert.equal(h.calls.at(-1).url, "/api/users");
});
test("staff status confirmation cancellation prevents network mutation", async () => {
    const h = harness({ confirm: false });
    await h.window.setUserStatus("off", false);
    assert.equal(h.calls.length, 0);
});
test("staff status API failure is shown without throwing", async () => {
    const h = harness({ responses: { "/api/users/off/status": new Error("Permission denied") } });
    await h.window.setUserStatus("off", false);
    assert.ok(h.toasts.includes("Permission denied"));
});
test("staff refresh button reloads the list", async () => {
    const h = harness();
    await h.trigger("refreshUsers");
    assert.equal(h.calls.at(-1).url, "/api/users");
});
test("security page displays current user email role and enabled factors", () => {
    const h = harness({ mfa: { factors: [{ factorId: "totp" }] } });
    h.security.loadSecurity();
    assert.equal(h.$("securityEmail").textContent, "admin@example.com");
    assert.equal(h.$("securityRole").textContent, "Admin");
    assert.equal(h.$("securityMfaStatus").textContent, "Authenticator enabled");
    assert.equal(h.$("securityEmailOtpStatus").textContent, "Available");
});
test("security page safely returns when user is signed out", () => {
    const h = harness({ user: null });
    h.security.loadSecurity();
    assert.equal(h.$("securityEmail").textContent, "");
});
test("security reset link uses currently authenticated email", async () => {
    const h = harness();
    await h.trigger("sendResetPasswordBtn");
    assert.deepEqual(h.authCalls[0], { kind: "reset", email: "admin@example.com" });
    assert.equal(h.lastMessage("securityResetMessage").kind, "success");
});
test("security reset email failures are surfaced", async () => {
    const h = harness({ resetError: new Error("Email service down") });
    await h.trigger("sendResetPasswordBtn");
    assert.equal(h.lastMessage("securityResetMessage").message, "Email service down");
});
test("password change rejects mismatched confirmation", async () => {
    const h = harness();
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "different";
    await h.trigger("changePasswordForm", "submit");
    assert.equal(h.authCalls.length, 0);
    assert.match(h.lastMessage("changePasswordMessage").message, /confirmation do not match/i);
});
test("password change rejects reuse of current password", async () => {
    const h = harness();
    h.$("currentPassword").value = "samepassword";
    h.$("newPassword").value = "samepassword";
    h.$("confirmNewPassword").value = "samepassword";
    await h.trigger("changePasswordForm", "submit");
    assert.equal(h.authCalls.length, 0);
    assert.match(h.lastMessage("changePasswordMessage").message, /must be different/i);
});
test("successful password change reauthenticates, updates, then signs out", async () => {
    const h = harness();
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "newpassword";
    await h.trigger("changePasswordForm", "submit");
    assert.deepEqual(
        h.authCalls.map((x) => x.kind),
        ["reauth", "password-update", "signout"]
    );
    assert.equal(h.authCalls[1].password, "newpassword");
    assert.equal(h.lastMessage("loginMessage").kind, "success");
});
test("invalid current password maps Firebase error to human message", async () => {
    const e = Object.assign(new Error("Bad"), { code: "auth/wrong-password" });
    const h = harness({ loginError: e });
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "newpassword";
    await h.trigger("changePasswordForm", "submit");
    assert.equal(
        h.lastMessage("changePasswordMessage").message,
        "The current password is incorrect."
    );
});
test("MFA-required password change first prompts for TOTP without changing password", async () => {
    const h = harness({ mfa: { factors: [], challenge: true } });
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "newpassword";
    await h.trigger("changePasswordForm", "submit");
    assert.equal(h.$("changePasswordTotpWrap").classList.contains("hidden"), false);
    assert.equal(h.$("changePasswordTotpCode").focused, true);
    assert.deepEqual(
        h.authCalls.map((x) => x.kind),
        ["reauth"]
    );
});
test("MFA-required password change completes only with the code", async () => {
    const h = harness({ mfa: { challenge: true } });
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "newpassword";
    await h.trigger("changePasswordForm", "submit");
    h.$("changePasswordTotpCode").value = "123456";
    await h.trigger("changePasswordForm", "submit");
    assert.deepEqual(
        h.authCalls.map((x) => x.kind),
        ["reauth", "mfa-resolve", "password-update", "signout"]
    );
    assert.equal(h.$("changePasswordTotpWrap").classList.contains("hidden"), true);
});
test("MFA code validation rejects invalid codes without resolving the session", async () => {
    const h = harness({ mfa: { challenge: true } });
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "newpassword";
    await h.trigger("changePasswordForm", "submit");
    h.$("changePasswordTotpCode").value = "wrong";
    await h.trigger("changePasswordForm", "submit");
    assert.deepEqual(
        h.authCalls.map((x) => x.kind),
        ["reauth"]
    );
    assert.match(h.lastMessage("changePasswordMessage").message, /6-digit/i);
});
test("signout reset clears unfinished password MFA challenge", async () => {
    const h = harness({ mfa: { challenge: true } });
    h.$("currentPassword").value = "oldpassword";
    h.$("newPassword").value = "newpassword";
    h.$("confirmNewPassword").value = "newpassword";
    await h.trigger("changePasswordForm", "submit");
    h.security.resetPasswordChangeMfa();
    assert.equal(h.$("changePasswordTotpWrap").classList.contains("hidden"), true);
    assert.equal(h.$("changePasswordTotpCode").value, "");
});
test("customer profile GET populates customer fields", async () => {
    const h = harness({
        customer: {
            name: "Ava",
            email: "ava@example.com",
            phone: "09171234567",
            company: "AGB",
            address: "Davao"
        }
    });
    await h.profile.loadProfile();
    assert.equal(h.calls[0].url, "/api/profile");
    assert.equal(h.$("profileName").value, "Ava");
    assert.equal(h.$("profileCompany").value, "AGB");
});
test("customer profile load falls back to logged-in email", async () => {
    const h = harness({ customer: { name: "Ava", phone: "", company: "", address: "" } });
    await h.profile.loadProfile();
    assert.equal(h.$("profileEmail").value, "admin@example.com");
});
test("customer profile GET error sets inline message", async () => {
    const h = harness({ responses: { "/api/profile": new Error("Profile unavailable") } });
    await h.profile.loadProfile();
    assert.equal(h.lastMessage("profileMessage").message, "Profile unavailable");
});
test("customer profile PUT preserves original payload and success notifications", async () => {
    const h = harness();
    h.$("profileName").value = "Ava X";
    h.$("profilePhone").value = "09171234567";
    h.$("profileCompany").value = "AGB";
    h.$("profileAddress").value = "Davao";
    await h.trigger("profileForm", "submit");
    const req = h.calls[0];
    assert.equal(req.url, "/api/profile");
    assert.equal(req.opts.method, "PUT");
    assert.deepEqual(JSON.parse(req.opts.body), {
        name: "Ava X",
        phone: "09171234567",
        company: "AGB",
        address: "Davao"
    });
    assert.equal(h.lastMessage("profileMessage").kind, "success");
});
test("customer profile rejects invalid fields before API mutation", async () => {
    const h = harness();
    h.$("profileName").value = "";
    h.$("profilePhone").value = "09171234567";
    await h.trigger("profileForm", "submit");
    assert.equal(h.calls.length, 0);
    assert.match(h.lastMessage("profileMessage").message, /Full name/);
});
test("customer profile API failure is reported in form", async () => {
    const h = harness({ responses: { "/api/profile": new Error("Update failed") } });
    h.$("profileName").value = "Ava";
    h.$("profilePhone").value = "09171234567";
    await h.trigger("profileForm", "submit");
    assert.equal(h.lastMessage("profileMessage").message, "Update failed");
});
test("frontend loads staff/security/profile modules in sequence before app.js", () => {
    const ordered = ["reports-ui.js", "staff-ui.js", "security-ui.js", "profile-ui.js", "app.js"];
    const indexes = ordered.map((x) => html.indexOf(`<script src="js/${x}"></script>`));
    assert.ok(indexes.every((x, i) => x >= 0 && (!i || x > indexes[i - 1])));
    for (const re of [
        /XTechStaffUi\.createStaffUi/,
        /XTechSecurityUi\.createSecurityUi/,
        /XTechProfileUi\.createProfileUi/,
        /function resetPasswordChangeMfa\(\)/
    ])
        assert.match(app, re);
});
