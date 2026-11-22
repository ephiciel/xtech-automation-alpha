"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    parsePriceCents,
    resolvePriceCents,
    calculateLineTotalCents
} = require("../backend/utils/pricing");

test("converts pesos into exact centavos", () => {
    assert.equal(parsePriceCents("250"), 25000);
    assert.equal(parsePriceCents("0.01"), 1);
    assert.equal(parsePriceCents("0"), 0);
});

test("rejects invalid prices", () => {
    for (const value of ["-1", "1.999", "abc", "NaN", "Infinity", "10000000", "1e5", ""]) {
        assert.throws(() => parsePriceCents(value));
    }
});

test("uses the correct pricing priority", () => {
    const base = 25000;
    const customer = 22000;
    const override = 20000;

    assert.equal(
        resolvePriceCents({
            basePriceCents: base,
            customerPriceCents: customer,
            overridePriceCents: override
        }).priceCents,
        20000
    );

    assert.equal(
        resolvePriceCents({
            basePriceCents: base,
            customerPriceCents: customer
        }).priceCents,
        22000
    );

    assert.equal(
        resolvePriceCents({
            basePriceCents: base
        }).priceCents,
        25000
    );

    assert.equal(
        resolvePriceCents({
            basePriceCents: base,
            overridePriceCents: 0
        }).priceCents,
        0
    );
});

test("calculates totals without silently using zero", () => {
    assert.equal(calculateLineTotalCents(22000, 3), 66000);
    assert.equal(calculateLineTotalCents(null, 3), null);
    assert.throws(() => calculateLineTotalCents(22000, 0));
});
