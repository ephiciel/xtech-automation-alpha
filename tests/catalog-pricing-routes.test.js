"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerCustomerPricingRoutes } = require("../backend/routes/customer-pricing.routes");

function fixture(
    role = "secretary",
    previous = 18000,
    active = true,
    negotiated = null,
    owner = "staff-1",
    priceActive = true
) {
    const routes = [];
    const authRequired = (_req, _res, next) => next();
    const roles = (...allowed) => {
        const guard = (req, res, next) =>
            allowed.includes(req.profile?.role) ? next() : res.status(403).json({ success: false });
        guard.allowed = allowed;
        return guard;
    };
    const app = Object.fromEntries(
        ["get", "put", "delete", "patch"].map((method) => [
            method,
            (p, ...handlers) => routes.push({ method, p, handlers })
        ])
    );
    let product = {
        productID: "AF-001",
        productName: "Air Freshener",
        category: "Cleaning Supply",
        active,
        quantity: 4,
        basePriceCents: previous,
        priceCents: 88888
    };
    const audits = [];
    const products = {
        where(field, op, value) {
            assert.deepEqual([field, op, value], ["active", "==", true]);
            return this;
        },
        get: async () => ({ docs: [{ id: "AF-001", data: () => product }] }),
        doc: () => ({ id: "AF-001" })
    };
    const db = {
        collection(name) {
            if (name === "products") return products;
            if (name === "customers") {
                const linked = {
                    id: "C-01",
                    exists: true,
                    data: () => ({ userUID: owner, active: true })
                };
                return {
                    doc: () => ({
                        get: async () => linked,
                        collection: () => ({
                            get: async () => ({
                                docs:
                                    negotiated === null
                                        ? []
                                        : [
                                              {
                                                  id: "AF-001",
                                                  data: () => ({
                                                      active: priceActive,
                                                      priceCents: negotiated
                                                  })
                                              }
                                          ]
                            })
                        })
                    }),
                    where: () => ({
                        limit: () => ({
                            get: async () => ({ docs: owner === "staff-1" ? [linked] : [] })
                        })
                    })
                };
            }
            if (name === "pricingAudit") return { doc: () => ({ id: "audit-1" }) };
            throw Error("Unexpected db: " + name);
        },
        async runTransaction(fn) {
            const tx = {
                get: async () => ({ exists: true, data: () => product }),
                update: (_ref, patch) => {
                    product = { ...product, ...patch };
                },
                set: (_ref, doc) => audits.push(doc)
            };
            return fn(tx);
        }
    };
    registerCustomerPricingRoutes(app, {
        authRequired,
        roles,
        getDb: () => db,
        now: () => "2026-11-22T00:00:00Z",
        newDocumentId: () => "audit-1"
    });
    const response = () => ({
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        }
    });
    const request = (body = {}) => ({
        body,
        params: { productID: "AF-001" },
        profile: { role, customerID: "C-01" },
        user: { uid: "staff-1" }
    });
    async function invoke(method, p, body) {
        const route = routes.find((r) => r.method === method && r.p === p);
        assert.ok(route, `${method} ${p}`);
        const res = response();
        let i = 0;
        const next = async () => {
            const handler = route.handlers[i++];
            if (handler) await handler(request(body), res, next);
        };
        await next();
        return res;
    }
    return { routes, invoke, audits, getProduct: () => product };
}
test("catalog list is whitelisted and includes one standard price", async () => {
    const f = fixture("customer");
    const r = await f.invoke("get", "/api/catalog/products");
    assert.equal(r.body.products[0].sellingPriceCents, 18000);
    assert.equal(r.body.products[0].basePriceCents, undefined);
    assert.equal(r.body.products[0].priceCents, undefined);
    assert.equal(r.body.products[0].priceAudit, undefined);
});
test("catalog returns only the customer's own effective negotiated price", async () => {
    for (const [role, owner, active, expected] of [
        ["customer", "staff-1", true, 12500],
        ["customer", "someone-else", true, 18000],
        ["customer", "staff-1", false, 18000],
        ["secretary", "staff-1", true, 18000]
    ]) {
        const r = await fixture(role, 18000, true, 12500, owner, active).invoke(
            "get",
            "/api/catalog/products"
        );
        assert.equal(r.body.products[0].sellingPriceCents, expected);
        assert.equal(r.body.products[0].basePriceCents, undefined);
        assert.equal(r.body.products[0].priceSource, undefined);
    }
});
test("catalog list blocks warehouse", async () => {
    const r = await fixture("warehouse").invoke("get", "/api/catalog/products");
    assert.equal(r.statusCode, 403);
});
test("Secretary can set the standard price with an audit", async () => {
    const f = fixture("secretary");
    const r = await f.invoke("patch", "/api/products/:productID/standard-price", {
        price: "195.50",
        expectedPriceCents: 18000
    });
    assert.equal(r.body.sellingPriceCents, 19550);
    assert.equal(f.getProduct().basePriceCents, 19550);
    assert.equal(f.audits.length, 1);
    assert.equal(f.audits[0].performedByRole, "secretary");
});
test("Admin can set the standard price", async () => {
    const f = fixture("admin");
    const r = await f.invoke("patch", "/api/products/:productID/standard-price", {
        price: "180",
        expectedPriceCents: 18000
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.changed, false);
    assert.equal(f.audits.length, 0);
});
test("Warehouse and Customer cannot edit prices", async () => {
    for (const role of ["warehouse", "customer"]) {
        const r = await fixture(role).invoke("patch", "/api/products/:productID/standard-price", {
            price: "250",
            expectedPriceCents: 18000
        });
        assert.equal(r.statusCode, 403);
    }
});
test("stale expected price returns 409 without mutation", async () => {
    const f = fixture();
    const r = await f.invoke("patch", "/api/products/:productID/standard-price", {
        price: "230",
        expectedPriceCents: 19000
    });
    assert.equal(r.statusCode, 409);
    assert.equal(f.getProduct().basePriceCents, 18000);
    assert.equal(f.audits.length, 0);
});
test("invalid price is rejected", async () => {
    const f = fixture();
    const r = await f.invoke("patch", "/api/products/:productID/standard-price", {
        price: "-1",
        expectedPriceCents: 18000
    });
    assert.equal(r.statusCode, 400);
    assert.equal(f.audits.length, 0);
});
test("archived product cannot be repriced", async () => {
    const f = fixture("secretary", 18000, false);
    const r = await f.invoke("patch", "/api/products/:productID/standard-price", {
        price: "200",
        expectedPriceCents: 18000
    });
    assert.equal(r.statusCode, 400);
    assert.equal(f.audits.length, 0);
});
test("missing price remains unavailable, not zero", async () => {
    const f = fixture("customer", null);
    const r = await f.invoke("get", "/api/catalog/products");
    assert.equal(r.body.products[0].sellingPriceCents, null);
});
