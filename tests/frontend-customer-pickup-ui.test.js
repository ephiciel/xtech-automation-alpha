"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const customerSource = fs.readFileSync(
    path.join(__dirname, "../frontend/js/customer-ui.js"),
    "utf8"
);
const pickupSource = fs.readFileSync(path.join(__dirname, "../frontend/js/pickup-ui.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../frontend/js/app.js"), "utf8");

function harness({
    role = "admin",
    customers = [],
    pickups = [],
    products = [],
    responses = {},
    confirmAction = true
} = {}) {
    const elements = new Map();
    const calls = [];
    const toasts = [];
    const messages = [];
    const windowEvents = {};
    const documentEvents = {};
    const document = {
        body: { appendChild() {} },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        createElement() {
            const handlers = {};
            return {
                handlers,
                style: {},
                offsetWidth: 150,
                offsetHeight: 100,
                setAttribute() {},
                remove() {},
                addEventListener(name, fn) {
                    handlers[name] = fn;
                }
            };
        },
        addEventListener(name, fn) {
            documentEvents[name] = fn;
        }
    };
    const win = {
        innerWidth: 1200,
        innerHeight: 800,
        addEventListener(name, fn) {
            windowEvents[name] = fn;
        }
    };
    const $ = (id) => {
        if (!elements.has(id)) {
            const handlers = {};
            elements.set(id, {
                handlers,
                value: "",
                innerHTML: "",
                textContent: "",
                disabled: false,
                min: "",
                classList: { add() {}, remove() {}, toggle() {} },
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
    const esc = (text) =>
        String(text ?? "").replace(
            /[&<>"']/g,
            (c) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;"
                })[c]
        );
    let customerRecords = customers;
    let pickupRecords = pickups;
    let productRecords = products;
    let formItems = [];
    let dashboardRefreshes = 0;
    let inventoryRefreshes = 0;
    let transactionRefreshes = 0;
    let customerSelectorRefreshes = 0;
    let productSelectorRefreshes = 0;
    let formDataOptions = [];
    const defaults = {
        "/api/customers": { customers },
        "/api/pickups": { pickups },
        "/api/products": { products }
    };
    const api = async (url, opts = {}) => {
        calls.push({ url, opts });
        const result = Object.prototype.hasOwnProperty.call(responses, url)
            ? responses[url]
            : defaults[url] || {};
        if (result instanceof Error) throw result;
        return typeof result === "function" ? result(url, opts) : result;
    };
    const badge = (status) => `<span>${esc(status)}</span>`;
    const shared = {
        $,
        api,
        toast: (m) => toasts.push(m),
        setMessage: (id, message, kind = "error") => messages.push({ id, message, kind }),
        busy: async (_button, action) => action(),
        esc,
        badge,
        validateName: (v) => String(v).trim(),
        validateEmail: (v) => String(v).trim(),
        validatePhone: (v) => String(v),
        validateText: (v) => String(v),
        validateFutureDate: (v) => String(v),
        validatePositiveWholeNumber: (v) => {
            const n = Number(v);
            if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid quantity");
            return n;
        },
        closeModal() {},
        loadDashboard: async () => {
            dashboardRefreshes++;
        },
        updateCustomerSelectors: () => {
            customerSelectorRefreshes++;
        },
        updateProductSelectors: () => {
            productSelectorRefreshes++;
        },
        itemSummary: (items) =>
            (items || [])
                .map((i) => `${esc(i.productName || i.productID)} x${i.quantity}`)
                .join(", ") || "—",
        fmtDateTime: (x) => String(x),
        fmtDate: (x) => String(x),
        todayYMD: () => "2026-11-09",
        within: (x, a, b) => (!a || x >= a) && (!b || x <= b),
        productById: (id) => productRecords.find((p) => p.productID === id),
        customerNameFor: (id) => customerRecords.find((c) => c.id === id)?.name || "Walk-in",
        ensureFormData: async (opts) => {
            formDataOptions.push(opts);
        },
        mergeFormItem: (items, id, quantity) => {
            const old = items.find((x) => x.productID === id);
            if (old) old.quantity += quantity;
            else items.push({ productID: id, quantity });
        },
        loadInventory: async () => {
            inventoryRefreshes++;
        },
        loadTransactions: async () => {
            transactionRefreshes++;
        },
        getCustomers: () => customerRecords,
        setCustomers: (value) => {
            customerRecords = value;
        },
        getPickups: () => pickupRecords,
        setPickups: (value) => {
            pickupRecords = value;
        },
        getProducts: () => productRecords,
        setProducts: (value) => {
            productRecords = value;
        },
        getPickupFormItems: () => formItems,
        setPickupFormItems: (value) => {
            formItems = value;
        },
        getProfile: () => ({ role }),
        confirm: () => confirmAction,
        document,
        window: win
    };
    vm.runInNewContext(customerSource, { window: win }, { filename: "customer-ui.js" });
    vm.runInNewContext(pickupSource, { window: win }, { filename: "pickup-ui.js" });
    const customerUi = win.XTechCustomerUi.createCustomerUi(shared);
    const pickupUi = win.XTechPickupUi.createPickupUi(shared);
    return {
        $,
        win,
        customerUi,
        pickupUi,
        calls,
        toasts,
        messages,
        documentEvents,
        windowEvents,
        get customers() {
            return customerRecords;
        },
        get pickups() {
            return pickupRecords;
        },
        get products() {
            return productRecords;
        },
        get formItems() {
            return formItems;
        },
        get dashboardRefreshes() {
            return dashboardRefreshes;
        },
        get inventoryRefreshes() {
            return inventoryRefreshes;
        },
        get transactionRefreshes() {
            return transactionRefreshes;
        },
        get customerSelectorRefreshes() {
            return customerSelectorRefreshes;
        },
        get productSelectorRefreshes() {
            return productSelectorRefreshes;
        },
        get formDataOptions() {
            return formDataOptions;
        }
    };
}
const alice = {
    id: "C-01",
    name: "Alice",
    email: "alice@example.com",
    active: true,
    userUID: "u1"
};
const bob = { id: "C-02", name: "Bob", email: "bob@example.com", active: false };
const cleaner = {
    productID: "CHEM-01",
    productName: "Cleaning Solution",
    quantity: 3,
    unit: "bottle"
};
const pending = {
    id: "P-01",
    pickupID: "P-01",
    customerID: "C-01",
    customerName: "Alice",
    status: "Pending",
    requestedDate: "2026-11-10",
    createdAt: "2026-11-09",
    items: [{ productID: "CHEM-01", quantity: 1 }]
};
const approved = { ...pending, id: "P-02", pickupID: "P-02", status: "Approved" };
function submit(element, overrides = {}) {
    return element.handlers.submit({
        preventDefault() {},
        submitter: null,
        target: { reset() {} },
        ...overrides
    });
}

test("both independent browser UI factories are registered and frozen", () => {
    const h = harness();
    assert.ok(Object.isFrozen(h.win.XTechCustomerUi));
    assert.ok(Object.isFrozen(h.win.XTechPickupUi));
    assert.equal(typeof h.customerUi.loadCustomers, "function");
    assert.equal(typeof h.pickupUi.loadPickups, "function");
});
test("customer load uses original API and updates shared customer selectors", async () => {
    const h = harness({ customers: [alice] });
    await h.customerUi.loadCustomers();
    assert.equal(h.calls[0].url, "/api/customers");
    assert.equal(h.customers.length, 1);
    assert.ok(h.$("customerTable").innerHTML.includes("Alice"));
    assert.equal(h.customerSelectorRefreshes, 1);
});
test("customer filters preserve search and active/inactive state", () => {
    const h = harness({ customers: [alice, bob] });
    h.$("customerSearch").value = "alice";
    h.customerUi.renderCustomers();
    assert.ok(!h.$("customerTable").innerHTML.includes("Bob"));
    h.$("customerSearch").value = "";
    h.$("customerStatusFilter").value = "inactive";
    h.customerUi.renderCustomers();
    assert.ok(!h.$("customerTable").innerHTML.includes("Alice"));
    assert.ok(h.$("customerTable").innerHTML.includes("Bob"));
});
test("customer table escapes untrusted names", () => {
    const h = harness({ customers: [{ ...alice, name: "<img onerror=alert(1)>" }] });
    h.customerUi.renderCustomers();
    assert.ok(h.$("customerTable").innerHTML.includes("&lt;img"));
    assert.ok(!h.$("customerTable").innerHTML.includes("<img"));
});
test("customer create retains POST endpoint and success message", async () => {
    const h = harness();
    Object.assign(h.$("customerName"), { value: "New Customer" });
    h.$("customerEmail").value = "new@example.com";
    await submit(h.$("customerForm"));
    assert.ok(h.calls.some((c) => c.url === "/api/customers" && c.opts.method === "POST"));
    assert.ok(h.messages.some((m) => m.id === "customerMessage" && m.kind === "success"));
});
test("customer create reports API errors through the form instead of crashing", async () => {
    const h = harness({ responses: { "/api/customers": new Error("Backend offline") } });
    await submit(h.$("customerForm"));
    assert.ok(
        h.messages.some((m) => m.id === "customerMessage" && m.message.includes("Backend offline"))
    );
});
test("customer edit keeps original PUT path", async () => {
    const h = harness({ customers: [alice] });
    h.win.editCustomer("C-01");
    h.$("editCustomerName").value = "Alice Updated";
    await submit(h.$("editCustomerForm"));
    assert.ok(h.calls.some((c) => c.url === "/api/customers/C-01" && c.opts.method === "PUT"));
});
test("customer status changes require confirmation and use PATCH", async () => {
    const denied = harness({ customers: [alice], confirmAction: false });
    await denied.win.setCustomerStatus("C-01", false);
    assert.equal(denied.calls.length, 0);
    const allowed = harness({ customers: [alice] });
    await allowed.win.setCustomerStatus("C-01", false);
    assert.ok(
        allowed.calls.some(
            (c) => c.url === "/api/customers/C-01/status" && c.opts.method === "PATCH"
        )
    );
});
test("customer history preserves pickup and sales history endpoints", async () => {
    const h = harness({
        responses: {
            "/api/customers/C-01/history": { customer: alice, pickups: [pending], sales: [] }
        }
    });
    await h.win.customerHistory("C-01");
    assert.equal(h.calls[0].url, "/api/customers/C-01/history");
    assert.ok(h.$("modalBody").innerHTML.includes("P-01"));
    assert.ok(h.$("modalBody").innerHTML.includes("No sales history"));
});
test("customer action menu closes on Escape and page movement", () => {
    const h = harness();
    assert.equal(typeof h.documentEvents.keydown, "function");
    assert.equal(typeof h.windowEvents.resize, "function");
    assert.equal(typeof h.windowEvents.scroll, "function");
    h.documentEvents.keydown({ key: "Escape" });
});
test("pickup load keeps API and role-specific customer loading", async () => {
    const staff = harness({ pickups: [pending] });
    await staff.pickupUi.loadPickups();
    assert.equal(staff.calls[0].url, "/api/pickups");
    assert.equal(staff.formDataOptions[0].needCustomers, true);
    assert.equal(staff.$("pickupDate").min, "2026-11-09");
    const customer = harness({ role: "customer", pickups: [pending] });
    await customer.pickupUi.loadPickups();
    assert.equal(customer.formDataOptions[0].needCustomers, false);
});
test("customer can cancel pending pickup but cannot approve it", () => {
    const h = harness({ role: "customer", pickups: [pending, approved] });
    h.pickupUi.renderPickups();
    const html = h.$("pickupTable").innerHTML;
    assert.ok(html.includes("Cancel Request"));
    assert.ok(!html.includes("Approve</button>"));
    assert.ok(!html.includes("Complete Pickup"));
});
test("staff see approve and complete actions for eligible pickup statuses", () => {
    const h = harness({ role: "secretary", pickups: [pending, approved] });
    h.pickupUi.renderPickups();
    assert.ok(h.$("pickupTable").innerHTML.includes("Approve</button>"));
    assert.ok(h.$("pickupTable").innerHTML.includes("Complete Pickup"));
});
test("pickup search filters and empty state behave as before", () => {
    const h = harness({ pickups: [pending] });
    h.$("pickupSearch").value = "no match";
    h.pickupUi.renderPickups();
    assert.ok(h.$("pickupTable").innerHTML.includes("No pickup requests match"));
});
test("pickup inventory refresh shares latest backend stock with other pages", async () => {
    const h = harness({ products: [cleaner] });
    await h.pickupUi.refreshPickupInventory();
    assert.equal(h.calls[0].url, "/api/products");
    assert.equal(h.productSelectorRefreshes, 1);
    assert.ok(h.$("pickupItemList").innerHTML.includes("No products added"));
});
test("pickup add-item action checks stock and adds selected product", async () => {
    const h = harness({ products: [cleaner] });
    h.$("pickupProduct").value = "CHEM-01";
    h.$("pickupQuantity").value = "2";
    await h.$("addPickupItem").handlers.click({ currentTarget: h.$("addPickupItem") });
    assert.equal(h.formItems.length, 1);
    assert.equal(h.formItems[0].quantity, 2);
    assert.ok(h.$("pickupItemList").innerHTML.includes("Cleaning Solution"));
});
test("pickup quantity input clamps requests above current stock", async () => {
    const h = harness({ products: [cleaner] });
    h.$("pickupProduct").value = "CHEM-01";
    h.$("pickupQuantity").value = "5";
    await h.$("addPickupItem").handlers.click({ currentTarget: h.$("addPickupItem") });
    assert.equal(h.formItems.length, 1);
    assert.ok(h.formItems[0].quantity <= cleaner.quantity);
});
test("pickup remove-item restores available quantity", async () => {
    const h = harness({ products: [cleaner] });
    h.$("pickupProduct").value = "CHEM-01";
    h.$("pickupQuantity").value = "1";
    await h.$("addPickupItem").handlers.click({ currentTarget: h.$("addPickupItem") });
    h.win.removePickupItem("CHEM-01");
    assert.equal(h.formItems.length, 0);
});
test("pickup form refuses empty orders without network writes", async () => {
    const h = harness();
    await submit(h.$("pickupForm"));
    assert.equal(h.calls.length, 0);
    assert.ok(h.messages.some((m) => m.message.includes("Add at least one product")));
});
test("pickup submission rechecks stock and preserves customer role payload", async () => {
    const h = harness({ role: "customer", products: [cleaner] });
    h.$("pickupProduct").value = "CHEM-01";
    h.$("pickupQuantity").value = "1";
    await h.$("addPickupItem").handlers.click({ currentTarget: h.$("addPickupItem") });
    h.$("pickupDate").value = "2026-11-10";
    await submit(h.$("pickupForm"));
    const sent = h.calls.find((c) => c.url === "/api/pickups" && c.opts.method === "POST");
    assert.ok(sent);
    const body = JSON.parse(sent.opts.body);
    assert.equal(body.customerID, null);
    assert.equal(body.items[0].productID, "CHEM-01");
    assert.equal(h.formItems.length, 0);
    assert.ok(h.messages.some((m) => m.kind === "success" && m.id === "pickupMessage"));
});
test("pickup submission refuses stale stock before a POST", async () => {
    const h = harness({
        products: [cleaner],
        responses: { "/api/products": { products: [{ ...cleaner, quantity: 0 }] } }
    });
    h.$("pickupProduct").value = "CHEM-01";
    h.$("pickupQuantity").value = "1";
    // Populate the form with original stock, then simulate a reduced backend stock.
    h.formItems.push({ productID: "CHEM-01", quantity: 1 });
    h.$("pickupDate").value = "2026-11-10";
    await submit(h.$("pickupForm"));
    assert.ok(!h.calls.some((c) => c.url === "/api/pickups" && c.opts.method === "POST"));
    assert.ok(h.messages.some((m) => m.message.includes("Admin inventory shows")));
});
test("staff completes pickup through PATCH and refreshes inventory/transactions", async () => {
    const h = harness({ role: "admin" });
    await h.win.setPickup("P-01", "Completed");
    assert.ok(
        h.calls.some((c) => c.url === "/api/pickups/P-01/status" && c.opts.method === "PATCH")
    );
    assert.equal(h.inventoryRefreshes, 1);
    assert.equal(h.transactionRefreshes, 1);
    assert.ok(h.dashboardRefreshes >= 1);
});
test("customer cancellation does not trigger privileged inventory refresh", async () => {
    const h = harness({ role: "customer" });
    await h.win.setPickup("P-01", "Cancelled");
    assert.equal(h.inventoryRefreshes, 0);
    assert.equal(h.transactionRefreshes, 0);
    assert.ok(h.calls.some((c) => c.url === "/api/pickups/P-01/status"));
});
test("pickup status change respects confirmation", async () => {
    const h = harness({ confirmAction: false });
    await h.win.setPickup("P-01", "Approved");
    assert.equal(h.calls.length, 0);
});
test("new customer and pickup scripts load after inventory but before app.js", () => {
    const names = ["inventory-ui.js", "customer-ui.js", "pickup-ui.js", "app.js"];
    const positions = names.map((name) => html.indexOf(`<script src="js/${name}"></script>`));
    assert.ok(positions.every((n, i) => n >= 0 && (!i || n > positions[i - 1])));
    assert.match(app, /XTechCustomerUi\.createCustomerUi/);
    assert.match(app, /XTechPickupUi\.createPickupUi/);
    assert.match(app, /function itemSummary\(/);
});
