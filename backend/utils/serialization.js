/**
 * Converts Firestore timestamps and nested objects
 * into values suitable for JSON API responses.
 *
 * @param {*} value - Value to serialize.
 * @returns {*} Serialized value.
 */
function serialize(value) {
    if (value && typeof value.toDate === "function") {
        return value.toDate().toISOString();
    }

    if (Array.isArray(value)) {
        return value.map(serialize);
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, serialize(item)])
        );
    }

    return value;
}

/**
 * Removes legacy monetary fields from product responses.
 */
function operationalProduct(value) {
    const data = serialize(value);

    if (data && typeof data === "object") {
        delete data.price;
    }

    return data;
}

/**
 * Removes legacy monetary fields from sales responses.
 */
function operationalSale(value) {
    const data = serialize(value);

    if (!data || typeof data !== "object") {
        return data;
    }

    delete data.total;

    data.items = Array.isArray(data.items)
        ? data.items.map((item) => {
              const clean = { ...item };

              delete clean.unitPrice;
              delete clean.lineTotal;

              return clean;
          })
        : [];

    return data;
}

// Allow other backend files to reuse these functions.
module.exports = {
    serialize,
    operationalProduct,
    operationalSale
};
