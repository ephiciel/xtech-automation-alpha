"use strict";

/** XTECH input validators: extracted from backend/server.js without changing validation rules. */

function normalizedEmail(email) {
    return String(email || "").trim().toLowerCase();
}


function hasOnlyAllowedNameCharacters(value) {
    return /^[\p{L}\p{M} .'-]+$/u.test(value);
}

function isValidName(value) {
    const text = String(value || "").trim();
    return text.length >= 2 &&
        text.length <= 80 &&
        /[\p{L}]/u.test(text) &&
        hasOnlyAllowedNameCharacters(text);
}

function isValidEmailAddress(value) {
    const email = normalizedEmail(value);
    if (!email || email.length > 254 || /\s/.test(email)) return false;

    const parts = email.split("@");
    if (parts.length !== 2) return false;

    const [local, domain] = parts;
    if (!local || !domain || local.length > 64) return false;
    if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;

    const labels = domain.split(".");
    if (labels.length < 2) return false;

    for (const label of labels) {
        if (!label || label.length > 63) return false;
        if (!/^[a-z0-9-]+$/i.test(label)) return false;
        if (label.startsWith("-") || label.endsWith("-")) return false;
    }

    const tld = labels.at(-1).toLowerCase();
    if (!/^[a-z]{2,24}$/i.test(tld)) return false;

    const commonEndings = ["com", "net", "org", "edu", "gov", "mil", "ph", "io", "co"];
    const repeatedEnding = labels.length >= 3 &&
        labels.at(-1).toLowerCase() === labels.at(-2).toLowerCase() &&
        commonEndings.includes(tld);

    // Catch common typing mistakes such as gmail.comcom, gmail.netnet, and gmail.phph.
    const concatenatedEnding = commonEndings.some(ending => tld === ending + ending);

    return !repeatedEnding && !concatenatedEnding;
}

function isValidOptionalText(value, maxLength) {
    const text = String(value || "").trim();

    // Reject prohibited ASCII control characters.
    // eslint-disable-next-line no-control-regex
    const hasControlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);

    return text.length <= maxLength && !hasControlCharacters;
}

function isValidPassword(value) {
    const password = String(value || "");
    return password.length >= 6 && password.length <= 128;
}

function isValidProductID(value) {
    const productID = String(value || "").trim();
    return /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(productID);
}

function isValidProductName(value) {
    const name = String(value || "").trim();
    return name.length >= 2 && name.length <= 100;
}

function isValidCategory(value) {
    return ["Industrial Chemical", "Janitorial Chemical", "Cleaning Supply", "Other"].includes(String(value || "").trim());
}

function isValidPositiveWholeNumber(value, max = 1000000) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && number <= max;
}

module.exports = {
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
};
