"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadModule(name, namespace) {
    const source = fs.readFileSync(path.join(__dirname, "../frontend/js", name), "utf8");
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox, { filename: name });
    return sandbox.window[namespace];
}

const { createApiClient } = loadModule("api-client.js", "XTechApiClient");
const { createFirebaseAuthClient, createEmailOtpStore } = loadModule(
    "auth-client.js",
    "XTechAuthClient"
);

function response({ ok = true, status = 200, body = {} } = {}) {
    return {
        ok,
        status,
        async json() {
            return body;
        }
    };
}

test("API requests attach the latest Bearer token and JSON headers", async () => {
    const requests = [];
    const changes = [];
    let token = "first-token";
    const api = createApiClient({
        getToken: () => token,
        onPendingChange: (delta) => changes.push(delta),
        fetchFn: async (url, options) => {
            requests.push({ url, options });
            return response({ body: { works: true } });
        }
    });
    const options = { method: "POST", body: '{"test":true}', headers: { "X-Test": "a" } };
    assert.equal((await api("/api/one", options)).works, true);
    token = "new-token";
    await api("/api/two", { silent: true });

    assert.equal(requests[0].options.headers.Authorization, "Bearer first-token");
    assert.equal(requests[1].options.headers.Authorization, "Bearer new-token");
    assert.equal(requests[0].options.headers["Content-Type"], "application/json");
    assert.equal(requests[0].options.headers["X-Test"], "a");
    assert.equal(requests[0].options.method, "POST");
    assert.equal("silent" in requests[1].options, false);
    assert.equal("Authorization" in options.headers, false);
    assert.equal(changes.join(","), "1,-1");
});

test("API requests without a token do not add an Authorization header", async () => {
    const api = createApiClient({
        getToken: () => "",
        fetchFn: async (_url, options) => {
            assert.equal("Authorization" in options.headers, false);
            return response();
        }
    });
    await api("/api/config", { silent: true });
});

test("API propagates status and server error fields and resets loading", async () => {
    const changes = [];
    const api = createApiClient({
        onPendingChange: (delta) => changes.push(delta),
        fetchFn: async () =>
            response({
                ok: false,
                status: 429,
                body: { message: "Cooldown active", retryAfterSeconds: 60 }
            })
    });
    await assert.rejects(api("/api/auth/email-otp/request"), (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.message, "Cooldown active");
        assert.equal(error.retryAfterSeconds, 60);
        return true;
    });
    assert.equal(changes.join(","), "1,-1");
});

test("API retains empty-object fallback for non-JSON success responses", async () => {
    const api = createApiClient({
        fetchFn: async () => ({
            ok: true,
            async json() {
                throw new SyntaxError("No JSON body");
            }
        })
    });
    const data = await api("/api/status", { silent: true });
    assert.equal(Object.keys(data).length, 0);
});

test("API always decrements pending requests when the network fails", async () => {
    const changes = [];
    const api = createApiClient({
        onPendingChange: (delta) => changes.push(delta),
        fetchFn: async () => {
            throw new Error("Network unavailable");
        }
    });
    await assert.rejects(api("/api/products"), /Network unavailable/);
    assert.equal(changes.join(","), "1,-1");
});

test("API reports overlapping requests independently", async () => {
    const changes = [];
    const resolveRequests = [];
    const api = createApiClient({
        onPendingChange: (delta) => changes.push(delta),
        fetchFn: () => new Promise((resolve) => resolveRequests.push(resolve))
    });
    const first = api("/api/a");
    const second = api("/api/b");
    assert.equal(changes.join(","), "1,1");
    resolveRequests[0](response());
    await first;
    resolveRequests[1](response());
    await second;
    assert.equal(changes.join(","), "1,1,-1,-1");
});

test("Firebase client fetches configuration once and shares concurrent initialization", async () => {
    let configs = 0;
    let modules = 0;
    let apps = 0;
    let authCalls = 0;
    const auth = { currentUser: null };
    const client = createFirebaseAuthClient({
        request: async (url, options) => {
            configs++;
            assert.equal(url, "/api/config");
            assert.equal(options.silent, true);
            return { apiKey: "key", projectId: "project", appId: "app" };
        },
        loadModules: async () => {
            modules++;
            return [
                {
                    initializeApp: (config) => {
                        apps++;
                        return { config };
                    }
                },
                {
                    getAuth: (app) => {
                        authCalls++;
                        assert.equal(app.config.appId, "app");
                        return auth;
                    }
                }
            ];
        }
    });
    const [first, second] = await Promise.all([client.initFirebase(), client.initFirebase()]);
    const third = await client.initFirebase();
    assert.equal(first.auth, auth);
    assert.equal(second.auth, auth);
    assert.equal(third.auth, auth);
    assert.equal(first.config.projectId, "project");
    assert.equal(configs, 1);
    assert.equal(modules, 1);
    assert.equal(apps, 1);
    assert.equal(authCalls, 1);
});

test("Firebase initialization refuses incomplete settings, then allows retry", async () => {
    let attempts = 0;
    let modules = 0;
    const client = createFirebaseAuthClient({
        request: async () => {
            attempts++;
            return attempts === 1 ? {} : { apiKey: "key", projectId: "p", appId: "a" };
        },
        loadModules: async () => {
            modules++;
            return [{ initializeApp: () => ({}) }, { getAuth: () => ({}) }];
        }
    });
    await assert.rejects(client.initFirebase(), /Firebase web configuration is missing/);
    const result = await client.initFirebase();
    assert.ok(result.auth);
    assert.equal(attempts, 2);
    assert.equal(modules, 1);
});

test("Firebase SDK failures do not permanently lock initialization", async () => {
    let tries = 0;
    const client = createFirebaseAuthClient({
        request: async () => ({ apiKey: "key", projectId: "p", appId: "a" }),
        loadModules: async () => {
            tries++;
            if (tries === 1) throw new Error("SDK offline");
            return [{ initializeApp: () => ({}) }, { getAuth: () => ({}) }];
        }
    });
    await assert.rejects(client.initFirebase(), /SDK offline/);
    assert.ok((await client.initFirebase()).auth);
    assert.equal(tries, 2);
});

test("Firebase client requires an API request function", () => {
    assert.throws(() => createFirebaseAuthClient(), /request function is required/);
});

test("OTP persistence stores only temporary email-code state and supports clear", () => {
    const data = new Map();
    const storage = {
        getItem: (key) => data.get(key) || null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key)
    };
    const store = createEmailOtpStore({
        key: "xtech-email-otp-session",
        getStorage: () => storage
    });
    const snapshot = {
        email: "test@example.com",
        maskedEmail: "t***@example.com",
        resendAvailableAt: 123,
        expiresAt: 456
    };
    assert.equal(store.save(snapshot), true);
    assert.equal(store.read().email, snapshot.email);
    assert.equal(data.size, 1);
    assert.equal(store.clear(), true);
    assert.equal(store.read(), null);
});

test("OTP persistence tolerates corrupt or inaccessible sessionStorage", () => {
    const badStore = createEmailOtpStore({
        key: "otp",
        getStorage: () => {
            throw new Error("Storage blocked");
        }
    });
    assert.equal(badStore.read(), null);
    assert.equal(badStore.save({ email: "test@example.com" }), false);
    assert.equal(badStore.clear(), false);
    const store = createEmailOtpStore({
        key: "otp",
        getStorage: () => ({ getItem: () => "{malformed" })
    });
    assert.equal(store.read(), null);
});

test("HTML loads API and authentication modules before app.js", () => {
    const html = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");
    const names = ["shared-utils.js", "api-client.js", "auth-client.js", "app.js"];
    const positions = names.map((name) => html.indexOf('<script src="js/' + name + '"></script>'));
    assert.ok(
        positions.every((value, index) => value >= 0 && (!index || value > positions[index - 1]))
    );
});
