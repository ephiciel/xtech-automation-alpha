"use strict";

const MAX_PRICE_CENTS = 999999999;

function parsePriceCents(input) {
    const value = String(input ?? "").trim();

    if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) {
        throw new Error(
            "Price must be a non-negative peso amount with at most " +
                "two decimal places (max PHP 9,999,999.99)."
        );
    }

    const [pesos, centavos = ""] = value.split(".");
    const cents = Number(pesos) * 100 + Number(centavos.padEnd(2, "0"));

    if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS) {
        throw new Error("Price is outside the permitted range.");
    }

    return cents;
}

function checkedPriceCents(value) {
    if (value === undefined || value === null) return null;

    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
        throw new Error("Stored price is invalid.");
    }

    return value;
}

function resolvePriceCents({ basePriceCents, customerPriceCents, overridePriceCents }) {
    const override = checkedPriceCents(overridePriceCents);
    const customer = checkedPriceCents(customerPriceCents);
    const base = checkedPriceCents(basePriceCents);

    if (override !== null) {
        return {
            priceCents: override,
            source: "sale_override"
        };
    }

    if (customer !== null) {
        return {
            priceCents: customer,
            source: "customer"
        };
    }

    if (base !== null) {
        return {
            priceCents: base,
            source: "product"
        };
    }

    return {
        priceCents: null,
        source: "unpriced"
    };
}

function calculateLineTotalCents(priceCents, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000) {
        throw new Error("Sale quantity must be between 1 and 1,000,000.");
    }

    const price = checkedPriceCents(priceCents);
    if (price === null) return null;

    const total = price * quantity;
    if (!Number.isSafeInteger(total)) {
        throw new Error("Sale amount is too large.");
    }

    return total;
}

module.exports = {
    MAX_PRICE_CENTS,
    parsePriceCents,
    checkedPriceCents,
    resolvePriceCents,
    calculateLineTotalCents
};
