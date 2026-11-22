"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { redactProductForRole, redactSaleForRole } = require("../backend/utils/pricing-visibility");
const {
    operationalProduct,
    operationalSale,
    serialize
} = require("../backend/utils/serialization");
const { registerInventoryRoutes } = require("../backend/routes/inventory.routes");
const { registerSalesRoutes } = require("../backend/routes/sales.routes");
const { registerCustomerRoutes } = require("../backend/routes/customers.routes");

const PRODUCT = {
    productID: "TEST01",
    productName: "Cleaner",
    active: true,
    quantity: 6,
    price: 200,
    basePriceCents: 25000
};
const SALE = {
    saleID: "S01",
    customerID: "C01",
    createdAt: "2026-11-22T00:00:00.000Z",
    total: 500,
    totalCents: 50000,
    items: [
        {
            productID: "TEST01",
            quantity: 2,
            unitPrice: 250,
            lineTotal: 500,
            unitPriceCents: 25000,
            lineTotalCents: 50000,
            priceSource: "customer"
        }
    ]
};
function response() {
    return {
        code: 200,
        body: undefined,
        status(code) {
            this.code = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}
function router() {
    const routes = new Map();
    const app = {};
    for (const method of ["get", "post", "put", "patch", "delete"]) {
        app[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
    }
    return {
        app,
        handler(method, path) {
            const fn = routes.get(`${method} ${path}`);
            assert.equal(typeof fn, "function", `${method} ${path} should exist`);
            return fn;
        }
    };
}
const guard = () => {};
const deps = { authRequired: guard, roles: () => guard };

test("monetary response helpers preserve Admin amounts and do not mutate data", () => {
    const product = operationalProduct(PRODUCT);
    const sale = operationalSale(SALE);
    assert.equal(redactProductForRole(product, "admin").basePriceCents, 25000);
    assert.equal(redactSaleForRole(sale, "admin").items[0].unitPriceCents, 25000);
    for (const role of ["secretary", "warehouse", "customer", undefined]) {
        const redactedProduct = redactProductForRole(product, role);
        assert.equal(redactedProduct.basePriceCents, undefined);
        assert.equal(redactedProduct.productID, "TEST01");
        const redactedSale = redactSaleForRole(sale, role);
        assert.equal(redactedSale.totalCents, undefined);
        assert.equal(redactedSale.items[0].unitPriceCents, undefined);
        assert.equal(redactedSale.items[0].lineTotalCents, undefined);
        assert.equal(redactedSale.items[0].priceSource, undefined);
        assert.equal(redactedSale.items[0].quantity, 2);
    }
    assert.equal(product.basePriceCents, 25000);
    assert.equal(sale.totalCents, 50000);
    assert.equal(sale.items[0].unitPriceCents, 25000);
});

test("product list, archived list, and detail hide default price outside Admin", async () => {
    const f = router();
    const productDoc = { data: () => ({ ...PRODUCT }) };
    const db = {
        collection(name) {
            assert.equal(name, "products");
            return {
                where: () => ({ get: async () => ({ docs: [productDoc] }) }),
                doc: () => ({ get: async () => ({ exists: true, ...productDoc }) })
            };
        }
    };
    registerInventoryRoutes(f.app, { ...deps, getDb: () => db, operationalProduct });
    for (const role of ["admin", "warehouse", "customer", "secretary"]) {
        const list = response();
        await f.handler("get", "/api/products")({ profile: { role } }, list);
        assert.equal(list.code, 200);
        assert.equal(list.body.products[0].basePriceCents, role === "admin" ? 25000 : undefined);
        const detail = response();
        await f.handler("get", "/api/products/:productID")(
            { profile: { role }, params: { productID: "TEST01" } },
            detail
        );
        assert.equal(detail.body.product.basePriceCents, role === "admin" ? 25000 : undefined);
    }
    for (const role of ["admin", "warehouse"]) {
        const archived = response();
        await f.handler("get", "/api/products/archived")({ profile: { role } }, archived);
        assert.equal(
            archived.body.products[0].basePriceCents,
            role === "admin" ? 25000 : undefined
        );
    }
});

test("GET sales provides centavo amounts only to Admin", async () => {
    const f = router();
    registerSalesRoutes(f.app, {
        ...deps,
        operationalSale,
        getDb: () => ({
            collection: () => ({
                get: async () => ({ docs: [{ id: "S01", data: () => ({ ...SALE }) }] })
            })
        })
    });
    for (const role of ["admin", "secretary"]) {
        const res = response();
        await f.handler("get", "/api/sales")({ profile: { role } }, res);
        assert.equal(res.code, 200);
        assert.equal(res.body.sales[0].totalCents, role === "admin" ? 50000 : undefined);
        assert.equal(
            res.body.sales[0].items[0].unitPriceCents,
            role === "admin" ? 25000 : undefined
        );
    }
});

test("customer sales history hides financial amounts from Secretary", async () => {
    const f = router();
    const db = {
        collection(name) {
            if (name === "customers")
                return {
                    doc: (id) => ({
                        get: async () => ({
                            id,
                            exists: true,
                            data: () => ({ name: "Test Buyer" })
                        })
                    })
                };
            if (name === "pickups" || name === "sales")
                return {
                    where: () => ({
                        get: async () => ({
                            docs: name === "sales" ? [{ id: "S01", data: () => ({ ...SALE }) }] : []
                        })
                    })
                };
            throw Error(`Unexpected collection: ${name}`);
        }
    };
    registerCustomerRoutes(f.app, {
        ...deps,
        getDb: () => db,
        getAuth: () => ({}),
        serialize,
        operationalSale
    });
    for (const role of ["admin", "secretary"]) {
        const res = response();
        await f.handler("get", "/api/customers/:id/history")(
            { profile: { role }, params: { id: "C01" } },
            res
        );
        assert.equal(res.code, 200);
        assert.equal(res.body.sales[0].totalCents, role === "admin" ? 50000 : undefined);
        assert.equal(
            res.body.sales[0].items[0].lineTotalCents,
            role === "admin" ? 50000 : undefined
        );
    }
});

test("Secretary sale creation saves monetary snapshots but redacts response", async () => {
    const f = router();
    const stored = [];
    let seq = 0;
    const db = {
        collection(name) {
            return {
                doc(id) {
                    return {
                        id,
                        name,
                        async get() {
                            assert.equal(name, "products");
                            return { exists: true, data: () => ({ ...PRODUCT }) };
                        }
                    };
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get: (ref) => ref.get(),
                update() {},
                set(ref, data) {
                    stored.push({ collection: ref.name, data });
                }
            });
        }
    };
    registerSalesRoutes(f.app, {
        ...deps,
        getDb: () => db,
        operationalSale,
        normalizeItems: (items) => items,
        isValidOptionalText: () => true,
        newDocumentId: () => `id-${++seq}`,
        now: () => "2026-11-22T00:00:00.000Z",
        num: (value) => Number(value),
        queueCustomerNotification() {}
    });
    const res = response();
    await f.handler("post", "/api/sales")(
        {
            profile: { role: "secretary" },
            body: { items: [{ productID: "TEST01", quantity: 2 }] },
            user: { uid: "staff01", email: "secretary@example.test" }
        },
        res
    );
    assert.equal(res.code, 201);
    assert.equal(res.body.sale.totalCents, undefined);
    assert.equal(res.body.sale.items[0].unitPriceCents, undefined);
    const saved = stored.find((entry) => entry.collection === "sales");
    assert.ok(saved, "sale document should be persisted in transaction");
    assert.equal(saved.data.totalCents, 50000);
    assert.equal(saved.data.items[0].unitPriceCents, 25000);
});
