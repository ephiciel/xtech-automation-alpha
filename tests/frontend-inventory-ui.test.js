"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../frontend/js/inventory-ui.js"), "utf8");

function harness({
    role = "admin",
    productItems = [],
    transactionItems = [],
    responses = {},
    confirmed = true
} = {}) {
    const dom = new Map();
    const requests = [];
    const toasts = [];
    const messages = [];
    const win = {};
    let products = productItems;
    let transactions = transactionItems;
    let selectorUpdates = 0;
    let dashboardLoads = 0;
    let transactionFormRefreshes = 0;
    const $ = (id) => {
        if (!dom.has(id)) {
            const handlers = {};
            dom.set(id, {
                value: "",
                innerHTML: "",
                textContent: "",
                handlers,
                disabled: false,
                classList: { add() {}, remove() {} },
                addEventListener(event, fn) {
                    handlers[event] = fn;
                },
                reset() {
                    this.value = "";
                }
            });
        }
        return dom.get(id);
    };
    const safe = (input) =>
        String(input ?? "").replace(
            /[&<>"']/g,
            (character) =>
                ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
                    character
                ]
        );
    const stockStatus = (p) =>
        Number(p.quantity) <= 0
            ? "Out of Stock"
            : Number(p.quantity) <= Number(p.reorderLevel || 0)
              ? "Low Stock"
              : "In Stock";
    const defaults = {
        "/api/products": { products: productItems },
        "/api/products/archived": { products: [] },
        "/api/inventory/transactions": { transactions: transactionItems }
    };
    const sandbox = { window: win, confirm: () => confirmed };
    vm.runInNewContext(source, sandbox, { filename: "inventory-ui.js" });
    assert.ok(Object.isFrozen(win.XTechInventoryUi));
    const ui = win.XTechInventoryUi.createInventoryUi({
        $,
        api: async (url, opts = {}) => {
            requests.push({ url, opts });
            const result = responses[url] ?? defaults[url] ?? {};
            if (result instanceof Error) throw result;
            return result;
        },
        toast: (msg) => toasts.push(msg),
        busy: async (_button, action) => action(),
        esc: safe,
        badge: (status) => `<span>${safe(status)}</span>`,
        stockStatus,
        productById: (id) => products.find((p) => p.productID === id),
        updateProductSelectors: () => {
            selectorUpdates++;
        },
        validateProductID: (value) => value,
        validateProductName: (value) => value,
        validateCategory: (value) => value,
        validateText: (value) => value,
        validatePositiveWholeNumber: (value) => {
            const n = Number(value);
            if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid quantity");
            return n;
        },
        validationError: (message) => {
            throw new Error(message);
        },
        closeModal: () => {},
        loadDashboard: async () => {
            dashboardLoads++;
        },
        ensureFormData: async () => {
            transactionFormRefreshes++;
        },
        within: (value, first, last) => (!first || value >= first) && (!last || value <= last),
        movementTypeLabel: (type) =>
            ({ STOCK_IN: "Stock In (Added)", STOCK_OUT: "Stock Out (Released)" })[type] || type,
        fmtDateTime: (value) => String(value),
        getProducts: () => products,
        setProducts: (value) => {
            products = value;
        },
        getTransactions: () => transactions,
        setTransactions: (value) => {
            transactions = value;
        },
        getProfile: () => ({ role }),
        confirm: () => confirmed
    });
    return {
        ui,
        $,
        win,
        requests,
        toasts,
        messages,
        get products() {
            return products;
        },
        get transactions() {
            return transactions;
        },
        get selectorUpdates() {
            return selectorUpdates;
        },
        get dashboardLoads() {
            return dashboardLoads;
        },
        get transactionFormRefreshes() {
            return transactionFormRefreshes;
        }
    };
}
const cleaner = {
    productID: "CHEM-01",
    productName: "Cleaning Solution",
    category: "Cleaning Supply",
    quantity: 2,
    reorderLevel: 3,
    unit: "bottle"
};
const sanitizer = {
    productID: "CHEM-02",
    productName: "Sanitizer",
    category: "Industrial Chemical",
    quantity: 10,
    reorderLevel: 2,
    unit: "bottle"
};

test("inventory module exposes original loading and rendering functions", () => {
    const h = harness();
    for (const method of [
        "loadInventory",
        "renderProducts",
        "loadTransactions",
        "renderTransactions"
    ]) {
        assert.equal(typeof h.ui[method], "function");
    }
    assert.ok(Object.isFrozen(h.ui));
    assert.equal(typeof h.win.editProduct, "function");
    assert.equal(typeof h.win.archiveProduct, "function");
    assert.equal(typeof h.win.restoreProduct, "function");
});

test("inventory load uses the original endpoint, updates state, table and stock total", async () => {
    const h = harness({ productItems: [cleaner, sanitizer] });
    await h.ui.loadInventory();
    assert.equal(h.requests[0].url, "/api/products");
    assert.equal(h.products.length, 2);
    assert.equal(h.$("inventoryCurrentStock").textContent, "12");
    assert.match(h.$("productTable").innerHTML, /CHEM-01/);
    assert.equal(h.selectorUpdates, 1);
});

test("product filters support category, stock status, and search", () => {
    const h = harness({ productItems: [cleaner, sanitizer] });
    h.$("productSearch").value = "chem-02";
    h.ui.renderProducts();
    assert.match(h.$("productTable").innerHTML, /Sanitizer/);
    assert.doesNotMatch(h.$("productTable").innerHTML, /Cleaning Solution/);
    h.$("productSearch").value = "";
    h.$("statusFilter").value = "Low Stock";
    h.ui.renderProducts();
    assert.match(h.$("productTable").innerHTML, /Cleaning Solution/);
    assert.doesNotMatch(h.$("productTable").innerHTML, /Sanitizer/);
    h.$("statusFilter").value = "";
    h.$("categoryFilter").value = "Industrial Chemical";
    h.ui.renderProducts();
    assert.match(h.$("productTable").innerHTML, /Sanitizer/);
});

test("only authorized inventory roles get edit and archive controls", () => {
    const h = harness({ role: "secretary", productItems: [cleaner] });
    h.ui.renderProducts();
    assert.doesNotMatch(h.$("productTable").innerHTML, /onclick="editProduct/);
    const staff = harness({ role: "warehouse", productItems: [cleaner] });
    staff.ui.renderProducts();
    assert.match(staff.$("productTable").innerHTML, /onclick="editProduct/);
});

test("product rendering escapes product fields", () => {
    const h = harness({ productItems: [{ ...cleaner, productName: "<script>alert(1)</script>" }] });
    h.ui.renderProducts();
    assert.doesNotMatch(h.$("productTable").innerHTML, /<script>/);
    assert.match(h.$("productTable").innerHTML, /&lt;script&gt;/);
});

test("archive operation requires confirmation and preserves PATCH endpoint", async () => {
    const declined = harness({ productItems: [cleaner], confirmed: false });
    await declined.win.archiveProduct("CHEM-01");
    assert.equal(declined.requests.length, 0);
    const accepted = harness({ productItems: [cleaner], confirmed: true });
    await accepted.win.archiveProduct("CHEM-01");
    assert.equal(accepted.requests[0].url, "/api/products/CHEM-01/archive");
    assert.equal(accepted.requests[0].opts.method, "PATCH");
    assert.equal(accepted.dashboardLoads, 1);
});

test("restoring archived products calls the correct PATCH endpoint", async () => {
    const h = harness({ productItems: [cleaner] });
    await h.win.restoreProduct("CHEM-01");
    assert.equal(h.requests[0].url, "/api/products/CHEM-01/restore");
    assert.equal(h.requests[0].opts.method, "PATCH");
    assert.equal(h.dashboardLoads, 1);
});

test("stock form selection maintains in/out input action wiring", async () => {
    const h = harness({ productItems: [cleaner] });
    assert.equal(typeof h.$("stockInBtn").handlers.click, "function");
    assert.equal(typeof h.$("stockOutBtn").handlers.click, "function");
    await h.$("stockInBtn").handlers.click();
    assert.match(h.$("modalBody").innerHTML, /Stock In/);
    assert.equal(h.requests[0].url, "/api/products");
    assert.equal(typeof h.$("stockForm").handlers.submit, "function");
});

test("stock submit rejects nonpositive quantity before API writes", async () => {
    const h = harness({ productItems: [cleaner] });
    await h.$("stockOutBtn").handlers.click();
    h.$("stockProduct").value = "CHEM-01";
    h.$("stockQuantity").value = "0";
    h.$("stockReason").value = "Damaged items";
    await h.$("stockForm").handlers.submit({ preventDefault() {}, submitter: null });
    assert.equal(
        h.requests.some((r) => r.url.includes("/api/inventory/stock-out")),
        false
    );
    assert.ok(h.toasts.includes("Invalid quantity"));
});

test("transactions load and render the original stock audit fields", async () => {
    const tx = {
        productID: "CHEM-01",
        productName: "Cleaning Solution",
        type: "STOCK_IN",
        quantity: 3,
        previousQuantity: 2,
        newQuantity: 5,
        reason: "Supplier",
        performedBy: "Admin",
        createdAt: "2026-11-07"
    };
    const h = harness({ transactionItems: [tx] });
    await h.ui.loadTransactions();
    assert.equal(h.requests[0].url, "/api/inventory/transactions");
    assert.equal(h.transactionFormRefreshes, 1);
    assert.match(h.$("transactionTable").innerHTML, /Supplier/);
    assert.match(h.$("transactionTable").innerHTML, /Stock In/);
});

test("transaction date filtering retains empty-state UI", () => {
    const tx = {
        productID: "CHEM-01",
        productName: "Cleaning Solution",
        type: "STOCK_OUT",
        quantity: 1,
        previousQuantity: 2,
        newQuantity: 1,
        reason: "Damaged",
        performedBy: "Admin",
        createdAt: "2026-10-01"
    };
    const h = harness({ transactionItems: [tx] });
    h.$("transactionFrom").value = "2026-11-01";
    h.ui.renderTransactions();
    assert.match(h.$("transactionTable").innerHTML, /No stock movements match/);
});

test("inventory module registers transaction and product filter handlers", () => {
    const h = harness();
    for (const key of [
        "productSearch",
        "categoryFilter",
        "statusFilter",
        "transactionSearch",
        "transactionType",
        "transactionProduct",
        "transactionFrom",
        "transactionTo",
        "refreshTransactions",
        "clearTransactionFilters",
        "archiveBtn"
    ]) {
        assert.ok(
            h.$(key).handlers.input || h.$(key).handlers.click,
            `missing event listener: ${key}`
        );
    }
});

test("HTML loads inventory module between auth client and app", () => {
    const html = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");
    const chain = ["auth-client.js", "inventory-ui.js", "app.js"].map((name) =>
        html.indexOf(`<script src="js/${name}"></script>`)
    );
    assert.ok(chain.every((v, i) => v >= 0 && (i === 0 || v > chain[i - 1])));
});
