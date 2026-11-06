"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerSalesRoutes } = require("../backend/routes/sales.routes");
const { operationalSale } = require("../backend/utils/serialization");

const NOW = "2026-11-06T00:00:00.000Z";
const product = (quantity = 10, overrides = {}) => ({
    productID: "CHEM-01", productName: "Cleaning Solution", unit: "bottle",
    quantity, active: true, ...overrides
});
const sale = (createdAt = NOW, overrides = {}) => ({
    saleID: "sale-1", customerID: null, customerName: "Walk-in", createdAt,
    items: [{ productID: "CHEM-01", quantity: 2, unitPrice: 999, lineTotal: 1998 }],
    total: 1998, ...overrides
});
const body = (overrides = {}) => ({ items: [{ productID: "CHEM-01", quantity: 3 }], notes: "Sale recorded", ...overrides });

function fixture(seed = {}, options = {}) {
    const names = ["sales", "products", "customers", "inventoryTransactions", "notifications"];
    const state = Object.fromEntries(names.map(name => [name, new Map(Object.entries(seed[name] || {}))]));
    let dbReads = 0;
    let transactions = 0;
    let generated = 0;
    const writes = [];
    const collection = name => {
        if (options.failDatabase) throw Error("Simulated database offline");
        const bucket = state[name];
        assert.ok(bucket, `Unexpected collection ${name}`);
        const ref = id => ({
            name, id,
            async get() { return { id, exists: bucket.has(id), data: () => ({ ...bucket.get(id) }) }; },
            async set(data) { bucket.set(id, { ...data }); writes.push({ name, id, type: "set", data }); },
            async update(data) {
                if (!bucket.has(id)) throw Error(`Missing ${name}/${id}`);
                bucket.set(id, { ...bucket.get(id), ...data });
                writes.push({ name, id, type: "update", data });
            }
        });
        return {
            doc: ref,
            async get() { return { docs: [...bucket].map(([id, value]) => ({ id, data: () => ({ ...value }) })) }; }
        };
    };
    const db = {
        collection,
        async runTransaction(fn) {
            transactions++;
            if (options.failTransaction) throw Error("Simulated transaction failure");
            const staged = [];
            const tx = {
                get: ref => ref.get(),
                update(ref, value) { staged.push({ type: "update", ref, value }); },
                set(ref, value) { staged.push({ type: "set", ref, value }); }
            };
            const result = await fn(tx);
            for (const entry of staged) await entry.ref[entry.type](entry.value);
            return result;
        }
    };
    const routes = [];
    const app = {
        get: (url, ...handlers) => routes.push({ method: "get", url, handlers }),
        post: (url, ...handlers) => routes.push({ method: "post", url, handlers })
    };
    const authRequired = (req, res, next) => req.authenticated ? next() : res.status(401).json({ success: false });
    const roles = (...allowed) => {
        const middleware = (req, res, next) => allowed.includes(req.profile.role)
            ? next() : res.status(403).json({ success: false });
        middleware.allowed = allowed;
        return middleware;
    };
    function normalizeItems(items) {
        if (!Array.isArray(items)) return [];
        const totals = new Map();
        for (const item of items) {
            const id = String(item?.productID || "").trim();
            const quantity = Number(item?.quantity);
            if (!id || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1000000) throw Error("Invalid item quantity");
            totals.set(id, (totals.get(id) || 0) + quantity);
        }
        return [...totals].map(([productID, quantity]) => ({ productID, quantity }));
    }
    registerSalesRoutes(app, {
        authRequired, roles, getDb: () => { dbReads++; return db; },
        operationalSale, normalizeItems,
        isValidOptionalText: (value, max) => String(value || "").length <= max,
        newDocumentId: () => `generated-${++generated}`,
        now: () => NOW,
        num: value => Number(value) || 0,
        queueCustomerNotification(transaction, uid, details) {
            if (!uid) return;
            const ref = db.collection("notifications").doc(`notice-${++generated}`);
            transaction.set(ref, { uid, ...details });
        }
    });
    async function request(method, url, data = {}) {
        const route = routes.find(r => r.method === method && r.url === url);
        assert.ok(route, `Missing route: ${method.toUpperCase()} ${url}`);
        const req = {
            authenticated: data.authenticated !== false,
            profile: { role: data.role || "admin" },
            body: data.body || {},
            user: { uid: data.uid || "staff-1", email: "staff@example.com", name: "Test Staff" }
        };
        const res = {
            code: 200, body: undefined,
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
    return { routes, request, state, writes,
        get dbReads() { return dbReads; },
        get transactions() { return transactions; },
        get generated() { return generated; }
    };
}
const seedProduct = () => ({ products: { "CHEM-01": product() } });

test("registers exactly two existing GET and POST sales routes", () => {
    const f = fixture();
    assert.deepEqual(f.routes.map(r => `${r.method} ${r.url}`), ["get /api/sales", "post /api/sales"]);
    for (const route of f.routes) assert.deepEqual(route.handlers[1].allowed, ["admin", "secretary"]);
});
test("route registration does not open a Firestore connection", () => assert.equal(fixture().dbReads, 0));
test("both sales routes require authentication and staff privileges", async () => {
    const f = fixture();
    for (const route of f.routes) {
        assert.equal((await f.request(route.method, route.url, { authenticated: false })).code, 401);
        assert.equal((await f.request(route.method, route.url, { role: "warehouse" })).code, 403);
        assert.equal((await f.request(route.method, route.url, { role: "customer" })).code, 403);
    }
    assert.equal(f.dbReads, 0);
});
test("sales list sorts newest first and removes monetary fields", async () => {
    const f = fixture({ sales: { old: sale("2026-11-01"), new: sale("2026-11-05") } });
    const res = await f.request("get", "/api/sales", { role: "secretary" });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.sales.map(s => s.id), ["new", "old"]);
    assert.ok(res.body.sales.every(s => s.total === undefined && s.items[0].unitPrice === undefined && s.items[0].lineTotal === undefined));
});
test("sales list returns empty array when no sales exist", async () => {
    const res = await fixture().request("get", "/api/sales");
    assert.deepEqual(res.body, { success: true, sales: [] });
});
test("sales list returns HTTP 500 when database is unavailable", async () => {
    const res = await fixture({}, { failDatabase: true }).request("get", "/api/sales");
    assert.equal(res.code, 500);
    assert.equal(res.body.success, false);
});
test("sale creation rejects missing items before database access", async () => {
    const f = fixture();
    const res = await f.request("post", "/api/sales", { body: { items: [] } });
    assert.equal(res.code, 400);
    assert.equal(f.dbReads, 0);
});
test("sale creation rejects invalid quantity without writing", async () => {
    const f = fixture(seedProduct());
    const res = await f.request("post", "/api/sales", { body: body({ items: [{ productID: "CHEM-01", quantity: -2 }] }) });
    assert.equal(res.code, 400);
    assert.equal(f.writes.length, 0);
});
test("sale creation rejects notes longer than 500 characters", async () => {
    const f = fixture();
    const res = await f.request("post", "/api/sales", { body: body({ notes: "x".repeat(501) }) });
    assert.equal(res.code, 400);
    assert.equal(f.dbReads, 0);
});
test("sale creation rejects missing linked customer with 404", async () => {
    const f = fixture(seedProduct());
    const res = await f.request("post", "/api/sales", { body: body({ customerID: "missing" }) });
    assert.equal(res.code, 404);
    assert.equal(f.writes.length, 0);
});
test("sale creation rejects deactivated customer with 404", async () => {
    const f = fixture({ ...seedProduct(), customers: { "cust-1": { active: false, name: "Inactive" } } });
    const res = await f.request("post", "/api/sales", { body: body({ customerID: "cust-1" }) });
    assert.equal(res.code, 404);
    assert.equal(f.writes.length, 0);
});
test("walk-in sale is confirmed without notification recipient", async () => {
    const f = fixture(seedProduct());
    const res = await f.request("post", "/api/sales", { body: body() });
    assert.equal(res.code, 201);
    assert.equal(res.body.sale.status, "Confirmed");
    assert.equal(res.body.sale.customerName, "Walk-in / No registered customer");
    assert.equal(f.state.notifications.size, 0);
    assert.equal(f.state.sales.size, 1);
});
test("linked customer receives purchase_recorded notification", async () => {
    const f = fixture({ ...seedProduct(), customers: { "cust-1": { active: true, name: "A Customer", userUID: "customer-user" } } });
    const res = await f.request("post", "/api/sales", { body: body({ customerID: "cust-1" }) });
    assert.equal(res.code, 201);
    assert.equal(res.body.sale.customerName, "A Customer");
    assert.equal(res.body.sale.customerUID, "customer-user");
    assert.equal(f.state.notifications.size, 1);
    const alert = [...f.state.notifications.values()][0];
    assert.equal(alert.uid, "customer-user");
    assert.equal(alert.type, "purchase_recorded");
    assert.equal(alert.relatedId, res.body.sale.saleID);
});
test("single-product sale deducts inventory atomically and writes SALE_OUT audit", async () => {
    const f = fixture(seedProduct());
    const res = await f.request("post", "/api/sales", { role: "secretary", body: body() });
    assert.equal(res.code, 201);
    assert.equal(f.transactions, 1);
    assert.equal(f.state.products.get("CHEM-01").quantity, 7);
    assert.equal(f.state.inventoryTransactions.size, 1);
    const audit = [...f.state.inventoryTransactions.values()][0];
    assert.equal(audit.type, "SALE_OUT");
    assert.equal(audit.previousQuantity, 10);
    assert.equal(audit.newQuantity, 7);
    assert.equal(audit.referenceID, res.body.sale.saleID);
    assert.equal(audit.source, "SALE");
});
test("sale with two products deducts each quantity and records separate audits", async () => {
    const f = fixture({ products: {
        "CHEM-01": product(10),
        "CHEM-02": product(5, { productID: "CHEM-02", productName: "Sanitizer" })
    } });
    const res = await f.request("post", "/api/sales", { body: body({ items: [
        { productID: "CHEM-01", quantity: 3 }, { productID: "CHEM-02", quantity: 2 }
    ] }) });
    assert.equal(res.code, 201);
    assert.equal(f.state.products.get("CHEM-01").quantity, 7);
    assert.equal(f.state.products.get("CHEM-02").quantity, 3);
    assert.equal(f.state.inventoryTransactions.size, 2);
    assert.equal(res.body.sale.items.length, 2);
});
test("duplicate product IDs consolidate into one deduction", async () => {
    const f = fixture(seedProduct());
    const res = await f.request("post", "/api/sales", { body: body({ items: [
        { productID: "CHEM-01", quantity: 2 }, { productID: "CHEM-01", quantity: 3 }
    ] }) });
    assert.equal(res.code, 201);
    assert.equal(f.state.products.get("CHEM-01").quantity, 5);
    assert.equal(f.state.inventoryTransactions.size, 1);
    assert.equal(res.body.sale.items[0].quantity, 5);
});
test("missing product refuses sale without inventory writes", async () => {
    const f = fixture();
    const res = await f.request("post", "/api/sales", { body: body() });
    assert.equal(res.code, 400);
    assert.equal(f.writes.length, 0);
});
test("archived product refuses sale without inventory writes", async () => {
    const f = fixture({ products: { "CHEM-01": product(10, { active: false }) } });
    const res = await f.request("post", "/api/sales", { body: body() });
    assert.equal(res.code, 400);
    assert.equal(f.writes.length, 0);
});
test("insufficient stock refuses sale and leaves existing stock unchanged", async () => {
    const f = fixture({ products: { "CHEM-01": product(2) } });
    const res = await f.request("post", "/api/sales", { body: body() });
    assert.equal(res.code, 400);
    assert.equal(f.state.products.get("CHEM-01").quantity, 2);
    assert.equal(f.writes.length, 0);
});
test("multi-product shortage aborts the entire transaction and all audits", async () => {
    const f = fixture({ products: {
        "CHEM-01": product(10),
        "CHEM-02": product(1, { productID: "CHEM-02", productName: "Sanitizer" })
    } });
    const res = await f.request("post", "/api/sales", { body: body({ items: [
        { productID: "CHEM-01", quantity: 3 }, { productID: "CHEM-02", quantity: 2 }
    ] }) });
    assert.equal(res.code, 400);
    assert.equal(f.writes.length, 0);
    assert.equal(f.state.products.get("CHEM-01").quantity, 10);
    assert.equal(f.state.sales.size, 0);
});
test("Firestore transaction failure produces HTTP 400 with no writes", async () => {
    const f = fixture(seedProduct(), { failTransaction: true });
    const res = await f.request("post", "/api/sales", { body: body() });
    assert.equal(res.code, 400);
    assert.equal(f.writes.length, 0);
    assert.equal(f.state.sales.size, 0);
});
