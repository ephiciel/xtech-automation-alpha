"use strict";

/**
 * Server-side response minimization. Only authenticated Admin receives monetary
 * amounts from shared product, sales, and customer-history routes.
 * This never changes stored records or the operational serializers themselves.
 */
function redactProductForRole(product, role) {
    if (role === "admin" || !product || typeof product !== "object") return product;
    const result = { ...product };
    delete result.price;
    delete result.basePriceCents;
    return result;
}

function redactSaleForRole(sale, role) {
    if (role === "admin" || !sale || typeof sale !== "object") return sale;
    const result = { ...sale };
    delete result.total;
    delete result.totalCents;
    result.items = Array.isArray(sale.items)
        ? sale.items.map((item) => {
              const clean = { ...item };
              delete clean.unitPrice;
              delete clean.lineTotal;
              delete clean.unitPriceCents;
              delete clean.lineTotalCents;
              delete clean.priceSource;
              return clean;
          })
        : [];
    return result;
}

module.exports = { redactProductForRole, redactSaleForRole };
