"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../frontend/js/shared-utils.js"), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: "frontend/js/shared-utils.js" });
const utils = sandbox.window.XTechSharedUtils;

// No DOM or Firebase mocks are needed: these helpers are intentionally pure.
test("shared frontend helpers load without Firebase or a DOM", () => {
    assert.ok(utils);
    assert.equal(Object.keys(utils).length, 18);
    assert.ok(Object.isFrozen(utils));
});

test("HTML escaping preserves text and neutralizes markup characters", () => {
    assert.equal(utils.esc("&<>\"'"), "&amp;&lt;&gt;&quot;&#039;");
    assert.equal(utils.esc(null), "");
});

test("date utilities preserve ranges and YYYY-MM-DD formatting", () => {
    assert.equal(utils.datePart("2026-11-07"), "2026-11-07");
    assert.equal(utils.within("2026-11-07", "2026-11-01", "2026-11-30"), true);
    assert.equal(utils.within("2026-10-31", "2026-11-01", "2026-11-30"), false);
    assert.equal(utils.datePart("not a date"), "");
});

test("name, email and Philippine mobile validation retain normalization", () => {
    assert.equal(utils.validateName("  Maria Santos  "), "Maria Santos");
    assert.equal(utils.validateEmail("  TEST@GMAIL.COM "), "test@gmail.com");
    assert.equal(utils.validatePhone("09171234567"), "+639171234567");
    assert.throws(() => utils.validateEmail("test@gmail.comcom"));
    assert.throws(() => utils.validatePhone("123456"));
});

test("product, category and quantity validators retain existing contracts", () => {
    assert.equal(utils.validateProductID("CHEM_001"), "CHEM_001");
    assert.equal(utils.validateProductName("Cleaner"), "Cleaner");
    assert.equal(utils.validateCategory("Cleaning Supply"), "Cleaning Supply");
    assert.equal(utils.validatePositiveWholeNumber("3"), 3);
    assert.throws(() => utils.validatePositiveWholeNumber("-1"));
    assert.throws(() => utils.validateCategory("Invalid Category"));
});

test("password and future-date validation retain their strictness", () => {
    assert.equal(utils.validatePassword("password"), "password");
    assert.equal(utils.validateNewPassword("Password123"), "Password123");
    assert.throws(() => utils.validateNewPassword("password"));
    assert.equal(utils.validateFutureDate("2099-12-31"), "2099-12-31");
    assert.throws(() => utils.validateFutureDate("2001-01-01"));
});

test("frontend HTML loads the shared utilities before app.js", () => {
    const html = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");
    const shared = html.indexOf('<script src="js/shared-utils.js"></script>');
    const app = html.indexOf('<script src="js/app.js"></script>');
    assert.ok(shared >= 0 && app > shared);
});
