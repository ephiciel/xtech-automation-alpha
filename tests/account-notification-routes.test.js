"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    registerAccountNotificationRoutes
} = require("../backend/routes/account-notification.routes");

function setup(overrides = {}) {
    const registered = [];
    const app = {
        get(path, ...handlers) {
            registered.push({ method: "GET", path, handlers });
        },
        patch(path, ...handlers) {
            registered.push({ method: "PATCH", path, handlers });
        }
    };
    const authRequired = function mockAuth(req, res, next) {
        next();
    };
    const roles = (...allowed) => {
        const guard = function mockRole(req, res, next) {
            next();
        };
        guard.allowed = allowed;
        return guard;
    };
    const deps = {
        authRequired,
        roles,
        serialize: (value) => ({ serialized: value }),
        notificationCollectionFor: () => {
            throw new Error("Unexpected database access");
        },
        now: () => "mock-timestamp",
        ...overrides
    };
    registerAccountNotificationRoutes(app, deps);
    function handler(method, path) {
        const entry = registered.find((r) => r.method === method && r.path === path);
        assert.ok(entry, `Missing route ${method} ${path}`);
        return entry.handlers.at(-1);
    }
    return { registered, handler, deps, authRequired };
}
function res() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        }
    };
}
const silentLogs = async (fn) => {
    const original = console.error;
    console.error = () => {};
    try {
        await fn();
    } finally {
        console.error = original;
    }
};

test("registers precisely the four existing account and notification endpoints", () => {
    const { registered, authRequired } = setup();
    assert.deepEqual(
        registered.map((x) => `${x.method} ${x.path}`),
        [
            "GET /api/auth/me",
            "GET /api/notifications",
            "PATCH /api/notifications/read-all",
            "PATCH /api/notifications/:id/read"
        ]
    );
    registered.forEach((item) => assert.equal(item.handlers[0], authRequired));
    registered.slice(1).forEach((item) => assert.deepEqual(item.handlers[1].allowed, ["customer"]));
});

test("account profile endpoint serializes both authenticated user and profile", () => {
    const { handler } = setup();
    const response = res();
    handler("GET", "/api/auth/me")(
        { user: { uid: "test" }, profile: { role: "customer" } },
        response
    );
    assert.deepEqual(response.body, {
        success: true,
        user: { serialized: { uid: "test" } },
        profile: { serialized: { role: "customer" } }
    });
});

test("notification list sorts newest first, limits 100, and counts unread", async () => {
    const calls = [];
    const collection = {
        orderBy(...args) {
            calls.push(["orderBy", ...args]);
            return this;
        },
        limit(n) {
            calls.push(["limit", n]);
            return this;
        },
        async get() {
            return {
                docs: [
                    { id: "n1", data: () => ({ read: false }) },
                    { id: "n2", data: () => ({ read: true }) }
                ]
            };
        }
    };
    const { handler } = setup({
        notificationCollectionFor: (uid) => {
            calls.push(["uid", uid]);
            return collection;
        },
        serialize: (x) => x
    });
    const response = res();
    await handler("GET", "/api/notifications")({ user: { uid: "u1" } }, response);
    assert.equal(response.body.success, true);
    assert.equal(response.body.notifications.length, 2);
    assert.equal(response.body.unreadCount, 1);
    assert.deepEqual(calls, [
        ["uid", "u1"],
        ["orderBy", "createdAt", "desc"],
        ["limit", 100]
    ]);
});

test("notification list returns zero unread for an empty collection", async () => {
    const collection = {
        orderBy() {
            return this;
        },
        limit() {
            return this;
        },
        async get() {
            return { docs: [] };
        }
    };
    const { handler } = setup({ notificationCollectionFor: () => collection });
    const response = res();
    await handler("GET", "/api/notifications")({ user: { uid: "u1" } }, response);
    assert.deepEqual(response.body, { success: true, notifications: [], unreadCount: 0 });
});

test("notification list returns HTTP 500 if the database fails", async () => {
    const { handler } = setup({
        notificationCollectionFor: () => {
            throw Error("private db error");
        }
    });
    const response = res();
    await silentLogs(() => handler("GET", "/api/notifications")({ user: { uid: "u1" } }, response));
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.message, "Unable to load notifications.");
    assert.doesNotMatch(response.body.message, /private db error/);
});

test("read-all updates unread documents only with the timestamp", async () => {
    const calls = [];
    const docs = [
        { data: () => ({ read: false }), ref: { update: async (v) => calls.push(["n1", v]) } },
        { data: () => ({ read: true }), ref: { update: async (v) => calls.push(["n2", v]) } },
        { data: () => ({ read: undefined }), ref: { update: async (v) => calls.push(["n3", v]) } }
    ];
    const { handler } = setup({
        notificationCollectionFor: () => ({ get: async () => ({ docs }) })
    });
    const response = res();
    await handler("PATCH", "/api/notifications/read-all")({ user: { uid: "u1" } }, response);
    assert.deepEqual(response.body, { success: true, updated: 2 });
    assert.deepEqual(calls, [
        ["n1", { read: true, readAt: "mock-timestamp" }],
        ["n3", { read: true, readAt: "mock-timestamp" }]
    ]);
});

test("read-all with no unread documents reports zero updates", async () => {
    const { handler } = setup({
        notificationCollectionFor: () => ({
            get: async () => ({ docs: [{ data: () => ({ read: true }) }] })
        })
    });
    const response = res();
    await handler("PATCH", "/api/notifications/read-all")({ user: { uid: "u1" } }, response);
    assert.deepEqual(response.body, { success: true, updated: 0 });
});

test("read-all returns HTTP 500 on update failure", async () => {
    const badDoc = {
        data: () => ({ read: false }),
        ref: {
            update: async () => {
                throw Error("mock write failure");
            }
        }
    };
    const { handler } = setup({
        notificationCollectionFor: () => ({ get: async () => ({ docs: [badDoc] }) })
    });
    const response = res();
    await silentLogs(() =>
        handler("PATCH", "/api/notifications/read-all")({ user: { uid: "u1" } }, response)
    );
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.message, "Unable to mark notifications as read.");
});

test("reading one missing notification returns HTTP 404", async () => {
    const { handler } = setup({
        notificationCollectionFor: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) })
    });
    const response = res();
    await handler("PATCH", "/api/notifications/:id/read")(
        { user: { uid: "u1" }, params: { id: "missing" } },
        response
    );
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.message, "Notification not found.");
});

test("reading an unread notification updates its status", async () => {
    let target = null;
    const updates = [];
    const { handler } = setup({
        notificationCollectionFor: () => ({
            doc: (id) => {
                target = id;
                return {
                    get: async () => ({ exists: true, data: () => ({ read: false }) }),
                    update: async (v) => updates.push(v)
                };
            }
        })
    });
    const response = res();
    await handler("PATCH", "/api/notifications/:id/read")(
        { user: { uid: "u1" }, params: { id: "n42" } },
        response
    );
    assert.equal(target, "n42");
    assert.deepEqual(updates, [{ read: true, readAt: "mock-timestamp" }]);
    assert.deepEqual(response.body, { success: true });
});

test("already-read notification does not get updated again", async () => {
    let updated = false;
    const { handler } = setup({
        notificationCollectionFor: () => ({
            doc: () => ({
                get: async () => ({ exists: true, data: () => ({ read: true }) }),
                update: async () => {
                    updated = true;
                }
            })
        })
    });
    const response = res();
    await handler("PATCH", "/api/notifications/:id/read")(
        { user: { uid: "u1" }, params: { id: "n1" } },
        response
    );
    assert.equal(updated, false);
    assert.deepEqual(response.body, { success: true });
});

test("reading one notification handles Firestore errors safely", async () => {
    const { handler } = setup({
        notificationCollectionFor: () => ({
            doc: () => ({
                get: async () => {
                    throw Error("private db error");
                }
            })
        })
    });
    const response = res();
    await silentLogs(() =>
        handler("PATCH", "/api/notifications/:id/read")(
            { user: { uid: "u1" }, params: { id: "n1" } },
            response
        )
    );
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.message, "Unable to update notification.");
    assert.doesNotMatch(response.body.message, /private db error/);
});
