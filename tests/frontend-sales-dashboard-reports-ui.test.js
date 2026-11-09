"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const src = (file) => fs.readFileSync(path.join(root, "frontend/js", file), "utf8");
const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend/js/app.js"), "utf8");
const inventory = [
    {
        productID: "CHEM-01",
        productName: "Cleaner",
        category: "Cleaning Supply",
        unit: "bottle",
        quantity: 5,
        reorderLevel: 2
    }
];
const sale = {
    id: "sale-doc-1",
    saleID: "SALE-001",
    customerID: "C-01",
    customerName: "Alice",
    status: "Confirmed",
    createdAt: "2026-11-09",
    createdByName: "Owner",
    items: [{ productID: "CHEM-01", productName: "Cleaner", quantity: 2 }],
    notes: "Paid"
};
const report = {
    metrics: {
        totalProducts: 1,
        lowStock: 0,
        activeCustomers: 1,
        sales: 1,
        unitsSold: 2,
        pickups: 1
    },
    generatedAt: "2026-11-09T03:00:00Z",
    period: { start: null, end: null },
    inventory,
    lowStock: [],
    transactions: [
        {
            type: "STOCK_IN",
            productName: "Cleaner",
            productID: "CHEM-01",
            quantity: 3,
            previousQuantity: 2,
            newQuantity: 5,
            reason: "Restock",
            createdAt: "2026-11-09",
            performedBy: "Admin"
        }
    ],
    sales: [sale],
    pickups: [
        {
            pickupID: "PU-1",
            customerName: "Alice",
            status: "Completed",
            requestedDate: "2026-11-10",
            createdAt: "2026-11-09",
            notes: "Gate"
        }
    ]
};
const dashboard = {
    metrics: {
        totalProducts: 1,
        lowStock: 0,
        customers: 1,
        pendingPickups: 1,
        totalSales: 1,
        totalUnitsSold: 2
    },
    inventory: [{ name: "Cleaner", quantity: 5 }],
    weeklyPickups: [{ date: "Nov 9", count: 1 }],
    weeklySales: [{ date: "Nov 9", unitsSold: 2 }],
    lowStockProducts: []
};

function harness({
    responses = {},
    confirmed = true,
    sales = [sale],
    chartDark = false,
    csvTransportError = null
} = {}) {
    const elements = new Map();
    const calls = [];
    const toasts = [];
    const messages = [];
    const refreshes = { inventory: 0, transactions: 0, dashboard: 0, products: 0, customers: 0 };
    const charts = [];
    const printDocuments = [];
    const downloaded = [];
    const loading = [];
    const timers = [];
    let userToken = "token-1";
    const $ = (id) => {
        if (!elements.has(id)) {
            const handlers = {};
            elements.set(id, {
                value: "",
                textContent: "",
                innerHTML: "",
                handlers,
                classList: { add() {}, remove() {} },
                addEventListener(name, fn) {
                    handlers[name] = fn;
                },
                reset() {
                    this.value = "";
                }
            });
        }
        return elements.get(id);
    };
    const esc = (value) =>
        String(value ?? "").replace(
            /[&<>"']/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]
        );
    const document = {
        body: {
            classList: { contains: (name) => name === "dark" && chartDark },
            appendChild() {}
        },
        createElement(tag) {
            if (tag === "iframe") {
                const buffer = { html: "" };
                const frame = {
                    className: "",
                    setAttribute() {},
                    isConnected: false,
                    remove() {},
                    contentDocument: {
                        open() {},
                        write(markup) {
                            buffer.html += markup;
                        },
                        close() {}
                    },
                    contentWindow: { focus() {}, print() {}, onafterprint: null }
                };
                printDocuments.push(buffer);
                return frame;
            }
            if (tag === "a")
                return {
                    href: "",
                    download: "",
                    click() {
                        downloaded.push({ href: this.href, name: this.download });
                    },
                    remove() {}
                };
            throw new Error(`Unexpected DOM element: ${tag}`);
        }
    };
    const win = {};
    for (const feature of ["sales-ui.js", "dashboard-ui.js", "reports-ui.js"]) {
        vm.runInNewContext(src(feature), { window: win }, { filename: feature });
    }
    const api = async (url, options = {}) => {
        calls.push({ url, options });
        const defaults = {
            "/api/sales": { sales },
            "/api/dashboard": dashboard,
            "/api/reports/summary": report
        };
        const result = Object.hasOwn(responses, url) ? responses[url] : defaults[url] || {};
        if (result instanceof Error) throw result;
        return typeof result === "function" ? result(options) : result;
    };
    const shared = {
        $,
        api,
        toast: (msg) => toasts.push(msg),
        setMessage: (id, msg, kind = "error") => messages.push({ id, msg, kind }),
        busy: async (_button, fn) => fn(),
        esc,
        badge: (value) => `<span>${esc(value)}</span>`,
        within: (v, a, b) => (!a || v >= a) && (!b || v <= b),
        fmtDateTime: (v) => String(v),
        fmtDate: (v) => String(v),
        customerNameFor: (id) => (id === "C-01" ? "Alice" : "Walk-in"),
        itemSummary: (items) =>
            items.map((i) => `${esc(i.productName || i.productID)} x ${i.quantity}`).join(" / "),
        productById: (id) => inventory.find((p) => p.productID === id),
        validatePositiveWholeNumber: (v) => {
            if (!Number.isSafeInteger(v) || v < 1) throw new Error("Quantity invalid");
            return v;
        },
        mergeFormItem: (items, id, count) => {
            const found = items.find((i) => i.productID === id);
            if (found) found.quantity += count;
            else items.push({ productID: id, quantity: count });
        },
        validateText: (v) => v,
        updateCustomerSelectors: () => refreshes.customers++,
        updateProductSelectors: () => refreshes.products++,
        loadInventory: async () => {
            refreshes.inventory++;
        },
        loadTransactions: async () => {
            refreshes.transactions++;
        },
        loadDashboard: async () => {
            refreshes.dashboard++;
        },
        ensureFormData: async () => {},
        confirm: () => confirmed,
        window: win,
        stockStatus: (p) => (p.quantity <= p.reorderLevel ? "Low Stock" : "In Stock"),
        movementTypeLabel: (code) => ({ STOCK_IN: "Stock In" })[code] || code,
        document,
        makeChart: (target, config) => {
            const chart = {
                target,
                config,
                destroyed: false,
                destroy() {
                    this.destroyed = true;
                }
            };
            charts.push(chart);
            return chart;
        },
        getProfile: () => ({ name: "Administrator" }),
        getCurrentUser: () => ({ email: "owner@example.invalid" }),
        getToken: () => userToken,
        onPendingChange: (delta) => loading.push(delta),
        fetch: async (url, opts) => {
            calls.push({ url, options: opts, csv: true });
            if (csvTransportError) throw csvTransportError;
            return { ok: true, blob: async () => ({ binary: true }) };
        },
        URL: { createObjectURL: () => "blob:mock", revokeObjectURL: () => {} },
        URLSearchParams,
        setTimeout: (cb) => {
            timers.push(cb);
            return 1;
        }
    };
    const salesUi = win.XTechSalesUi.createSalesUi(shared);
    const dashboardUi = win.XTechDashboardUi.createDashboardUi(shared);
    const reportsUi = win.XTechReportsUi.createReportsUi(shared);
    return {
        $,
        win,
        salesUi,
        dashboardUi,
        reportsUi,
        calls,
        toasts,
        messages,
        refreshes,
        charts,
        printDocuments,
        downloaded,
        loading,
        timers,
        setToken: (v) => {
            userToken = v;
        }
    };
}
const click = (h, id, event = {}) => h.$(id).handlers.click?.(event);
const submit = (h, id) =>
    h.$(id).handlers.submit?.({ preventDefault() {}, submitter: {}, target: { reset() {} } });

test("three independent modules register immutable factories", () => {
    const h = harness();
    for (const name of ["XTechSalesUi", "XTechDashboardUi", "XTechReportsUi"])
        assert.equal(Object.isFrozen(h.win[name]), true);
});
test("sales module loads existing endpoint and renders transactions", async () => {
    const h = harness();
    await h.salesUi.loadSales();
    assert.equal(h.calls[0].url, "/api/sales");
    assert.match(h.$("saleTable").innerHTML, /SALE-001/);
});
test("sales search, customer and status filters retain empty state", async () => {
    const h = harness();
    await h.salesUi.loadSales();
    h.$("saleSearch").value = "missing";
    h.$("saleSearch").handlers.input();
    assert.match(h.$("saleTable").innerHTML, /No sales transactions/);
    h.$("saleSearch").value = "";
    h.$("saleCustomerFilter").value = "C-01";
    h.$("saleCustomerFilter").handlers.input();
    assert.match(h.$("saleTable").innerHTML, /SALE-001/);
    h.$("saleStatusFilter").value = "Cancelled";
    h.$("saleStatusFilter").handlers.input();
    assert.match(h.$("saleTable").innerHTML, /No sales transactions/);
});
test("sales table escapes customer-controlled fields", async () => {
    const h = harness({ sales: [{ ...sale, customerName: "<img src=x>" }] });
    await h.salesUi.loadSales();
    assert.doesNotMatch(h.$("saleTable").innerHTML, /<img/);
    assert.match(h.$("saleTable").innerHTML, /&lt;img/);
});
test("add sale item preserves stock checks and form rendering", () => {
    const h = harness();
    h.$("saleProduct").value = "CHEM-01";
    h.$("saleQuantity").value = "2";
    click(h, "addSaleItem");
    assert.match(h.$("saleItemList").innerHTML, /Requested|<strong>2<\/strong>/);
    h.$("saleQuantity").value = "4";
    click(h, "addSaleItem");
    assert.match(h.toasts.at(-1), /Only 5/);
});
test("sale form refuses empty item list without API call", async () => {
    const h = harness();
    await submit(h, "saleForm");
    assert.match(h.messages.at(-1).msg, /Add at least one product/);
    assert.equal(h.calls.length, 0);
});
test("confirmed sale posts original items and refreshes inventory and dashboard", async () => {
    const h = harness({
        responses: { "/api/sales": { sale: { saleID: "SALE-NEW" }, sales: [sale] } }
    });
    h.$("saleProduct").value = "CHEM-01";
    h.$("saleQuantity").value = "2";
    click(h, "addSaleItem");
    h.$("saleCustomerID").value = "C-01";
    h.$("saleNotes").value = "Delivered";
    await submit(h, "saleForm");
    const posted = h.calls.find((c) => c.url === "/api/sales" && c.options.method === "POST");
    assert.ok(posted);
    assert.equal(JSON.parse(posted.options.body).items[0].quantity, 2);
    assert.equal(h.refreshes.inventory, 1);
    assert.equal(h.refreshes.transactions, 1);
    assert.equal(h.refreshes.dashboard, 1);
    assert.match(h.messages.at(-1).msg, /SALE-NEW/);
});
test("canceling sale confirmation prevents an API write", async () => {
    const h = harness({ confirmed: false });
    h.$("saleProduct").value = "CHEM-01";
    h.$("saleQuantity").value = "1";
    click(h, "addSaleItem");
    await submit(h, "saleForm");
    assert.equal(h.calls.length, 0);
});
test("removing sale items restores empty state", () => {
    const h = harness();
    h.$("saleProduct").value = "CHEM-01";
    h.$("saleQuantity").value = "1";
    click(h, "addSaleItem");
    h.win.removeSaleItem("CHEM-01");
    assert.match(h.$("saleItemList").innerHTML, /No products added/);
});
test("sale detail modal retains sold product and reference", async () => {
    const h = harness();
    await h.salesUi.loadSales();
    h.win.viewSale("sale-doc-1");
    assert.match(h.$("modalBody").innerHTML, /SALE-001/);
    assert.match(h.$("modalBody").innerHTML, /Cleaner/);
});
test("dashboard loads original endpoint, metrics, and all three chart types", async () => {
    const h = harness();
    await h.dashboardUi.loadDashboard();
    assert.equal(h.$("mProducts").textContent, 1);
    assert.equal(h.$("mUnitsSold").textContent, "2");
    assert.equal(h.charts.length, 3);
    assert.deepEqual(
        h.charts.map((c) => c.config.type),
        ["bar", "line", "line"]
    );
    assert.equal(h.dashboardUi.hasCharts(), true);
});
test("dashboard destroys prior charts on subsequent refresh", async () => {
    const h = harness();
    await h.dashboardUi.loadDashboard();
    await h.dashboardUi.loadDashboard();
    assert.equal(h.charts.length, 6);
    assert.equal(
        h.charts.slice(0, 3).every((c) => c.destroyed),
        true
    );
});
test("dashboard displays low-stock products and empty-state fallback", async () => {
    const h = harness({
        responses: {
            "/api/dashboard": { ...dashboard, lowStockProducts: [{ ...inventory[0], quantity: 1 }] }
        }
    });
    await h.dashboardUi.loadDashboard();
    assert.match(h.$("dashboardLowStock").innerHTML, /Cleaner/);
    const g = harness();
    await g.dashboardUi.loadDashboard();
    assert.match(g.$("dashboardLowStock").innerHTML, /No low-stock/);
});
test("dashboard failures show a toast and avoid unhandled rejection", async () => {
    const h = harness({ responses: { "/api/dashboard": new Error("Backend offline") } });
    await h.dashboardUi.loadDashboard();
    assert.match(h.toasts.at(-1), /Backend offline/);
});
test("dashboard refresh action remains wired", async () => {
    const h = harness();
    await click(h, "refreshDashboard");
    assert.ok(h.calls.some((c) => c.url === "/api/dashboard"));
});
test("reports query preserves date range and forbids reversed periods", () => {
    const h = harness();
    h.$("reportStart").value = "2026-11-01";
    h.$("reportEnd").value = "2026-11-09";
    assert.equal(h.reportsUi.reportQuery(), "start=2026-11-01&end=2026-11-09");
    h.$("reportStart").value = "2026-11-10";
    assert.throws(() => h.reportsUi.reportQuery(), /cannot be after/);
});
test("reports load summary with expected KPI values and period label", async () => {
    const h = harness();
    await h.reportsUi.loadReports();
    assert.equal(h.calls[0].url, "/api/reports/summary");
    assert.equal(h.$("rProducts").textContent, 1);
    assert.match(h.$("reportPeriodLabel").textContent, /All available/);
});
test("reports use date query in HTTP path", async () => {
    const h = harness({ responses: { "/api/reports/summary?start=2026-11-01": report } });
    h.$("reportStart").value = "2026-11-01";
    await h.reportsUi.loadReports();
    assert.equal(h.calls[0].url, "/api/reports/summary?start=2026-11-01");
});
test("reports provide original table columns for all four report types", async () => {
    const h = harness();
    await h.reportsUi.loadReports();
    for (const kind of ["inventory", "transactions", "sales", "pickups"]) {
        const model = h.reportsUi.reportTableRows(kind);
        assert.ok(model.title);
        assert.ok(model.headers.length);
        assert.equal(model.rows.length, 1);
    }
});
test("report tables HTML-escape generated fields", async () => {
    const h = harness({
        responses: {
            "/api/reports/summary": {
                ...report,
                inventory: [{ ...inventory[0], productName: "<script>x</script>" }]
            }
        }
    });
    await h.reportsUi.loadReports();
    h.$("reportType").value = "inventory";
    h.reportsUi.renderReportTable();
    assert.doesNotMatch(h.$("reportTableBody").innerHTML, /<script>/);
    assert.match(h.$("reportTableBody").innerHTML, /&lt;script&gt;/);
});
test("reports print summaries include inventory totals and movement volume", async () => {
    const h = harness();
    await h.reportsUi.loadReports();
    assert.ok(
        h.reportsUi
            .reportPrintSummary("inventory")
            .some(([label]) => label === "Current Total Stock")
    );
    assert.ok(
        h.reportsUi.reportPrintSummary("transactions").some(([label]) => label === "Stock Added")
    );
});
test("report print view embeds a clean document with requested report title", async () => {
    const h = harness();
    await h.reportsUi.loadReports();
    h.$("reportType").value = "inventory";
    h.reportsUi.printCurrentReport();
    assert.equal(h.printDocuments.length, 1);
    assert.match(h.printDocuments[0].html, /Inventory Report/);
    assert.match(h.printDocuments[0].html, /Generated by/);
});
test("export CSV retains Authorization Bearer and releases loading counter", async () => {
    const h = harness();
    await h.reportsUi.loadReports();
    h.$("reportType").value = "sales";
    h.setToken("fresh-token");
    await click(h, "exportCurrentCsv");
    const csv = h.calls.find((c) => c.csv);
    assert.equal(csv.url, "/api/reports/csv/sales");
    assert.equal(csv.options.headers.Authorization, "Bearer fresh-token");
    assert.deepEqual(h.loading, [1, -1]);
    assert.equal(h.downloaded[0].name, "xtech-sales-report.csv");
});
test("report export refreshes cache when dates changed", async () => {
    const h = harness({ responses: { "/api/reports/summary?start=2026-11-01": report } });
    await h.reportsUi.loadReports();
    h.$("reportStart").value = "2026-11-01";
    await click(h, "exportCurrentCsv");
    assert.ok(h.calls.some((c) => c.url === "/api/reports/summary?start=2026-11-01"));
});
test("report export failure always releases loading counter", async () => {
    const h = harness();
    await h.reportsUi.loadReports();
    // Eject a failing CSV transport by constructing an alternate reports instance with its own dependencies.
    // Verify failure via invalid date range which stops before the loading indicator is set.
    h.$("reportStart").value = "2026-11-30";
    h.$("reportEnd").value = "2026-11-01";
    await click(h, "exportCurrentCsv");
    assert.match(h.toasts.at(-1), /cannot be after/);
    assert.deepEqual(h.loading, []);
});
test("CSV transport rejection releases loading indicator after increment", async () => {
    const h = harness({ csvTransportError: new Error("Simulated CSV network failure") });
    await h.reportsUi.loadReports();
    await click(h, "exportCurrentCsv");
    assert.deepEqual(h.loading, [1, -1]);
    assert.match(h.toasts.at(-1), /Simulated CSV network failure/);
});
test("reports clear-dates and print button handlers remain registered", async () => {
    const h = harness();
    h.$("reportStart").value = "2026-11-01";
    h.$("reportEnd").value = "2026-11-09";
    await click(h, "clearReportDates");
    assert.equal(h.$("reportStart").value, "");
    assert.equal(h.$("reportEnd").value, "");
    await click(h, "printReport");
    assert.equal(h.printDocuments.length, 1);
});
test("frontend loads all new modules before main application", () => {
    const names = [
        "js/customer-ui.js",
        "js/pickup-ui.js",
        "js/sales-ui.js",
        "js/dashboard-ui.js",
        "js/reports-ui.js",
        "js/app.js"
    ];
    const positions = names.map((n) => html.indexOf(`<script src="${n}"></script>`));
    assert.equal(
        positions.every((pos, i) => pos >= 0 && (!i || pos > positions[i - 1])),
        true
    );
    assert.match(app, /XTechSalesUi\.createSalesUi/);
    assert.match(app, /XTechDashboardUi\.createDashboardUi/);
    assert.match(app, /XTechReportsUi\.createReportsUi/);
});
