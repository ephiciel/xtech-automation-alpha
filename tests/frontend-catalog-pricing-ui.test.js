"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
    path.join(__dirname, "../frontend/js/catalog-pricing-ui.js"),
    "utf8"
);
const catalog = fs.readFileSync(
    path.join(__dirname, "../frontend/js/customer-products-ui.js"),
    "utf8"
);
test("catalog price editor module exports an isolated factory", () => {
    const win = {};
    vm.runInNewContext(source, { window: win, Intl });
    assert.equal(typeof win.XTechCatalogPricingUi.createCatalogPricingUi, "function");
});
test("customer catalog uses the safe catalog endpoint and displays formatted selling price", () => {
    assert.match(catalog, /api\("\/api\/catalog\/products"\)/);
    assert.match(catalog, /sellingPriceCents/);
    assert.match(catalog, /currency:\s*"PHP"/);
});
test("catalog editor uses server-derived expected price and PATCH", () => {
    assert.match(source, /expectedPriceCents:\s*product\.sellingPriceCents/);
    assert.match(source, /method:\s*"PATCH"/);
    assert.match(source, /\/standard-price/);
});
