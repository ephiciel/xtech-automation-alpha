"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerReportDashboardRoutes } = require("../backend/routes/report-dashboard.routes");
const { serialize, operationalProduct, operationalSale } = require("../backend/utils/serialization");

const DATE = "2026-11-05T10:00:00.000Z";
const seed = () => ({
    products: {
        a: { productID: "A-1", productName: "Cleaner", category: "Chemicals", unit: "bottle", quantity: 1, reorderLevel: 2, active: true, price: 99 },
        b: { productID: "B-1", productName: "Soap", category: "Chemicals", unit: "box", quantity: 9, reorderLevel: 3, active: true },
        c: { productID: "C-1", productName: "Archived", quantity: 0, reorderLevel: 9, active: false }
    },
    customers: {
        c1: { name: "Alpha", active: true }, c2: { name: "Inactive", active: false }
    },
    sales: {
        s1: { saleID: "S-1", createdAt: DATE, status: "Confirmed", customerName: "A customer", createdByName: "Staff", items: [{ productID: "A-1", productName: "Cleaner", quantity: 3, unitPrice: 99, lineTotal: 297 }], total: 297 },
        s2: { saleID: "S-2", createdAt: "2026-11-01T10:00:00.000Z", status: "Pending", items: [{ quantity: 99 }] }
    },
    pickups: {
        q1: { pickupID: "Q-1", createdAt: DATE, requestedDate: "2026-11-07", status: "Pending", notes: 'Needs "care"' },
        q2: { pickupID: "Q-2", createdAt: "2026-11-01T10:00:00.000Z", status: "Completed" }
    },
    inventoryTransactions: {
        t1: { createdAt: DATE, type: "STOCK_OUT", productID: "A-1", productName: "Cleaner", quantity: 3, previousQuantity: 4, newQuantity: 1, reason: 'Damaged "box"', performedBy: "Staff" },
        t2: { createdAt: "2026-11-01T10:00:00.000Z", type: "STOCK_IN", productID: "B-1", productName: "Soap", quantity: 2 }
    }
});
function dateYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fixture(initial = seed(), options = {}) {
    const state = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, new Map(Object.entries(value))]));
    let dbReads = 0;
    const db = {
        collection(name) {
            if (options.failDb) throw new Error("Simulated offline database");
            dbReads++;
            const entries = [...(state[name] || new Map())].map(([id, data]) => ({ id, data: () => ({ ...data }) }));
            const snapshot = docs => ({ docs });
            return {
                async get() { return snapshot(entries); },
                where(field, comparator, value) {
                    assert.equal(comparator, "==");
                    return { async get() { return snapshot(entries.filter(doc => doc.data()[field] === value)); } };
                }
            };
        }
    };
    const routes = [];
    const app = { get: (url, ...handlers) => routes.push({ method: "get", url, handlers }) };
    const authRequired = (req, res, next) => req.authenticated ? next() : res.status(401).json({ success: false });
    const roles = (...allowed) => {
        const handler = (req, res, next) => allowed.includes(req.profile.role) ? next() : res.status(403).json({ success: false });
        handler.allowed = allowed;
        return handler;
    };
    function parseRange(req) {
        const start = String(req.query.start || "").trim();
        const end = String(req.query.end || "").trim();
        if ([start, end].some(value => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
            const error = new Error("Report dates must use YYYY-MM-DD format.");
            error.status = 400;
            throw error;
        }
        if (start && end && start > end) {
            const error = new Error("Start date cannot be after end date.");
            error.status = 400;
            throw error;
        }
        return { start, end };
    }
    const inRange = (value, start, end) => (!start || String(value).slice(0, 10) >= start) && (!end || String(value).slice(0, 10) <= end);
    registerReportDashboardRoutes(app, {
        authRequired, roles, getDb: () => db,
        operationalProduct, operationalSale, serialize, parseRange, inRange,
        dateYMD, datePart: value => String(value || "").slice(0, 10),
        num: value => Number(value) || 0
    });
    async function request(url, data = {}) {
        const route = routes.find(item => item.url === url);
        assert.ok(route, `Route not registered: ${url}`);
        const req = {
            authenticated: data.authenticated !== false,
            profile: { role: data.role || "admin" },
            params: { type: data.type || "inventory" },
            query: data.query || {}
        };
        const res = {
            code: 200, body: undefined, headers: {}, sent: undefined,
            status(code) { this.code = code; return this; },
            json(value) { this.body = value; return this; },
            setHeader(name, value) { this.headers[name] = value; },
            send(value) { this.sent = value; return this; }
        };
        for (const handler of route.handlers) {
            let next = false;
            await handler(req, res, () => { next = true; });
            if (!next) break;
        }
        return res;
    }
    return { routes, state, request, get dbReads() { return dbReads; } };
}

const summary = "/api/reports/summary";
const csv = "/api/reports/csv/:type";
const dashboard = "/api/dashboard";

test("registers precisely two report GET endpoints and one dashboard GET endpoint", () => {
    assert.deepEqual(fixture().routes.map(r => `${r.method} ${r.url}`),
        [`get ${summary}`, `get ${csv}`, `get ${dashboard}`]);
});
test("reports remain admin-only while dashboard allows admin, secretary and warehouse", () => {
    const r = fixture().routes;
    assert.deepEqual(r[0].handlers[1].allowed, ["admin"]);
    assert.deepEqual(r[1].handlers[1].allowed, ["admin"]);
    assert.deepEqual(r[2].handlers[1].allowed, ["admin", "secretary", "warehouse"]);
});
test("route registration does not touch Firebase", () => assert.equal(fixture().dbReads, 0));
test("all reporting endpoints block unauthenticated access before Firebase", async () => {
    const f = fixture();
    for (const url of [summary, csv, dashboard]) assert.equal((await f.request(url, { authenticated: false })).code, 401);
    assert.equal(f.dbReads, 0);
});
test("customer and unauthorized staff cannot retrieve restricted reports", async () => {
    const f = fixture();
    for (const url of [summary, csv]) {
        for (const role of ["customer", "secretary", "warehouse"]) assert.equal((await f.request(url, { role })).code, 403);
    }
    assert.equal((await f.request(dashboard, { role: "customer" })).code, 403);
    assert.equal(f.dbReads, 0);
});
test("secretary and warehouse may access dashboard but not reports", async () => {
    const f = fixture();
    for (const role of ["secretary", "warehouse"]) assert.equal((await f.request(dashboard, { role })).code, 200);
});
test("report summary retains status totals, confirmed units and safe product/sale serialization", async () => {
    const res = await fixture().request(summary);
    assert.equal(res.code, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.metrics.totalProducts, 2);
    assert.equal(res.body.metrics.lowStock, 1);
    assert.equal(res.body.metrics.activeCustomers, 1);
    assert.equal(res.body.metrics.sales, 2);
    assert.equal(res.body.metrics.unitsSold, 3);
    assert.equal(res.body.metrics.pickups, 2);
    assert.equal(res.body.metrics.pendingPickups, 1);
    assert.equal(res.body.metrics.completedPickups, 1);
    assert.ok(res.body.inventory.every(p => p.price === undefined && p.active !== false));
    assert.ok(res.body.sales.every(s => s.total === undefined));
});
test("summary includes a generated ISO timestamp and period", async () => {
    const res = await fixture().request(summary, { query: { start: "2026-11-01", end: "2026-11-06" } });
    assert.deepEqual(res.body.period, { start: "2026-11-01", end: "2026-11-06" });
    assert.ok(!Number.isNaN(Date.parse(res.body.generatedAt)));
});
test("summary date range filters sales, pickups and transactions, not stock totals", async () => {
    const res = await fixture().request(summary, { query: { start: "2026-11-05", end: "2026-11-05" } });
    assert.equal(res.body.sales.length, 1);
    assert.equal(res.body.transactions.length, 1);
    assert.equal(res.body.pickups.length, 1);
    assert.equal(res.body.metrics.totalProducts, 2);
    assert.equal(res.body.metrics.unitsSold, 3);
});
test("malformed date is rejected with HTTP 400 before database access", async () => {
    const f = fixture();
    const res = await f.request(summary, { query: { start: "yesterday" } });
    assert.equal(res.code, 400);
    assert.equal(f.dbReads, 0);
});
test("reversed report date range is rejected with HTTP 400", async () => {
    const res = await fixture().request(summary, { query: { start: "2026-11-06", end: "2026-11-02" } });
    assert.equal(res.code, 400);
});
test("report summary handles Firestore failure as HTTP 500", async () => {
    const res = await fixture(seed(), { failDb: true }).request(summary);
    assert.equal(res.code, 500);
    assert.equal(res.body.success, false);
});
test("inventory CSV exports only active products with original headers and stock statuses", async () => {
    const res = await fixture().request(csv, { type: "inventory" });
    assert.equal(res.code, 200);
    assert.equal(res.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.match(res.headers["Content-Disposition"], /xtech-inventory-report\.csv/);
    assert.match(res.sent, /"Product ID","Product Name"/);
    assert.match(res.sent, /"A-1","Cleaner"/);
    assert.match(res.sent, /"Low Stock"/);
    assert.match(res.sent, /"In Stock"/);
    assert.doesNotMatch(res.sent, /Archived/);
    assert.ok(res.sent.startsWith("\uFEFF"));
});
test("transaction CSV preserves movement columns, ordering and quote escaping", async () => {
    const res = await fixture().request(csv, { type: "transactions" });
    assert.match(res.sent, /"Movement Type"/);
    assert.match(res.sent, /"Damaged ""box"""/);
    assert.ok(res.sent.indexOf("STOCK_OUT") < res.sent.indexOf("STOCK_IN"));
});
test("sales CSV uses quantities without legacy prices", async () => {
    const res = await fixture().request(csv, { type: "sales" });
    assert.match(res.sent, /"Sale Reference"/);
    assert.match(res.sent, /"Cleaner x 3"/);
    assert.doesNotMatch(res.sent, /297|unitPrice|lineTotal/);
});
test("pickup CSV retains requested date, status and escaped notes", async () => {
    const res = await fixture().request(csv, { type: "pickups" });
    assert.match(res.sent, /"Requested Pickup Date"/);
    assert.match(res.sent, /"2026-11-07"/);
    assert.match(res.sent, /"Needs ""care"""/);
});
test("CSV export returns HTTP 400 for unknown report type", async () => {
    const res = await fixture().request(csv, { type: "secret" });
    assert.equal(res.code, 400);
    assert.match(res.body.message, /Unknown report type/);
});
test("CSV export validates date range before querying the database", async () => {
    const f = fixture();
    const res = await f.request(csv, { query: { end: "invalid" } });
    assert.equal(res.code, 400);
    assert.equal(f.dbReads, 0);
});
test("CSV export handles Firestore failures as HTTP 500", async () => {
    const res = await fixture(seed(), { failDb: true }).request(csv);
    assert.equal(res.code, 500);
});
test("dashboard returns live metrics and no inactive products", async () => {
    const res = await fixture().request(dashboard);
    assert.equal(res.code, 200);
    assert.equal(res.body.metrics.totalProducts, 2);
    assert.equal(res.body.metrics.lowStock, 1);
    assert.equal(res.body.metrics.customers, 1);
    assert.equal(res.body.metrics.pendingPickups, 1);
    assert.equal(res.body.metrics.totalSales, 2);
    assert.equal(res.body.metrics.totalUnitsSold, 3);
    assert.equal(res.body.inventory.length, 2);
    assert.deepEqual(res.body.inventory.map(item => item.name), ["Soap", "Cleaner"]);
});
test("dashboard seven-day series has chronological dates and count arrays", async () => {
    const res = await fixture().request(dashboard);
    assert.equal(res.body.weeklyPickups.length, 7);
    assert.equal(res.body.weeklySales.length, 7);
    const pickupDates = res.body.weeklyPickups.map(item => item.date);
    assert.deepEqual(pickupDates, [...pickupDates].sort());
    assert.deepEqual(pickupDates, res.body.weeklySales.map(item => item.date));
});
test("dashboard low-stock and recent transaction lists preserve sorting and limits", async () => {
    const data = seed();
    for (let i = 0; i < 20; i++) {
        data.products[`p${i}`] = { productID: `X${i}`, productName: `Product ${i}`, quantity: i, reorderLevel: 30, active: true };
        data.inventoryTransactions[`tx${i}`] = { createdAt: `2026-10-${String(i + 1).padStart(2, "0")}`, type: "STOCK_OUT" };
    }
    const res = await fixture(data).request(dashboard);
    assert.equal(res.body.lowStockProducts.length, 8);
    assert.equal(res.body.recentTransactions.length, 8);
    assert.equal(res.body.inventory.length, 12);
    assert.ok(res.body.lowStockProducts[0].quantity <= res.body.lowStockProducts[1].quantity);
    assert.ok(res.body.recentTransactions[0].createdAt >= res.body.recentTransactions[1].createdAt);
});
test("dashboard responds with HTTP 500 when Firestore is offline", async () => {
    const res = await fixture(seed(), { failDb: true }).request(dashboard);
    assert.equal(res.code, 500);
    assert.equal(res.body.message, "Failed to load dashboard.");
});
