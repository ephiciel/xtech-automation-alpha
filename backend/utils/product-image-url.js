"use strict";

/** Validate an optional, externally hosted product photo without fetching it. */
function normalizeProductImageUrl(input) {
    if (input === undefined || input === null || input === "") return null;
    if (typeof input !== "string") {
        throw new Error("Product picture URL must be a HTTPS URL.");
    }
    // Check raw input BEFORE trim(): URL and String parsers may erase control characters.
    for (let index = 0; index < input.length; index++) {
        const charCode = input.charCodeAt(index);
        if (charCode <= 31 || charCode === 127) {
            throw new Error("Product picture URL cannot contain control characters.");
        }
    }
    const value = input.trim();
    if (!value) return null;
    if (value.length > 2048 || !/^https:\/\//i.test(value)) {
        throw new Error(
            "Product picture URL must start with https:// and be at most 2048 characters."
        );
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error("Enter a valid HTTPS product picture URL.");
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        throw new Error("Product picture URL must use HTTPS without embedded credentials.");
    }
    return parsed.href;
}

module.exports = { normalizeProductImageUrl };
