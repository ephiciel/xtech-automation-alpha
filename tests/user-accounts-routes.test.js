"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerUserAccountRoutes } = require("../backend/routes/user-accounts.routes");

function makeApp(options = {}) {
    const routes = [];
    const events = [];
    const userData = new Map(Object.entries(options.users || {}));
    const customerData = new Map(Object.entries(options.customers || {}));
    const now = () => "2026-11-06T00:00:00.000Z";
    let firebaseAccess = 0;
    const db = {
        collection(name) {
            if (options.dbOffline) throw new Error("Simulated offline database");
            if (name === "users") return {
                async get() {
                    return { docs: [...userData].map(([id, data]) => ({ id, data: () => ({ ...data }) })) };
                },
                doc(uid) {
                    return {
                        async get() { return { exists: userData.has(uid), data: () => ({ ...userData.get(uid) }) }; },
                        async set(data) {
                            events.push(["user.set", uid, data]);
                            if (options.failUserSet) throw new Error("Firestore save failed");
                            userData.set(uid, { ...data });
                        },
                        async update(data) {
                            events.push(["user.update", uid, data]);
                            if (options.failUserUpdate) throw new Error("Firestore update failed");
                            userData.set(uid, { ...userData.get(uid), ...data });
                        }
                    };
                }
            };
            if (name === "customers") return {
                doc(id) {
                    return {
                        async set(data, settings) {
                            events.push(["customer.set", id, data, settings]);
                            customerData.set(id, { ...customerData.get(id), ...data });
                        }
                    };
                }
            };
            throw new Error(`Unexpected collection ${name}`);
        }
    };
    const auth = {
        async createUser(data) {
            events.push(["auth.createUser", data]);
            if (options.createError) {
                const error = new Error("Firebase creation failed");
                if (options.createError === "duplicate") error.code = "auth/email-already-exists";
                throw error;
            }
            return { uid: "new-staff-uid" };
        },
        async deleteUser(uid) { events.push(["auth.deleteUser", uid]); },
        async updateUser(uid, fields) {
            events.push(["auth.updateUser", uid, fields]);
            if (options.failAuthUpdate) throw new Error("Auth account update failed");
        }
    };
    const authRequired = (req, res, next) => {
        if (req.authenticated !== true) return res.status(401).json({ success: false });
        next();
    };
    const roles = (...allowed) => (req, res, next) => {
        if (!allowed.includes(req.profile?.role)) return res.status(403).json({ success: false });
        next();
    };
    const normalizedRole = role => role === "owner" ? "admin" : role || "customer";
    const normalizedEmail = email => String(email || "").trim().toLowerCase();
    const isValidName = name => /^[A-Za-z ]{2,80}$/.test(name);
    const isValidEmailAddress = email => /^[^@ ]+@[^@ ]+\.[^@ .]+$/.test(email);
    const isValidPassword = password => password.length >= 6 && password.length <= 128;
    const emailDomainCanReceiveMail = async email => !email.endsWith("@invalid.test");
    const app = {};
    for (const method of ["get", "post", "patch"]) {
        app[method] = (url, ...handlers) => routes.push({ method, url, handlers });
    }
    registerUserAccountRoutes(app, {
        authRequired, roles,
        getDb: () => { firebaseAccess++; return db; },
        getAuth: () => { firebaseAccess++; return auth; },
        now, serialize: data => JSON.parse(JSON.stringify(data)),
        normalizedRole, normalizedEmail, isValidName, isValidEmailAddress,
        emailDomainCanReceiveMail, isValidPassword
    });
    async function request(method, url, { authenticated = true, role = "admin", uid = "acting-admin", body = {}, params = {} } = {}) {
        const route = routes.find(r => r.method === method && r.url === url);
        assert.ok(route, `Missing ${method} ${url}`);
        const req = { authenticated, profile: { role }, user: { uid }, body, params };
        const res = {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(value) { this.body = value; return this; }
        };
        for (let i = 0; i < route.handlers.length; i++) {
            let nextCalled = false;
            await route.handlers[i](req, res, () => { nextCalled = true; });
            if (i < route.handlers.length - 1 && !nextCalled) break;
        }
        return { status: res.statusCode, data: res.body };
    }
    return { routes, events, userData, customerData, request, firebaseAccess: () => firebaseAccess };
}
const sample = (role = "secretary") => ({ name: "Mara Santos", email: "mara@example.com", password: "Passw0rd123", role });

// Endpoint definitions and guards.
test("registers exactly three existing admin account routes", () => {
    const f = makeApp();
    assert.deepEqual(f.routes.map(r => `${r.method.toUpperCase()} ${r.url}`),
        ["GET /api/users", "POST /api/users", "PATCH /api/users/:uid/status"]);
});
test("route registration does not initialize Firebase or Firestore", () => {
    assert.equal(makeApp().firebaseAccess(), 0);
});
test("all user account endpoints require a signed-in user", async () => {
    const f = makeApp();
    for (const r of f.routes) {
        const response = await f.request(r.method, r.url, { authenticated: false });
        assert.equal(response.status, 401);
    }
    assert.equal(f.firebaseAccess(), 0);
});
test("all user account endpoints deny secretary, warehouse and customer roles", async () => {
    const f = makeApp();
    for (const role of ["secretary", "warehouse", "customer"]) {
        for (const r of f.routes) assert.equal((await f.request(r.method, r.url, { role })).status, 403);
    }
    assert.equal(f.firebaseAccess(), 0);
});

// Listing.
test("user listing sorts accounts and maps the legacy owner role to admin", async () => {
    const f = makeApp({ users: {
        a: { name: "Zoe", role: "owner" },
        b: { name: "Alice", role: "secretary" }
    }});
    const response = await f.request("get", "/api/users");
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.users.map(u => u.id), ["b", "a"]);
    assert.equal(response.data.users[1].role, "admin");
});
test("user listing returns an empty list when no accounts exist", async () => {
    const response = await makeApp().request("get", "/api/users");
    assert.deepEqual(response.data, { success: true, users: [] });
});
test("user listing reports HTTP 500 when Firestore is offline", async () => {
    const response = await makeApp({ dbOffline: true }).request("get", "/api/users");
    assert.equal(response.status, 500);
    assert.equal(response.data.success, false);
});

// Staff creation validations.
test("staff creation rejects an invalid name before Firebase access", async () => {
    const f = makeApp();
    assert.equal((await f.request("post", "/api/users", { body: { ...sample(), name: "1" } })).status, 400);
    assert.equal(f.firebaseAccess(), 0);
});
test("staff creation rejects an invalid email", async () => {
    const f = makeApp();
    assert.equal((await f.request("post", "/api/users", { body: { ...sample(), email: "not-an-email" } })).status, 400);
    assert.equal(f.firebaseAccess(), 0);
});
test("staff creation rejects email domains that cannot be verified", async () => {
    const f = makeApp();
    assert.equal((await f.request("post", "/api/users", { body: { ...sample(), email: "mara@invalid.test" } })).status, 400);
    assert.equal(f.firebaseAccess(), 0);
});
test("staff creation rejects a password shorter than six characters", async () => {
    const f = makeApp();
    assert.equal((await f.request("post", "/api/users", { body: { ...sample(), password: "abc" } })).status, 400);
    assert.equal(f.firebaseAccess(), 0);
});
test("staff creation denies admin, owner, customer and undefined role escalation", async () => {
    const f = makeApp();
    for (const role of ["admin", "owner", "customer", undefined]) {
        assert.equal((await f.request("post", "/api/users", { body: { ...sample(), role } })).status, 400);
    }
    assert.equal(f.firebaseAccess(), 0);
});
test("creating secretary saves Firebase account and Firestore profile", async () => {
    const f = makeApp();
    const response = await f.request("post", "/api/users", { body: sample("secretary") });
    assert.equal(response.status, 201);
    assert.equal(f.userData.get("new-staff-uid").role, "secretary");
    assert.equal(f.userData.get("new-staff-uid").active, true);
    assert.ok(f.events.some(e => e[0] === "auth.createUser"));
});
test("creating warehouse staff preserves normalized email and name", async () => {
    const f = makeApp();
    const response = await f.request("post", "/api/users", {
        body: { ...sample("warehouse"), name: "  Mara Santos  ", email: "  MARA@EXAMPLE.COM  " }
    });
    assert.equal(response.status, 201);
    const profile = f.userData.get("new-staff-uid");
    assert.equal(profile.role, "warehouse");
    assert.equal(profile.email, "mara@example.com");
    assert.equal(profile.name, "Mara Santos");
});
test("duplicate Firebase email returns original conflict message", async () => {
    const f = makeApp({ createError: "duplicate" });
    const response = await f.request("post", "/api/users", { body: sample() });
    assert.equal(response.status, 400);
    assert.match(response.data.message, /email already exists/i);
    assert.ok(!f.events.some(e => e[0] === "auth.deleteUser"));
});
test("Firestore failure after Auth creation rolls back the new Auth user", async () => {
    const f = makeApp({ failUserSet: true });
    const response = await f.request("post", "/api/users", { body: sample() });
    assert.equal(response.status, 400);
    assert.ok(f.events.some(e => e[0] === "auth.deleteUser" && e[1] === "new-staff-uid"));
});

// Account activation/deactivation.
test("admin cannot deactivate own account", async () => {
    const f = makeApp({ users: { "acting-admin": { role: "admin", active: true } } });
    const response = await f.request("patch", "/api/users/:uid/status", {
        params: { uid: "acting-admin" }, body: { active: false }
    });
    assert.equal(response.status, 400);
    assert.equal(f.firebaseAccess(), 0);
});
test("status update returns HTTP 404 for unknown account", async () => {
    const f = makeApp();
    const response = await f.request("patch", "/api/users/:uid/status", { params: { uid: "missing" } });
    assert.equal(response.status, 404);
});
test("deactivating staff updates Firestore and disables Firebase user", async () => {
    const f = makeApp({ users: { staff: { role: "secretary", active: true } } });
    const response = await f.request("patch", "/api/users/:uid/status", {
        params: { uid: "staff" }, body: { active: false }
    });
    assert.equal(response.status, 200);
    assert.equal(f.userData.get("staff").active, false);
    assert.ok(f.events.some(e => e[0] === "auth.updateUser" && e[2].disabled === true));
});
test("activating staff enables its Firebase user", async () => {
    const f = makeApp({ users: { staff: { role: "warehouse", active: false } } });
    const response = await f.request("patch", "/api/users/:uid/status", {
        params: { uid: "staff" }, body: { active: true }
    });
    assert.equal(response.status, 200);
    assert.equal(f.userData.get("staff").active, true);
    assert.ok(f.events.some(e => e[0] === "auth.updateUser" && e[2].disabled === false));
});
test("changing linked customer status also updates their customer document", async () => {
    const f = makeApp({ users: { cust: { role: "customer", customerID: "customer-1", active: true } } });
    const response = await f.request("patch", "/api/users/:uid/status", {
        params: { uid: "cust" }, body: { active: false }
    });
    assert.equal(response.status, 200);
    assert.equal(f.customerData.get("customer-1").active, false);
    assert.ok(f.events.some(e => e[0] === "customer.set" && e[3]?.merge === true));
});
test("unlinked customer status update does not write a customer document", async () => {
    const f = makeApp({ users: { cust: { role: "customer", active: true } } });
    assert.equal((await f.request("patch", "/api/users/:uid/status", { params: { uid: "cust" } })).status, 200);
    assert.ok(!f.events.some(e => e[0] === "customer.set"));
});
test("Auth status synchronization failure returns HTTP 500", async () => {
    const f = makeApp({ users: { staff: { role: "warehouse" } }, failAuthUpdate: true });
    const response = await f.request("patch", "/api/users/:uid/status", { params: { uid: "staff" } });
    assert.equal(response.status, 500);
    assert.equal(response.data.success, false);
});
