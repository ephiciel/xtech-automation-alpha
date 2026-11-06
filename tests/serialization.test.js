"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    serialize,
    operationalProduct,
    operationalSale
} = require("../backend/utils/serialization");

test("serialize converts Firestore-like timestamps", () => {
    const timestamp = { toDate: () => new Date("2026-11-06T00:00:00.000Z") };
    const value = {
        createdAt: timestamp,
        items: [{ quantity: 3, updatedAt: timestamp }]
    };

    assert.deepEqual(serialize(value), {
        createdAt: "2026-11-06T00:00:00.000Z",
        items: [{ quantity: 3, updatedAt: "2026-11-06T00:00:00.000Z" }]
    });
});

test("serialize retains scalar values and null", () => {
    assert.equal(serialize(0), 0);
    assert.equal(serialize("text"), "text");
    assert.equal(serialize(null), null);
    assert.equal(serialize(false), false);
});

test("operationalProduct strips price without mutating original", () => {
    const original = { productID: "P001", quantity: 3, price: 50 };
    const output = operationalProduct(original);

    assert.deepEqual(output, { productID: "P001", quantity: 3 });
    assert.equal(original.price, 50);
    assert.notStrictEqual(output, original);
});

test("operationalSale strips legacy monetary fields without mutation", () => {
    const original = {
        saleID: "S001",
        total: 150,
        items: [{ productID: "P001", quantity: 3, unitPrice: 50, lineTotal: 150 }]
    };

    const output = operationalSale(original);
    assert.deepEqual(output, {
        saleID: "S001",
        items: [{ productID: "P001", quantity: 3 }]
    });
    assert.equal(original.total, 150);
    assert.equal(original.items[0].unitPrice, 50);
});

test("operationalSale supplies an empty items array when absent", () => {
    assert.deepEqual(operationalSale({ saleID: "S002" }), {
        saleID: "S002",
        items: []
    });
});

test("operationalSale tolerates null", () => {
    assert.equal(operationalSale(null), null);
});
