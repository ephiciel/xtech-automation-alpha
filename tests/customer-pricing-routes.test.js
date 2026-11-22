"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerCustomerPricingRoutes } = require("../backend/routes/customer-pricing.routes");

function fixture(options = {}) {
    const state = {
        customers: new Map([
            ["c1", { name: "Customer", active: options.customerActive !== false }]
        ]),
        products: new Map([
            ["P100", { productName: "Cleaner", active: options.productActive !== false }]
        ]),
        prices: new Map(),
        audits: new Map()
    };

    let reads = 0;
    let generated = 0;

    const ref = (kind, id) => ({
        id,
        async get() {
            const data = state[kind].get(id);
            return {
                exists: data !== undefined,
                data: () => ({ ...data })
            };
        },
        async set(data) {
            state[kind].set(id, { ...data });
        },
        collection(name) {
            assert.equal(kind, "customers");
            assert.equal(name, "prices");

            return {
                doc: (productID) => ref("prices", `${id}:${productID}`),
                async get() {
                    return {
                        docs: [...state.prices.entries()]
                            .filter(([key]) => key.startsWith(`${id}:`))
                            .map(([key, value]) => ({
                                id: key.slice(id.length + 1),
                                data: () => ({ ...value })
                            }))
                    };
                }
            };
        }
    });

    const db = {
        collection(name) {
            reads++;

            const mapping = {
                customers: "customers",
                products: "products",
                pricingAudit: "audits"
            };

            assert.ok(mapping[name]);

            return {
                doc: (id) => ref(mapping[name], id)
            };
        },
        async runTransaction(fn) {
            const writes = [];

            const tx = {
                get: (reference) => reference.get(),
                set: (reference, data) => writes.push([reference, data])
            };

            const result = await fn(tx);

            for (const [reference, data] of writes) {
                await reference.set(data);
            }

            return result;
        }
    };

    const routes = [];

    const app = {
        get: (url, ...handlers) => routes.push({ method: "GET", url, handlers }),
        put: (url, ...handlers) => routes.push({ method: "PUT", url, handlers }),
        patch: (url, ...handlers) => routes.push({ method: "PATCH", url, handlers }),
        delete: (url, ...handlers) => routes.push({ method: "DELETE", url, handlers })
    };

    const authRequired = (req, res, next) =>
        req.authenticated ? next() : res.status(401).json({ success: false });

    const roles =
        (...allowed) =>
        (req, res, next) =>
            allowed.includes(req.profile.role) ? next() : res.status(403).json({ success: false });

    registerCustomerPricingRoutes(app, {
        authRequired,
        roles,
        getDb: () => db,
        now: () => "timestamp",
        newDocumentId: () => `audit-${++generated}`
    });

    async function request(method, url, body = {}, options = {}) {
        const route = routes.find((entry) => entry.method === method && entry.url === url);

        assert.ok(route, `${method} ${url} registered`);

        const req = {
            authenticated: options.authenticated !== false,
            profile: { role: options.role || "admin" },
            user: { uid: "admin-uid" },
            body,
            params: {
                id: options.customer || "c1",
                productID: options.product || "P100"
            }
        };

        const res = {
            code: 200,
            body: null,
            status(code) {
                this.code = code;
                return this;
            },
            json(value) {
                this.body = value;
                return this;
            }
        };

        for (const handler of route.handlers) {
            let next = false;

            await handler(req, res, () => {
                next = true;
            });

            if (!next) break;
        }

        return res;
    }

    return {
        request,
        state,
        routes,
        get reads() {
            return reads;
        }
    };
}

const pricePath = "/api/customers/:id/prices/:productID";
const listPath = "/api/customers/:id/prices";

test("registers three original customer pricing routes alongside two catalog routes without Firestore access", () => {
    const f = fixture();
    assert.equal(f.routes.length, 5);
    assert.equal(f.routes.filter((route) => route.url.startsWith("/api/customers/")).length, 3);
    assert.equal(f.reads, 0);
});

test("only authenticated Admin can access pricing routes", async () => {
    const f = fixture();

    for (const route of f.routes.filter((entry) => entry.url.startsWith("/api/customers/"))) {
        for (const role of ["customer", "secretary", "warehouse"]) {
            const res = await f.request(route.method, route.url, { price: "220" }, { role });

            assert.equal(res.code, 403);
        }

        const unauthenticated = await f.request(
            route.method,
            route.url,
            { price: "220" },
            { authenticated: false }
        );

        assert.equal(unauthenticated.code, 401);
    }

    assert.equal(f.reads, 0);
});

test("Admin saves negotiated price with an audit", async () => {
    const f = fixture();
    const res = await f.request("PUT", pricePath, { price: "220.50" });

    assert.equal(res.code, 200);
    assert.equal(res.body.priceCents, 22050);
    assert.equal(f.state.prices.get("c1:P100").active, true);
    assert.equal(f.state.audits.size, 1);

    const audit = [...f.state.audits.values()][0];
    assert.equal(audit.type, "CUSTOMER_PRICE_SET");

    const list = await f.request("GET", listPath);
    assert.equal(list.body.prices[0].priceCents, 22050);
});

test("repeating the price creates no duplicate audit", async () => {
    const f = fixture();

    await f.request("PUT", pricePath, { price: "220" });
    const repeated = await f.request("PUT", pricePath, { price: "220" });

    assert.equal(repeated.body.changed, false);
    assert.equal(f.state.audits.size, 1);
});

test("clearing a customer price returns to default", async () => {
    const f = fixture();

    await f.request("PUT", pricePath, { price: "220" });
    const cleared = await f.request("DELETE", pricePath);

    assert.equal(cleared.code, 200);
    assert.equal(cleared.body.changed, true);
    assert.equal(f.state.audits.size, 2);
    assert.equal(f.state.prices.get("c1:P100").active, false);

    const list = await f.request("GET", listPath);
    assert.deepEqual(list.body.prices, []);
});

test("invalid prices cannot be saved", async () => {
    for (const price of ["-1", "19.999", "1e5", ""]) {
        const f = fixture();
        const res = await f.request("PUT", pricePath, { price });

        assert.equal(res.code, 400);
        assert.equal(f.state.prices.size, 0);
    }
});

test("inactive customers and products cannot receive prices", async () => {
    const inactiveCustomer = fixture({ customerActive: false });
    const customerResult = await inactiveCustomer.request("PUT", pricePath, { price: "100" });

    assert.equal(customerResult.code, 404);

    const archivedProduct = fixture({ productActive: false });
    const productResult = await archivedProduct.request("PUT", pricePath, { price: "100" });

    assert.equal(productResult.code, 404);
});
