"use strict";
// Stage 4.42: shared operational state, stable dependencies and pending-counter checks.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const moduleSource = read("frontend/js/app-state.js");
const appSource = read("frontend/js/app.js");
const html = read("frontend/index.html");
const validate = read("scripts/validate.js");
const ci = read(".github/workflows/ci.yml");
const pkg = JSON.parse(read("package.json"));

function factory() {
    const win = {};
    vm.runInNewContext(moduleSource, { window: win });
    return win.XTechAppState;
}
function fresh() {
    return factory().createAppState();
}
const collectionNames = ["Products", "Transactions", "Customers", "Pickups", "PickupFormItems"];

// Module declaration, state isolation and explicit dependency contracts.
test("registers the shared app state factory without a browser DOM", () => {
    assert.equal(typeof factory().createAppState, "function");
});
test("factory and public store surface are immutable", () => {
    assert(Object.isFrozen(factory()));
    assert(Object.isFrozen(fresh()));
});
test("each application instance receives independent operational state", () => {
    const a = fresh();
    const b = fresh();
    a.setProducts([{ productID: "A" }]);
    a.adjustPendingRequests(3);
    assert.equal(a.getProducts().length, 1);
    assert.equal(b.getProducts().length, 0);
    assert.equal(b.getPendingRequests(), 0);
});
test("all five collections start empty", () => {
    const s = fresh();
    for (const name of collectionNames) assert.equal(s[`get${name}`]().length, 0);
});
test("all getters and setters have fixed documented names", () => {
    const s = fresh();
    for (const name of collectionNames) {
        assert.equal(typeof s[`get${name}`], "function");
        assert.equal(typeof s[`set${name}`], "function");
    }
    assert.equal(typeof s.adjustPendingRequests, "function");
    assert.equal(typeof s.getPendingRequests, "function");
});
test("collection setters do not share backing storage across names", () => {
    const s = fresh();
    s.setProducts([1]);
    s.setCustomers([2]);
    s.setTransactions([3]);
    s.setPickups([4]);
    s.setPickupFormItems([5]);
    assert.equal(s.getProducts()[0], 1);
    assert.equal(s.getCustomers()[0], 2);
    assert.equal(s.getTransactions()[0], 3);
    assert.equal(s.getPickups()[0], 4);
    assert.equal(s.getPickupFormItems()[0], 5);
});
for (const name of collectionNames) {
    test(`${name} setter preserves live reference identity`, () => {
        const s = fresh();
        const entries = [{ id: "first" }];
        s[`set${name}`](entries);
        assert.strictEqual(s[`get${name}`](), entries);
        entries.push({ id: "second" });
        assert.equal(s[`get${name}`]().length, 2);
    });
}
for (const name of collectionNames) {
    test(`${name} getter always returns the newest assigned collection`, () => {
        const s = fresh();
        const initial = [];
        const latest = [{ id: 3 }];
        s[`set${name}`](initial);
        s[`set${name}`](latest);
        assert.strictEqual(s[`get${name}`](), latest);
    });
}
test("pending counter initializes to zero", () => {
    assert.equal(fresh().getPendingRequests(), 0);
});
test("pending counter increases for overlapping API requests", () => {
    const s = fresh();
    assert.equal(s.adjustPendingRequests(1), 1);
    assert.equal(s.adjustPendingRequests(1), 2);
    assert.equal(s.getPendingRequests(), 2);
});
test("pending counter decreases independently on request completion", () => {
    const s = fresh();
    s.adjustPendingRequests(3);
    assert.equal(s.adjustPendingRequests(-1), 2);
    assert.equal(s.adjustPendingRequests(-1), 1);
});
test("pending counter never becomes negative", () => {
    const s = fresh();
    assert.equal(s.adjustPendingRequests(-4), 0);
    s.adjustPendingRequests(1);
    assert.equal(s.adjustPendingRequests(-100), 0);
});
test("pending requests can recover after all prior requests complete", () => {
    const s = fresh();
    s.adjustPendingRequests(2);
    s.adjustPendingRequests(-2);
    assert.equal(s.adjustPendingRequests(1), 1);
});
test("live form-item arrays remain mutable for the pickup quantity workflow", () => {
    const s = fresh();
    s.setPickupFormItems([]);
    s.getPickupFormItems().push({ productID: "CHEM-1", quantity: 2 });
    s.getPickupFormItems()[0].quantity += 1;
    assert.equal(s.getPickupFormItems()[0].quantity, 3);
});
test("product updates are observed immediately by the inventory and pickup consumers", () => {
    const s = fresh();
    const pickupRead = () => s.getProducts().find((p) => p.productID === "CHEM-1");
    const inventoryRead = () => s.getProducts();
    s.setProducts([{ productID: "CHEM-1", quantity: 2 }]);
    assert.equal(pickupRead().quantity, 2);
    s.setProducts([{ productID: "CHEM-1", quantity: 9 }]);
    assert.equal(pickupRead().quantity, 9);
    assert.equal(inventoryRead()[0].quantity, 9);
});
test("customer data can be reused across customer and sales selectors", () => {
    const s = fresh();
    const customer = { id: "C-1", name: "Sample Customer" };
    s.setCustomers([customer]);
    assert.strictEqual(s.getCustomers()[0], customer);
});

test("HTML loads shared state after the app shell and before the application", () => {
    const scripts = [...html.matchAll(/<script src="js\/([^\"]+)"/g)].map((x) => x[1]);
    assert(scripts.indexOf("app-shell-ui.js") < scripts.indexOf("app-state.js"));
    assert(scripts.indexOf("app-state.js") < scripts.indexOf("app.js"));
});
test("main application constructs one store and retains session ownership", () => {
    assert.match(appSource, /XTechAppState\.createAppState\(\)/);
    assert.match(appSource, /let token = ""/);
    assert.match(appSource, /let currentUser = null/);
    assert.match(appSource, /let profile = null/);
});
test("main app no longer declares duplicate shared operational collections", () => {
    assert.doesNotMatch(
        appSource,
        /let (?:products|transactions|customers|pickups|pickupFormItems|pendingRequests)\s*=/
    );
});
test("inventory and pickup dependencies use the shared product reference", () => {
    assert.match(appSource, /getProducts: appState\.getProducts/);
    assert.equal((appSource.match(/setProducts: appState\.setProducts/g) || []).length, 2);
});
test("inventory transaction history retains shared read/write bindings", () => {
    assert.match(appSource, /getTransactions: appState\.getTransactions/);
    assert.match(appSource, /setTransactions: appState\.setTransactions/);
});
test("customer selector updates read from the same shared store", () => {
    assert.match(appSource, /const active = appState\.getCustomers\(\)\.filter/);
    assert.match(appSource, /getCustomers: appState\.getCustomers/);
    assert.match(appSource, /setCustomers: appState\.setCustomers/);
});
test("pickup UI keeps shared pickup list and mutable draft bindings", () => {
    for (const key of ["getPickups", "setPickups", "getPickupFormItems", "setPickupFormItems"]) {
        assert(appSource.includes(`${key}: appState.${key}`));
    }
});
test("form refresh writes product and customer data through the store", () => {
    assert.match(appSource, /appState\.setProducts\(data\.products \|\| \[\]\)/);
    assert.match(appSource, /appState\.setCustomers\(data\.customers \|\| \[\]\)/);
});
test("API and reporting use the identical pending-change callback", () => {
    assert.equal((appSource.match(/onPendingChange: changePending/g) || []).length, 2);
    assert.match(appSource, /appState\.adjustPendingRequests\(delta\)/);
    assert.match(appSource, /appState\.getPendingRequests\(\) <= 0/);
});
test("existing auth and notification modules remain connected", () => {
    assert.match(appSource, /XTechAuthUi\.createAuthUi/);
    assert.match(appSource, /XTechNotificationUi\.createNotificationUi/);
    assert.match(appSource, /XTechAiAssistantUi\.createAiAssistantUi/);
});
test("CI formats the new state module and static validation checks it", () => {
    assert(ci.includes("frontend/js/app-state.js"));
    assert(validate.includes("frontend/js/app-state.js"));
});
test("unit suite registers the shared app state tests", () => {
    assert(pkg.scripts["test:unit"].includes("tests/frontend-app-state.test.js"));
});
