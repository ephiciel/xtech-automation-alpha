"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerSystemRoutes } = require("../backend/routes/system.routes");

/**
 * These tests exercise the actual registered handlers with injected services.
 * They never contact production Firebase or expose real environment secrets.
 */
const FIXED_TIMESTAMP = "2026-11-06T02:00:00.000Z";

function createHarness(overrides = {}) {
    const registered = new Map();
    const writes = [];
    let dbReads = 0;

    const app = {
        get(url, ...handlers) {
            assert.equal(registered.has(url), false, `Duplicate route: ${url}`);
            registered.set(url, handlers);
        }
    };
    const authRequired = overrides.authRequired || ((req, res, next) => {
        if (req.headers.authorization !== "Bearer valid") {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }
        next();
    });
    const roles = overrides.roles || ((...allowed) => (req, res, next) => {
        if (!allowed.includes(req.profile?.role)) {
            return res.status(403).json({ success: false, message: "You do not have permission for this action." });
        }
        next();
    });
    const getDb = overrides.getDb || (() => {
        dbReads++;
        return {
            collection(collectionName) {
                assert.equal(collectionName, "test");
                return {
                    doc(documentId) {
                        assert.equal(documentId, "connection");
                        return {
                            async set(data) {
                                writes.push(data);
                            }
                        };
                    }
                };
            }
        };
    });
    registerSystemRoutes(app, {
        authRequired,
        roles,
        getDb,
        now: overrides.now || (() => FIXED_TIMESTAMP)
    });
    return { registered, writes, dbReads: () => dbReads };
}

async function execute(routeHandlers, req = {}) {
    const request = {
        headers: {},
        profile: { role: "admin" },
        ...req
    };
    const res = {
        statusCode: 200,
        payload: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
    for (const handler of routeHandlers) {
        let nextCalled = false;
        await handler(request, res, () => { nextCalled = true; });
        if (!nextCalled) break;
    }
    return res;
}

test("registers exactly the three existing system GET endpoints", () => {
    const { registered } = createHarness();
    assert.deepEqual([...registered.keys()], [
        "/api/status",
        "/api/config",
        "/api/firebase-test"
    ]);
});

test("status endpoint returns a successful message and ISO timestamp", async () => {
    const { registered } = createHarness();
    const response = await execute(registered.get("/api/status"));
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.message, "XTECH Automation server is connected.");
    assert.equal(new Date(response.payload.timestamp).toISOString(), response.payload.timestamp);
});

test("config endpoint returns its original public configuration keys", async () => {
    const { registered } = createHarness();
    const response = await execute(registered.get("/api/config"));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.payload), [
        "apiKey", "authDomain", "projectId", "storageBucket",
        "messagingSenderId", "appId", "adminEmail", "adminMfaBypass"
    ]);
    assert.equal(typeof response.payload.adminMfaBypass, "boolean");
});

test("Firebase test route does not read Firestore during registration", () => {
    const { dbReads } = createHarness();
    assert.equal(dbReads(), 0);
});

test("Firebase test route rejects unauthenticated requests without accessing Firestore", async () => {
    const harness = createHarness();
    const response = await execute(harness.registered.get("/api/firebase-test"));
    assert.equal(response.statusCode, 401);
    assert.equal(harness.dbReads(), 0);
    assert.equal(harness.writes.length, 0);
});

test("Firebase test route rejects users without admin role", async () => {
    const harness = createHarness();
    const response = await execute(harness.registered.get("/api/firebase-test"), {
        headers: { authorization: "Bearer valid" },
        profile: { role: "warehouse" }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(harness.dbReads(), 0);
    assert.equal(harness.writes.length, 0);
});

test("Firebase test route writes its existing test document for admins", async () => {
    const harness = createHarness();
    const response = await execute(harness.registered.get("/api/firebase-test"), {
        headers: { authorization: "Bearer valid" },
        profile: { role: "admin" }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, {
        success: true,
        message: "Firebase is connected!"
    });
    assert.equal(harness.dbReads(), 1);
    assert.deepEqual(harness.writes, [{
        message: "Firebase connection successful",
        timestamp: FIXED_TIMESTAMP
    }]);
});

test("Firebase test route returns HTTP 500 on a Firestore error", async () => {
    const originalConsoleError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        const harness = createHarness({
            getDb: () => ({
                collection: () => ({
                    doc: () => ({
                        set: async () => { throw new Error("Simulated Firestore failure"); }
                    })
                })
            })
        });
        const response = await execute(harness.registered.get("/api/firebase-test"), {
            headers: { authorization: "Bearer valid" },
            profile: { role: "admin" }
        });
        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.payload, {
            success: false,
            message: "Firebase connection failed."
        });
        assert.equal(errors.length, 1);
    } finally {
        console.error = originalConsoleError;
    }
});
