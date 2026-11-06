"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerPickupRoutes } = require("../backend/routes/pickups.routes");
const { serialize } = require("../backend/utils/serialization");

const NOW = "2026-11-06T00:00:00.000Z";
const REQUEST_DATE = "2026-11-07";
const product = (quantity = 10, overrides = {}) => ({
    productID: "CHEM-01", productName: "Cleaning Solution", unit: "bottle",
    quantity, active: true, ...overrides
});
const pickup = (status = "Pending", overrides = {}) => ({
    pickupID: "pick-1", customerUID: "customer-uid", customerID: "customer-1",
    items: [{ productID: "CHEM-01", quantity: 3 }], status,
    createdAt: NOW, ...overrides
});
function fixture(seed = {}, options = {}) {
    const names = ["pickups", "products", "customers", "inventoryTransactions"];
    const state = Object.fromEntries(names.map(name => [name, new Map(Object.entries(seed[name] || {}))]));
    let generated = 0;
    let dbReads = 0;
    let transactionCount = 0;
    const alerts = [];
    const updates = [];
    const record = (name, id) => ({
        id,
        async get() {
            return { id, exists: state[name].has(id), data: () => ({ ...state[name].get(id) }) };
        },
        async set(data) {
            state[name].set(id, { ...data });
            updates.push({ name, id, kind: "set", data });
        },
        async update(data) {
            if (!state[name].has(id)) throw Error("Document missing");
            state[name].set(id, { ...state[name].get(id), ...data });
            updates.push({ name, id, kind: "update", data });
        }
    });
    function collection(name) {
        if (options.failDatabase) throw Error("Simulated offline database");
        const values = state[name] ||= new Map();
        const rows = entries => ({
            docs: entries.map(([id, value]) => ({ id, data: () => ({ ...value }) })),
            empty: entries.length === 0
        });
        return {
            doc: id => record(name, id),
            async get() { return rows([...values.entries()]); },
            where(field, operator, expected) {
                assert.equal(operator, "==");
                let count = Infinity;
                return {
                    limit(n) { count = n; return this; },
                    async get() {
                        return rows([...values.entries()].filter(([, val]) => val[field] === expected).slice(0, count));
                    }
                };
            }
        };
    }
    const db = {
        collection,
        async runTransaction(fn) {
            transactionCount++;
            const staged = [];
            const tx = {
                get: ref => ref.get(),
                update(ref, data) { staged.push(() => ref.update(data)); },
                set(ref, data) { staged.push(() => ref.set(data)); }
            };
            const result = await fn(tx);
            for (const write of staged) await write();
            return result;
        }
    };
    const routes = [];
    const app = {};
    for (const method of ["get", "post", "patch"]) {
        app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
    }
    const authRequired = (req, res, next) => req.authenticated ? next() : res.status(401).json({ success: false });
    const roles = (...allowed) => {
        const fn = (req, res, next) => allowed.includes(req.profile.role)
            ? next() : res.status(403).json({ success: false });
        fn.allowed = allowed;
        return fn;
    };
    function normalizeItems(items) {
        if (!Array.isArray(items)) return [];
        const totals = new Map();
        for (const item of items) {
            const productID = String(item?.productID || "").trim();
            const quantity = Number(item?.quantity);
            if (!productID || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1000000) {
                throw Error("Invalid item quantity");
            }
            totals.set(productID, (totals.get(productID) || 0) + quantity);
        }
        return [...totals].map(([productID, quantity]) => ({ productID, quantity }));
    }
    registerPickupRoutes(app, {
        authRequired, roles, getDb: () => { dbReads++; return db; },
        serialize, normalizeItems,
        isValidDateYMD: value => /^\d{4}-\d{2}-\d{2}$/.test(value),
        dateYMD: () => "2026-11-06",
        isValidOptionalText: (value, max) => String(value || "").length <= max,
        newDocumentId: () => `generated-${++generated}`,
        now: () => NOW,
        num: value => Number(value) || 0,
        queueCustomerNotification: (tx, uid, details) => { if (uid) alerts.push({ uid, ...details }); }
    });
    async function request(method, path, data = {}) {
        const route = routes.find(entry => entry.method === method && entry.path === path);
        assert.ok(route, `${method} ${path} not registered`);
        const req = {
            authenticated: data.authenticated !== false,
            profile: { role: data.role || "admin", customerID: data.customerID || "customer-1" },
            body: data.body || {}, params: data.params || {},
            user: { uid: data.uid || "admin-uid", email: "admin@example.com", name: "Test Admin" }
        };
        const res = {
            code: 200, body: null,
            status(code) { this.code = code; return this; },
            json(value) { this.body = value; return this; }
        };
        for (const handler of route.handlers) {
            let next = false;
            await handler(req, res, () => { next = true; });
            if (!next) break;
        }
        return res;
    }
    return { state, routes, request, alerts, updates, get dbReads() { return dbReads; },
        get transactionCount() { return transactionCount; } };
}

const withItem = { requestedDate: REQUEST_DATE, items: [{ productID: "CHEM-01", quantity: 3 }] };
test("registers three pickup API endpoints with unchanged roles", () => {
    const f = fixture();
    assert.deepEqual(f.routes.map(r => `${r.method} ${r.path}`), [
        "get /api/pickups", "post /api/pickups", "patch /api/pickups/:id/status"
    ]);
    for (const r of f.routes) assert.deepEqual(r.handlers[1].allowed, ["admin", "secretary", "customer"]);
});
test("registration does not touch Firebase", () => assert.equal(fixture().dbReads, 0));
test("all pickup operations require authenticated allowed roles", async () => {
    const f = fixture();
    for (const r of f.routes) {
        assert.equal((await f.request(r.method, r.path, { authenticated: false })).code, 401);
        assert.equal((await f.request(r.method, r.path, { role: "warehouse" })).code, 403);
    }
    assert.equal(f.dbReads, 0);
});
test("staff list sees pickups sorted newest first", async () => {
    const f = fixture({ pickups: {
        old: pickup("Pending", { createdAt: "2026-11-01" }),
        new: pickup("Approved", { createdAt: "2026-11-05" })
    } });
    const r = await f.request("get", "/api/pickups", { role: "secretary" });
    assert.deepEqual(r.body.pickups.map(p => p.id), ["new", "old"]);
});
test("customer lists only own pickup records", async () => {
    const f = fixture({ pickups: {
        own: pickup("Pending", { customerUID: "customer-uid" }),
        other: pickup("Pending", { customerUID: "someone-else" })
    } });
    const r = await f.request("get", "/api/pickups", { role: "customer", uid: "customer-uid" });
    assert.deepEqual(r.body.pickups.map(p => p.id), ["own"]);
});
test("pickup listing safely returns HTTP 500 on DB failure", async () => {
    const f = fixture({}, { failDatabase: true });
    const r = await f.request("get", "/api/pickups");
    assert.equal(r.code, 500);
});
test("pickup creation rejects expired dates and invalid notes", async () => {
    const f = fixture();
    assert.equal((await f.request("post", "/api/pickups", { body: { ...withItem, requestedDate: "2026-11-01" } })).code, 400);
    assert.equal((await f.request("post", "/api/pickups", { body: { ...withItem, notes: "a".repeat(501) } })).code, 400);
    assert.equal(f.transactionCount, 0);
});
test("pickup creation requires items and positive whole quantities", async () => {
    const f = fixture();
    assert.equal((await f.request("post", "/api/pickups", { body: { ...withItem, items: [] } })).code, 400);
    assert.equal((await f.request("post", "/api/pickups", { body: { ...withItem, items: [{ productID: "CHEM-01", quantity: -1 }] } })).code, 400);
    assert.equal(f.transactionCount, 0);
});
test("customer cannot create a pickup without an active profile", async () => {
    const f = fixture({ customers: { "customer-1": { active: false, userUID: "customer-uid" } } });
    const r = await f.request("post", "/api/pickups", { role: "customer", uid: "customer-uid", body: withItem });
    assert.equal(r.code, 400);
});
test("customer pickup uses authenticated profile instead of forged customer ID", async () => {
    const f = fixture({
        customers: { "customer-1": { name: "Mara", active: true, userUID: "customer-uid" } },
        products: { "CHEM-01": product() }
    });
    const r = await f.request("post", "/api/pickups", { role: "customer", uid: "customer-uid",
        body: { ...withItem, customerID: "other-customer" } });
    assert.equal(r.code, 201);
    assert.equal(r.body.pickup.customerID, "customer-1");
    assert.equal(r.body.pickup.customerUID, "customer-uid");
});
test("pickup creation checks inventory transactionally without reducing stock", async () => {
    const f = fixture({ products: { "CHEM-01": product(10) } });
    const r = await f.request("post", "/api/pickups", { body: withItem });
    assert.equal(r.code, 201);
    assert.equal(f.state.pickups.get("generated-1").status, "Pending");
    assert.equal(f.state.products.get("CHEM-01").quantity, 10);
    assert.equal(f.transactionCount, 1);
});
test("pickup creation refuses insufficient or archived inventory without storing pickup", async () => {
    for (const p of [product(2), product(10, { active: false })]) {
        const f = fixture({ products: { "CHEM-01": p } });
        const r = await f.request("post", "/api/pickups", { body: withItem });
        assert.equal(r.code, 400);
        assert.equal(f.state.pickups.size, 0);
    }
});
test("customer cannot alter another customer's pickup", async () => {
    const f = fixture({ pickups: { "pick-1": pickup() } });
    const r = await f.request("patch", "/api/pickups/:id/status", { role: "customer", uid: "stranger",
        params: { id: "pick-1" }, body: { status: "Cancelled" } });
    assert.equal(r.code, 403);
    assert.equal(f.state.pickups.get("pick-1").status, "Pending");
});
test("customer can only cancel own pending pickup", async () => {
    const f = fixture({ pickups: { "pick-1": pickup() } });
    const r = await f.request("patch", "/api/pickups/:id/status", { role: "customer", uid: "customer-uid",
        params: { id: "pick-1" }, body: { status: "Cancelled" } });
    assert.equal(r.code, 200);
    assert.equal(f.state.pickups.get("pick-1").status, "Cancelled");
});
test("customer cannot approve their pickup", async () => {
    const f = fixture({ pickups: { "pick-1": pickup() } });
    const r = await f.request("patch", "/api/pickups/:id/status", { role: "customer", uid: "customer-uid",
        params: { id: "pick-1" }, body: { status: "Approved" } });
    assert.equal(r.code, 400);
});
test("staff cannot transition completed or cancelled pickups", async () => {
    for (const oldStatus of ["Cancelled", "Completed"]) {
        const f = fixture({ pickups: { "pick-1": pickup(oldStatus) } });
        const r = await f.request("patch", "/api/pickups/:id/status", { params: { id: "pick-1" }, body: { status: "Approved" } });
        assert.equal(r.code, 400);
    }
});
test("pickup approval checks stock and emits customer notification without deduction", async () => {
    const f = fixture({ pickups: { "pick-1": pickup() }, products: { "CHEM-01": product(7) } });
    const r = await f.request("patch", "/api/pickups/:id/status", { params: { id: "pick-1" }, body: { status: "Approved" } });
    assert.equal(r.code, 200);
    assert.equal(f.state.pickups.get("pick-1").status, "Approved");
    assert.equal(f.state.products.get("CHEM-01").quantity, 7);
    assert.deepEqual(f.alerts.map(a => a.type), ["pickup_approved"]);
});
test("approval refuses inventory shortages without a status change", async () => {
    const f = fixture({ pickups: { "pick-1": pickup() }, products: { "CHEM-01": product(2) } });
    const r = await f.request("patch", "/api/pickups/:id/status", { params: { id: "pick-1" }, body: { status: "Approved" } });
    assert.equal(r.code, 400);
    assert.equal(f.state.pickups.get("pick-1").status, "Pending");
});
test("pickup completion deducts stock and writes PICKUP_OUT audit and notification", async () => {
    const f = fixture({ pickups: { "pick-1": pickup("Approved") }, products: { "CHEM-01": product(10) } });
    const r = await f.request("patch", "/api/pickups/:id/status", { params: { id: "pick-1" }, body: { status: "Completed" } });
    assert.equal(r.code, 200);
    assert.equal(f.state.pickups.get("pick-1").status, "Completed");
    assert.equal(f.state.products.get("CHEM-01").quantity, 7);
    const audit = [...f.state.inventoryTransactions.values()][0];
    assert.equal(audit.type, "PICKUP_OUT");
    assert.equal(audit.referenceID, "pick-1");
    assert.equal(audit.previousQuantity, 10);
    assert.equal(audit.newQuantity, 7);
    assert.deepEqual(f.alerts.map(a => a.type), ["pickup_completed"]);
});
test("completion with insufficient stock refuses changes and audit", async () => {
    const f = fixture({ pickups: { "pick-1": pickup("Approved") }, products: { "CHEM-01": product(2) } });
    const r = await f.request("patch", "/api/pickups/:id/status", { params: { id: "pick-1" }, body: { status: "Completed" } });
    assert.equal(r.code, 400);
    assert.equal(f.state.pickups.get("pick-1").status, "Approved");
    assert.equal(f.state.products.get("CHEM-01").quantity, 2);
    assert.equal(f.state.inventoryTransactions.size, 0);
});
test("staff can cancel approved pickup without changing stock", async () => {
    const f = fixture({ pickups: { "pick-1": pickup("Approved") }, products: { "CHEM-01": product(9) } });
    const r = await f.request("patch", "/api/pickups/:id/status", { params: { id: "pick-1" }, body: { status: "Cancelled" } });
    assert.equal(r.code, 200);
    assert.equal(f.state.pickups.get("pick-1").status, "Cancelled");
    assert.equal(f.state.products.get("CHEM-01").quantity, 9);
});
