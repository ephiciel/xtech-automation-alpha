"use strict";
// Stage 4.43: isolated Firebase SDK handles and authentication-flow state.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const code = read("frontend/js/auth-session-state.js");
const app = read("frontend/js/app.js");
const html = read("frontend/index.html");
const validator = read("scripts/validate.js");
const pkg = JSON.parse(read("package.json"));
const ci = read(".github/workflows/ci.yml");

function createHarness() {
    const window = {};
    const context = { window };
    vm.runInNewContext(code, context, { filename: "auth-session-state.js" });
    return {
        window,
        registry: window.XTechAuthSessionState,
        create: () => window.XTechAuthSessionState.createAuthSessionState()
    };
}
function appStore() {
    return createHarness().create();
}

test("Stage 4.43 exports an isolated authentication-session factory", () => {
    assert.equal(typeof createHarness().registry.createAuthSessionState, "function");
});
test("registration does not require Firebase or browser APIs", () => {
    assert.doesNotThrow(() => createHarness());
});
test("factory registry is frozen", () => {
    assert(Object.isFrozen(createHarness().registry));
});
test("created store interface is immutable", () => {
    assert(Object.isFrozen(appStore()));
});
test("each app receives an independent store", () => {
    assert.notEqual(appStore(), appStore());
});
test("Firebase Auth API starts unset", () => {
    assert.equal(appStore().getFirebaseAuthApi(), null);
});
test("Firebase Auth instance starts unset", () => {
    assert.equal(appStore().getFirebaseAuthInstance(), null);
});
test("public Firebase configuration starts as an empty object", () => {
    assert.equal(Object.keys(appStore().getAppConfig()).length, 0);
});
test("Firebase initializer stores the latest SDK wrapper", () => {
    const store = appStore();
    const api = { signOut() {} };
    store.setFirebaseClient({ auth: {}, firebaseApi: api, config: {} });
    assert.equal(store.getFirebaseAuthApi(), api);
});
test("Firebase initializer stores the original Auth instance by identity", () => {
    const store = appStore();
    const auth = { currentUser: { uid: "123" } };
    store.setFirebaseClient({ auth, firebaseApi: {}, config: {} });
    assert.equal(store.getFirebaseAuthInstance(), auth);
});
test("Firebase initializer retains the original configuration reference", () => {
    const store = appStore();
    const config = { projectId: "staging" };
    store.setFirebaseClient({ auth: {}, firebaseApi: {}, config });
    assert.equal(store.getAppConfig(), config);
});
test("reinitialization replaces all previous SDK references", () => {
    const store = appStore();
    const old = { auth: {}, firebaseApi: {}, config: { projectId: "old" } };
    const next = { auth: {}, firebaseApi: {}, config: { projectId: "new" } };
    store.setFirebaseClient(old);
    store.setFirebaseClient(next);
    assert.equal(store.getFirebaseAuthApi(), next.firebaseApi);
    assert.equal(store.getFirebaseAuthInstance(), next.auth);
    assert.equal(store.getAppConfig(), next.config);
});
test("initializing one store does not populate another", () => {
    const a = appStore(),
        b = appStore();
    a.setFirebaseClient({ auth: {}, firebaseApi: {}, config: {} });
    assert.equal(b.getFirebaseAuthApi(), null);
    assert.equal(b.getFirebaseAuthInstance(), null);
});
test("creating the store does not invoke a network request or Firebase SDK", () => {
    let invoked = 0;
    const mockApi = {
        onAuthStateChanged() {
            invoked++;
        },
        signOut() {
            invoked++;
        }
    };
    const store = appStore();
    store.setFirebaseClient({ auth: {}, firebaseApi: mockApi, config: {} });
    assert.equal(invoked, 0);
});
test("default sign-in method remains password plus TOTP", () => {
    assert.equal(appStore().authUiState.selectedSignInMethod, "password-totp");
});
test("auth state starts with no in-progress authentication", () => {
    assert.equal(appStore().authUiState.authFlowInProgress, false);
});
test("TOTP resolver starts empty", () => {
    assert.equal(appStore().authUiState.pendingMfaResolver, null);
});
test("TOTP challenge hint starts empty", () => {
    assert.equal(appStore().authUiState.pendingMfaHint, null);
});
test("pending TOTP enrollment secret starts empty", () => {
    assert.equal(appStore().authUiState.pendingTotpSecret, null);
});
test("pending email and masked destination start empty", () => {
    const state = appStore().authUiState;
    assert.equal(state.pendingEmailOtpEmail, "");
    assert.equal(state.pendingEmailOtpMaskedEmail, "");
});
test("OTP resend and expiration timestamps start at zero", () => {
    const state = appStore().authUiState;
    assert.equal(state.emailOtpResendAvailableAt, 0);
    assert.equal(state.emailOtpExpiresAt, 0);
});
test("OTP countdown timer starts unset", () => {
    assert.equal(appStore().authUiState.emailOtpCountdownTimer, null);
});
test("auth UI can select email-code sign-in in-place", () => {
    const state = appStore().authUiState;
    state.selectedSignInMethod = "email-otp";
    assert.equal(state.selectedSignInMethod, "email-otp");
});
test("auth flow guard remains mutable for MFA challenge", () => {
    const state = appStore().authUiState;
    state.authFlowInProgress = true;
    assert.equal(state.authFlowInProgress, true);
    state.authFlowInProgress = false;
    assert.equal(state.authFlowInProgress, false);
});
test("MFA resolver retains the exact pending function", () => {
    const state = appStore().authUiState;
    const resolve = () => {};
    state.pendingMfaResolver = resolve;
    assert.equal(state.pendingMfaResolver, resolve);
});
test("MFA hint and TOTP setup values remain writable", () => {
    const state = appStore().authUiState;
    state.pendingMfaHint = { uid: "pending" };
    state.pendingTotpSecret = "otpauth://secret";
    assert.equal(state.pendingMfaHint.uid, "pending");
    assert.equal(state.pendingTotpSecret, "otpauth://secret");
});
test("email OTP pending identity and masked email update together", () => {
    const state = appStore().authUiState;
    state.pendingEmailOtpEmail = "example@domain.test";
    state.pendingEmailOtpMaskedEmail = "e***@domain.test";
    assert.equal(state.pendingEmailOtpEmail, "example@domain.test");
    assert.equal(state.pendingEmailOtpMaskedEmail, "e***@domain.test");
});
test("OTP resend and expiration values remain live", () => {
    const state = appStore().authUiState;
    state.emailOtpResendAvailableAt = 1234;
    state.emailOtpExpiresAt = 5678;
    assert.equal(state.emailOtpResendAvailableAt, 1234);
    assert.equal(state.emailOtpExpiresAt, 5678);
});
test("OTP countdown handle retains original timer reference", () => {
    const state = appStore().authUiState;
    const timer = { interval: 1000 };
    state.emailOtpCountdownTimer = timer;
    assert.equal(state.emailOtpCountdownTimer, timer);
});
test("a second auth session cannot inherit a previous MFA challenge", () => {
    const a = appStore(),
        b = appStore();
    a.authUiState.authFlowInProgress = true;
    a.authUiState.pendingTotpSecret = "private";
    assert.equal(b.authUiState.authFlowInProgress, false);
    assert.equal(b.authUiState.pendingTotpSecret, null);
});
test("the public interface is frozen but live auth UI state remains writable", () => {
    const store = appStore();
    assert(Object.isFrozen(store));
    assert.equal(Object.isFrozen(store.authUiState), false);
    store.authUiState.pendingMfaResolver = () => true;
    assert.equal(store.authUiState.pendingMfaResolver(), true);
});
test("initial auth state contains precisely the original ten fields", () => {
    assert.equal(
        Object.keys(appStore().authUiState).sort().join("|"),
        [
            "selectedSignInMethod",
            "authFlowInProgress",
            "pendingMfaResolver",
            "pendingMfaHint",
            "pendingTotpSecret",
            "pendingEmailOtpEmail",
            "pendingEmailOtpMaskedEmail",
            "emailOtpResendAvailableAt",
            "emailOtpExpiresAt",
            "emailOtpCountdownTimer"
        ]
            .sort()
            .join("|")
    );
});

test("HTML loads auth session after operational state but before app.js", () => {
    const order = ["app-state.js", "auth-session-state.js", "app.js"].map((name) =>
        html.indexOf(`<script src="js/${name}"></script>`)
    );
    assert(order.every((pos, i) => pos >= 0 && (!i || pos > order[i - 1])));
});
test("main app instantiates one session state store and retains identity ownership", () => {
    assert.match(app, /XTechAuthSessionState\.createAuthSessionState\(\)/);
    assert.match(app, /let token = ""/);
    assert.match(app, /let currentUser = null/);
    assert.match(app, /let profile = null/);
});
test("main app does not re-declare old mutable Firebase/MFA variables", () => {
    assert.doesNotMatch(
        app,
        /let (?:appConfig|firebaseAuthApi|firebaseAuthInstance|selectedSignInMethod|authFlowInProgress|pendingMfaResolver|pendingMfaHint|pendingTotpSecret|pendingEmailOtpEmail|pendingEmailOtpMaskedEmail|emailOtpResendAvailableAt|emailOtpExpiresAt|emailOtpCountdownTimer)\s*=/
    );
});
test("Firebase initialization wires SDK handles to session store", () => {
    assert.match(app, /authSessionState\.setFirebaseClient\(result\)/);
    assert.match(app, /return result\.auth/);
});
test("boot retains Firebase listener and shared MFA-in-progress guard", () => {
    assert.match(app, /authSessionState\.getFirebaseAuthApi\(\)\.onAuthStateChanged/);
    assert.match(app, /if \(authUiState\.authFlowInProgress\) return/);
});
test("sign-in continues fetching a fresh ID token and the authenticated profile", () => {
    assert.match(app, /getIdToken\(user, true\)/);
    assert.match(app, /api\("\/api\/auth\/me"\)/);
    assert.match(app, /currentUser = user/);
    assert.match(app, /profile = me\.profile/);
});
test("sign-out retains existing UI cleanup paths", () => {
    assert.match(app, /function showSignedOutState/);
    assert.match(app, /notificationUi\.resetNotifications\(\)/);
    assert.match(app, /resetPasswordChangeMfa\(\)/);
    assert.match(app, /resetChatPanel\(\)/);
});
test("logout resolves fresh Auth API and Auth instance from same session", () => {
    assert.match(
        app,
        /authSessionState\.getFirebaseAuthApi\(\)\.signOut\(authSessionState\.getFirebaseAuthInstance\(\)\)/
    );
});
test("auth UI receives unchanged mutable state through explicit dependencies", () => {
    assert.match(app, /state: authUiState/);
    assert.match(app, /getFirebaseAuthApi: authSessionState\.getFirebaseAuthApi/);
    assert.match(app, /getFirebaseAuthInstance: authSessionState\.getFirebaseAuthInstance/);
    assert.match(app, /getAppConfig: authSessionState\.getAppConfig/);
});
test("security UI receives fresh Auth getters, not stale values", () => {
    assert.match(app, /XTechSecurityUi\.createSecurityUi/);
    assert.equal(
        (app.match(/getFirebaseAuthApi: authSessionState\.getFirebaseAuthApi/g) || []).length,
        2
    );
    assert.equal(
        (app.match(/getFirebaseAuthInstance: authSessionState\.getFirebaseAuthInstance/g) || [])
            .length,
        2
    );
});
test("auth UI and notification modules remain registered in app.js", () => {
    assert.match(app, /XTechAuthUi\.createAuthUi/);
    assert.match(app, /XTechNotificationUi\.createNotificationUi/);
});
test("static validator checks the session module", () => {
    assert.match(validator, /auth-session-state\.js/);
    assert.match(validator, /Stage 4\.43/);
});
test("unit test list includes Stage 4.43 regression suite", () => {
    assert(pkg.scripts["test:unit"].includes("tests/frontend-auth-session-state.test.js"));
});
test("GitHub CI runs Prettier on the new session module", () => {
    assert(ci.includes("frontend/js/auth-session-state.js"));
});
