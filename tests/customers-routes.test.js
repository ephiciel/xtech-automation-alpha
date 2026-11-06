"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerCustomerRoutes } = require("../backend/routes/customers.routes");
const { serialize, operationalSale } = require("../backend/utils/serialization");

function fixture(seed = {}, options = {}) {
    const state = Object.fromEntries(["customers", "users", "sales", "pickups"].map(k => [k, new Map(Object.entries(seed[k] || {}))]));
    const authUpdates = [];
    let dbReads = 0;
    function collection(name) {
        if (options.failDatabase) throw Error("Offline");
        const values = state[name] ||= new Map();
        const doc = id => ({
            id,
            async get() { return { id, exists: values.has(id), data: () => ({ ...values.get(id) }) }; },
            async set(data, opts) { values.set(id, opts?.merge ? { ...values.get(id), ...data } : { ...data }); },
            async update(data) { if (!values.has(id)) throw Error("Missing document"); values.set(id, { ...values.get(id), ...data }); }
        });
        function result(entries) { return { docs: entries.map(([id, data]) => ({ id, data: () => ({ ...data }) })), empty: entries.length === 0 }; }
        return {
            doc,
            async get() { return result([...values.entries()]); },
            where(field, operator, value) {
                assert.equal(operator, "==");
                let max = Infinity;
                return {
                    limit(n) { max = n; return this; },
                    async get() { return result([...values.entries()].filter(([, data]) => data[field] === value).slice(0, max)); }
                };
            }
        };
    }
    const db = { collection };
    const auth = { async updateUser(uid, changes) { authUpdates.push({ uid, changes }); } };
    const routes = [];
    const app = {};
    for (const method of ["get", "post", "put", "patch", "delete"]) app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
    const authRequired = (req, res, next) => req.authenticated ? next() : res.status(401).json({ success: false });
    const roles = (...allowed) => {
        const fn = (req, res, next) => allowed.includes(req.profile.role) ? next() : res.status(403).json({ success: false });
        fn.allowed = allowed;
        return fn;
    };
    registerCustomerRoutes(app, {
        authRequired, roles,
        getDb: () => { dbReads++; return db; }, getAuth: () => auth,
        serialize, operationalSale,
        normalizedEmail: input => String(input || "").trim().toLowerCase(),
        normalizePhilippineMobile: input => input === "bad" ? null : String(input || ""),
        isValidName: input => String(input || "").length >= 2,
        isValidEmailAddress: input => String(input || "").includes("@"),
        emailDomainCanReceiveMail: options.domainCheck || (async () => true),
        isValidOptionalText: (value, max) => String(value || "").length <= max,
        newDocumentId: () => "generated-id",
        now: () => "2026-11-06T00:00:00Z"
    });
    async function request(method, path, data = {}) {
        const route = routes.find(r => r.method === method && r.path === path);
        assert.ok(route, `${method} ${path} should be registered`);
        const req = {
            authenticated: data.authenticated !== false,
            profile: { role: data.role || "admin" },
            params: data.params || {},
            body: data.body || {},
            user: { uid: "admin-id" }
        };
        const res = { code: 200, body: undefined,
            status(code) { this.code = code; return this; },
            json(body) { this.body = body; return this; }
        };
        for (const handler of route.handlers) {
            let proceeded = false;
            await handler(req, res, () => { proceeded = true; });
            if (!proceeded) break;
        }
        return res;
    }
    return { routes, request, state, authUpdates, get dbReads() { return dbReads; } };
}
const customer = { name: "Mara Cruz", email: "Mara@example.com", phone: "09171234567", company: "AGB", address: "Davao" };

test("registers precisely five customer endpoints with secretary/admin access", () => {
    const f = fixture();
    assert.deepEqual(f.routes.map(r => `${r.method} ${r.path}`), [
        "get /api/customers", "post /api/customers", "put /api/customers/:id",
        "patch /api/customers/:id/status", "get /api/customers/:id/history"
    ]);
    for (const route of f.routes) assert.deepEqual(route.handlers[1].allowed, ["admin", "secretary"]);
});

test("route registration does not access Firebase prematurely", () => {
    assert.equal(fixture().dbReads, 0);
});

test("every customer route denies unauthenticated requests and disallowed roles", async () => {
    const f = fixture();
    for (const route of f.routes) {
        assert.equal((await f.request(route.method, route.path, { authenticated: false })).code, 401);
        assert.equal((await f.request(route.method, route.path, { role: "warehouse" })).code, 403);
        assert.equal((await f.request(route.method, route.path, { role: "customer" })).code, 403);
    }
    assert.equal(f.dbReads, 0);
});

test("lists customers alphabetically with Firestore document ids", async () => {
    const f = fixture({ customers: { z: { name: "Zeta" }, a: { name: "Alpha" } } });
    const res = await f.request("get", "/api/customers", { role: "secretary" });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.customers.map(c => c.id), ["a", "z"]);
});

test("customer list returns HTTP 500 on database error", async () => {
    const f = fixture({}, { failDatabase: true });
    const res = await f.request("get", "/api/customers");
    assert.equal(res.code, 500);
    assert.equal(res.body.success, false);
});

test("customer creation validates name before accessing Firestore", async () => {
    const f = fixture();
    const res = await f.request("post", "/api/customers", { body: { ...customer, name: "A" } });
    assert.equal(res.code, 400);
    assert.equal(f.dbReads, 0);
});

test("customer creation checks email domains and mobile formatting", async () => {
    const invalidDomain = fixture({}, { domainCheck: async () => false });
    assert.equal((await invalidDomain.request("post", "/api/customers", { body: customer })).code, 400);
    const invalidPhone = fixture();
    assert.equal((await invalidPhone.request("post", "/api/customers", { body: { ...customer, phone: "bad" } })).code, 400);
});

test("duplicate email is rejected during customer creation", async () => {
    const f = fixture({ customers: { c1: { email: "mara@example.com" } } });
    const res = await f.request("post", "/api/customers", { body: customer });
    assert.equal(res.code, 409);
});

test("customer creation stores active record with generated identifier", async () => {
    const f = fixture();
    const res = await f.request("post", "/api/customers", { body: customer });
    assert.equal(res.code, 201);
    assert.equal(f.state.customers.get("generated-id").active, true);
    assert.equal(f.state.customers.get("generated-id").email, "mara@example.com");
});

test("customer update returns 404 for missing document", async () => {
    const f = fixture();
    const res = await f.request("put", "/api/customers/:id", { params: { id: "missing" }, body: customer });
    assert.equal(res.code, 404);
});

test("customer update synchronizes linked Firestore and Firebase Auth user", async () => {
    const f = fixture({ customers: { c1: { name: "Old", email: "old@example.com", userUID: "u1" } } });
    const res = await f.request("put", "/api/customers/:id", { params: { id: "c1" }, body: customer });
    assert.equal(res.code, 200);
    assert.equal(f.state.users.get("u1").name, "Mara Cruz");
    assert.deepEqual(f.authUpdates, [{ uid: "u1", changes: { displayName: "Mara Cruz", email: "mara@example.com" } }]);
});

test("status change updates customer and linked user activation", async () => {
    const f = fixture({ customers: { c1: { userUID: "u1", active: true } } });
    const res = await f.request("patch", "/api/customers/:id/status", { params: { id: "c1" }, body: { active: false } });
    assert.equal(res.code, 200);
    assert.equal(f.state.customers.get("c1").active, false);
    assert.equal(f.state.users.get("u1").active, false);
    assert.deepEqual(f.authUpdates, [{ uid: "u1", changes: { disabled: true } }]);
});

test("customer history returns 404 when customer does not exist", async () => {
    const f = fixture();
    const res = await f.request("get", "/api/customers/:id/history", { params: { id: "missing" } });
    assert.equal(res.code, 404);
});

test("customer history filters pickups, sorts by date, removes sale prices", async () => {
    const f = fixture({
        customers: { c1: { name: "Mara" } },
        pickups: { p1: { customerID: "c1", createdAt: "2026-11-01" }, p2: { customerID: "c1", createdAt: "2026-11-03" }, p3: { customerID: "other", createdAt: "2026-11-02" } },
        sales: { s1: { customerID: "c1", total: 10, items: [{ quantity: 1, unitPrice: 10, lineTotal: 10 }] } }
    });
    const res = await f.request("get", "/api/customers/:id/history", { params: { id: "c1" } });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.pickups.map(p => p.id), ["p2", "p1"]);
    assert.equal(res.body.sales[0].total, undefined);
    assert.deepEqual(res.body.sales[0].items, [{ quantity: 1 }]);
});
