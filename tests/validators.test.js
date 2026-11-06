"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizedEmail,
    hasOnlyAllowedNameCharacters,
    isValidName,
    isValidEmailAddress,
    isValidOptionalText,
    isValidPassword,
    isValidProductID,
    isValidProductName,
    isValidCategory,
    isValidPositiveWholeNumber
} = require("../backend/utils/validators");

test("normalizes email whitespace and casing", () => {
    assert.equal(normalizedEmail("  User@Example.COM  "), "user@example.com");
    assert.equal(normalizedEmail(null), "");
});

test("supports allowed names and rejects numbers or invalid symbols", () => {
    assert.equal(hasOnlyAllowedNameCharacters("Maria Dela Cruz"), true);
    assert.equal(isValidName("José Cruz"), true);
    assert.equal(isValidName("A"), false);
    assert.equal(isValidName("John123"), false);
});

test("validates email formats and rejects repeated TLD mistakes", () => {
    assert.equal(isValidEmailAddress("  User@Example.COM  "), true);
    assert.equal(isValidEmailAddress("user@"), false);
    assert.equal(isValidEmailAddress("user@gmail.comcom"), false);
    assert.equal(isValidEmailAddress("user@gmail.com.com"), false);
    assert.equal(isValidEmailAddress("a..b@example.com"), false);
});

test("optional text enforces maximum length and blocks control characters", () => {
    assert.equal(isValidOptionalText("ordinary text", 100), true);
    assert.equal(isValidOptionalText("one two", 3), false);
    assert.equal(isValidOptionalText("bad\u0000text", 100), false);
    assert.equal(isValidOptionalText("", 0), true);
});

test("password validation keeps the existing length limits", () => {
    assert.equal(isValidPassword("123456"), true);
    assert.equal(isValidPassword("12345"), false);
    assert.equal(isValidPassword("x".repeat(128)), true);
    assert.equal(isValidPassword("x".repeat(129)), false);
});

test("product identifiers require 2-40 allowed characters", () => {
    assert.equal(isValidProductID("P001"), true);
    assert.equal(isValidProductID("P_1"), true);
    assert.equal(isValidProductID("P"), false);
    assert.equal(isValidProductID("ABC 1"), false);
});

test("product names must be 2-100 characters", () => {
    assert.equal(isValidProductName("Degreaser"), true);
    assert.equal(isValidProductName("x"), false);
    assert.equal(isValidProductName("x".repeat(101)), false);
});

test("product categories accept only the existing allowed list", () => {
    assert.equal(isValidCategory("Janitorial Chemical"), true);
    assert.equal(isValidCategory("Industrial Chemical"), true);
    assert.equal(isValidCategory("Other"), true);
    assert.equal(isValidCategory("Fictional Category"), false);
});

test("positive quantity validation rejects negatives, decimals and overflow", () => {
    assert.equal(isValidPositiveWholeNumber(1), true);
    assert.equal(isValidPositiveWholeNumber(1000001), false);
    assert.equal(isValidPositiveWholeNumber(0), false);
    assert.equal(isValidPositiveWholeNumber(-1), false);
    assert.equal(isValidPositiveWholeNumber(2.5), false);
    assert.equal(isValidPositiveWholeNumber(3, 2), false);
});
