"use strict";
// Stage 4.44: startup, observer, and cleanup tests (mocked; no Firebase credentials).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "frontend/js/app-lifecycle.js"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend/js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");
const validator = fs.readFileSync(path.join(root, "scripts/validate.js"), "utf8");
const pkg = require(path.join(root, "package.json"));
const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

function registry() {
    const window = {};
    vm.runInNewContext(source, { window });
    return window.XTechAppLifecycle;
}
function fixture(overrides = {}) {
    const events = [];
    const auth = { marker: "mock-auth" };
    const unsubscribed = { count: 0 };
    let listener;
    const hooks = {
        prepareAuthScreen: () => events.push("prepare"),
        initFirebase: async () => {
            events.push("initialize");
            return auth;
        },
        registerAuthObserver: (instance, callback) => {
            events.push("observe");
            assert.equal(instance, auth);
            listener = callback;
            return () => {
                unsubscribed.count++;
            };
        },
        onSignedIn: async (user) => events.push("sign-in:" + user.uid),
        onSignedOut: () => events.push("sign-out"),
        onSignedInError: async (error, instance) => {
            assert.equal(instance, auth);
            events.push("auth-error:" + error.message);
        },
        onStartupError: (error) => events.push("boot-error:" + error.message),
        ...overrides
    };
    const lifecycle = registry().createAppLifecycle(hooks);
    return {
        events,
        auth,
        lifecycle,
        unsubscribed,
        emit: (value) => listener(value),
        hasListener: () => typeof listener === "function"
    };
}

test("exports the lifecycle registry without a DOM or Firebase", () => {
    assert.equal(typeof registry().createAppLifecycle, "function");
});
test("registry is frozen", () => {
    assert.equal(Object.isFrozen(registry()), true);
});
test("each returned lifecycle interface is frozen", () => {
    assert.equal(Object.isFrozen(fixture().lifecycle), true);
});
test("lifecycle starts uninitialized", () => {
    assert.equal(fixture().lifecycle.isStarted, false);
});
test("startup prepares the auth screen before Firebase initialization", async () => {
    const f = fixture();
    assert.equal(await f.lifecycle.start(), true);
    assert.deepEqual(f.events, ["prepare", "initialize", "observe"]);
});
test("observer registration uses Firebase Auth returned by initialization", async () => {
    const f = fixture();
    await f.lifecycle.start();
    assert.equal(f.hasListener(), true);
});
test("lifecycle reports started only after observer registration", async () => {
    let resolveInitialization;
    const f = fixture({
        initFirebase: () => new Promise((resolve) => (resolveInitialization = resolve))
    });
    const starting = f.lifecycle.start();
    assert.equal(f.lifecycle.isStarted, false);
    resolveInitialization(f.auth);
    assert.equal(await starting, true);
    assert.equal(f.lifecycle.isStarted, true);
});
test("duplicate startup calls register a single observer", async () => {
    const f = fixture();
    const first = f.lifecycle.start();
    const second = f.lifecycle.start();
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.equal(f.events.filter((item) => item === "observe").length, 1);
});
test("later startup calls still do not attach duplicate listeners", async () => {
    const f = fixture();
    await f.lifecycle.start();
    await f.lifecycle.start();
    assert.equal(f.events.filter((item) => item === "prepare").length, 1);
});
test("observer dispatches signed-in Firebase users", async () => {
    const f = fixture();
    await f.lifecycle.start();
    await f.emit({ uid: "user-1" });
    assert(f.events.includes("sign-in:user-1"));
});
test("observer dispatches signed-out Firebase state", async () => {
    const f = fixture();
    await f.lifecycle.start();
    await f.emit(null);
    assert(f.events.includes("sign-out"));
});
test("undefined Firebase user is also treated as signed out", async () => {
    const f = fixture();
    await f.lifecycle.start();
    await f.emit(undefined);
    assert(f.events.includes("sign-out"));
});
test("sign-in failure is routed to the established error handler", async () => {
    const f = fixture({
        onSignedIn: async () => {
            throw new Error("profile unavailable");
        }
    });
    await f.lifecycle.start();
    await f.emit({ uid: "user-2" });
    assert(f.events.includes("auth-error:profile unavailable"));
});
test("failed Firebase initialization reports an error without attaching observer", async () => {
    const f = fixture({
        initFirebase: async () => {
            throw new Error("configuration missing");
        }
    });
    assert.equal(await f.lifecycle.start(), false);
    assert.equal(f.hasListener(), false);
    assert(f.events.includes("boot-error:configuration missing"));
});
test("failed observer registration reports an error", async () => {
    const f = fixture({
        registerAuthObserver: () => {
            throw new Error("observer blocked");
        }
    });
    assert.equal(await f.lifecycle.start(), false);
    assert(f.events.includes("boot-error:observer blocked"));
});
test("failed auth screen preparation reports an error before Firebase", async () => {
    const f = fixture({
        prepareAuthScreen: () => {
            throw new Error("screen missing");
        }
    });
    assert.equal(await f.lifecycle.start(), false);
    assert(f.events.includes("boot-error:screen missing"));
    assert(!f.events.includes("initialize"));
});
test("startup may be retried after Firebase initialization failure", async () => {
    let attempts = 0;
    let authRef;
    const f = fixture({
        initFirebase: async () => {
            attempts++;
            if (attempts === 1) throw new Error("offline");
            return authRef;
        }
    });
    authRef = f.auth;
    assert.equal(await f.lifecycle.start(), false);
    assert.equal(await f.lifecycle.start(), true);
    assert.equal(attempts, 2);
});
test("stop unsubscribes the Firebase auth observer", async () => {
    const f = fixture();
    await f.lifecycle.start();
    f.lifecycle.stop();
    assert.equal(f.unsubscribed.count, 1);
});
test("stop is idempotent and does not double unsubscribe", async () => {
    const f = fixture();
    await f.lifecycle.start();
    f.lifecycle.stop();
    f.lifecycle.stop();
    assert.equal(f.unsubscribed.count, 1);
});
test("stop clears started state", async () => {
    const f = fixture();
    await f.lifecycle.start();
    f.lifecycle.stop();
    assert.equal(f.lifecycle.isStarted, false);
});
test("callbacks delivered after stop are ignored", async () => {
    const f = fixture();
    await f.lifecycle.start();
    f.lifecycle.stop();
    await f.emit({ uid: "late" });
    await f.emit(null);
    assert(!f.events.includes("sign-in:late"));
    assert(!f.events.includes("sign-out"));
});
test("stop prevents later restarts of disposed lifecycle", async () => {
    const f = fixture();
    f.lifecycle.stop();
    assert.equal(await f.lifecycle.start(), false);
    assert.deepEqual(f.events, []);
});
test("stop during async initialization prevents listener registration", async () => {
    let resolve;
    const f = fixture({ initFirebase: () => new Promise((done) => (resolve = done)) });
    const result = f.lifecycle.start();
    f.lifecycle.stop();
    resolve(f.auth);
    assert.equal(await result, false);
    assert.equal(f.hasListener(), false);
});
test("lifecycle instances do not share listeners or disposed flags", async () => {
    const a = fixture();
    const b = fixture();
    await a.lifecycle.start();
    await b.lifecycle.start();
    a.lifecycle.stop();
    assert.equal(b.lifecycle.isStarted, true);
    await b.emit({ uid: "other" });
    assert(b.events.includes("sign-in:other"));
});
test("observer callbacks do not create duplicate screen preparations", async () => {
    const f = fixture();
    await f.lifecycle.start();
    await f.emit({ uid: "one" });
    await f.emit({ uid: "two" });
    assert.equal(f.events.filter((event) => event === "prepare").length, 1);
});

test("HTML loads lifecycle after auth session state and before app.js", () => {
    const files = ["auth-session-state.js", "app-lifecycle.js", "app.js"];
    const positions = files.map((name) => html.indexOf(`<script src="js/${name}"></script>`));
    assert(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])));
});
test("app creates exactly one lifecycle controller", () => {
    assert.equal((app.match(/XTechAppLifecycle\.createAppLifecycle\(/g) || []).length, 1);
});
test("app still owns authenticated token, user and role profile", () => {
    assert.match(app, /let token = ""/);
    assert.match(app, /let currentUser = null/);
    assert.match(app, /let profile = null/);
});
test("app lifecycle owns startup and legacy boot wrapper delegates", () => {
    assert.match(app, /async function boot\(\)/);
    assert.match(app, /return appLifecycle\.start\(\)/);
    assert.match(app, /boot\(\);\s*$/);
});
test("login form restoration happens in lifecycle startup callback", () => {
    assert.match(app, /prepareAuthScreen:\s*\(\)\s*=>/);
    assert.match(app, /restoreEmailOtpSession\(\)/);
});
test("Firebase onAuthStateChanged observer still guards ongoing MFA", () => {
    assert.match(app, /authSessionState\.getFirebaseAuthApi\(\)\.onAuthStateChanged/);
    assert.match(app, /if \(authUiState\.authFlowInProgress\) return/);
});
test("login error still signs out through the original Firebase Auth instance", () => {
    assert.match(app, /onSignedInError:/);
    assert.match(app, /authSessionState\.getFirebaseAuthApi\(\)\.signOut\(auth\)/);
});
test("signed-in workflow retains current token and authenticated profile", () => {
    assert.match(app, /getIdToken\(user, true\)/);
    assert.match(app, /api\("\/api\/auth\/me"\)/);
    assert.match(app, /profile = me\.profile/);
});
test("signed-out workflow retains notification, MFA and AI cleanup", () => {
    assert.match(app, /notificationUi\.resetNotifications\(\)/);
    assert.match(app, /resetPasswordChangeMfa\(\)/);
    assert.match(app, /resetChatPanel\(\)/);
});
test("static validator checks Stage 4.44 and the new lifecycle script", () => {
    assert.match(validator, /Stage 4\.44/);
    assert.match(validator, /app-lifecycle\.js/);
});
test("unit test suite includes lifecycle regression tests", () => {
    assert(pkg.scripts["test:unit"].includes("tests/frontend-app-lifecycle.test.js"));
});
test("CI checks Prettier for new lifecycle module", () => {
    assert.match(ci, /frontend\/js\/app-lifecycle\.js/);
});
