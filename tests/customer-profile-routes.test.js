"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { registerCustomerProfileRoutes } = require("../backend/routes/customer-profile.routes");

function createFixture(options = {}) {
    const routes = [];
    const events = [];
    let firebaseAccess = 0;
    const customers = new Map(Object.entries(options.customers || {}));
    const users = new Map(Object.entries(options.users || {}));
    const timestamp = "2026-11-06T01:00:00.000Z";
    const mockDb = {
        collection(name) {
            if (options.dbOffline) throw new Error("Simulated Firestore offline");
            if (name === "customers") return {
                doc(id) {
                    return {
                        id,
                        async get() { return { exists: customers.has(id), id, data: () => ({ ...customers.get(id) }) }; },
                        async update(changes) {
                            events.push(["customers.update", id, changes]);
                            if (options.failCustomerUpdate) throw new Error("Customer update failed");
                            customers.set(id, { ...customers.get(id), ...changes });
                        }
                    };
                },
                where(field, op, value) {
                    assert.equal(field, "userUID");
                    assert.equal(op, "==");
                    return {
                        limit(number) {
                            assert.equal(number, 1);
                            return {
                                async get() {
                                    const found = [...customers.entries()].find(([, data]) => data.userUID === value);
                                    if (!found) return { empty: true, docs: [] };
                                    const [id, data] = found;
                                    return { empty: false, docs: [{ id, ref: mockDb.collection("customers").doc(id), data: () => ({ ...data }) }] };
                                }
                            };
                        }
                    };
                }
            };
            if (name === "users") return {
                doc(uid) {
                    return {
                        async set(changes, settings) {
                            events.push(["users.set", uid, changes, settings]);
                            if (options.failUserSet) throw new Error("User profile write failed");
                            users.set(uid, { ...users.get(uid), ...changes });
                        }
                    };
                }
            };
            throw new Error(`Unexpected collection ${name}`);
        }
    };
    const mockAuth = {
        async updateUser(uid, changes) {
            events.push(["auth.updateUser", uid, changes]);
            if (options.failAuthUpdate) throw new Error("Auth display-name update failed");
        }
    };
    const authRequired = (req, res, next) => {
        if (!req.authenticated) return res.status(401).json({ success: false, message: "Authentication required." });
        next();
    };
    const roles = (...allowed) => (req, res, next) => {
        if (!allowed.includes(req.profile?.role)) return res.status(403).json({ success: false, message: "Forbidden." });
        next();
    };
    const app = {
        get(url, ...handlers) { routes.push({ method: "get", url, handlers }); },
        put(url, ...handlers) { routes.push({ method: "put", url, handlers }); }
    };
    registerCustomerProfileRoutes(app, {
        authRequired, roles,
        getDb: () => { firebaseAccess++; return mockDb; },
        getAuth: () => { firebaseAccess++; return mockAuth; },
        now: () => timestamp,
        serialize: data => JSON.parse(JSON.stringify(data)),
        normalizePhilippineMobile: value => {
            const input = String(value || "").trim();
            if (input === "") return "";
            if (/^09\d{9}$/.test(input)) return input;
            if (/^\+639\d{9}$/.test(input)) return "0" + input.slice(3);
            return null;
        },
        isValidName: value => /^[A-Za-z][A-Za-z .'-]{1,79}$/.test(value),
        isValidOptionalText: (value, max) => value.length <= max && !/[\u0000-\u001f]/.test(value)
    });
    async function request(method, body = {}, opts = {}) {
        const route = routes.find(route => route.method === method && route.url === "/api/profile");
        assert.ok(route, `Missing ${method} /api/profile`);
        const req = {
            authenticated: opts.authenticated !== false,
            profile: { role: opts.role || "customer", ...(opts.customerID ? { customerID: opts.customerID } : {}) },
            user: { uid: opts.uid || "uid-1" },
            body
        };
        const res = {
            statusCode: 200, body: undefined,
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; }
        };
        for (const handler of route.handlers) {
            let continued = false;
            await handler(req, res, () => { continued = true; });
            if (!continued) break;
        }
        return res;
    }
    return { routes, request, customers, users, events, get firebaseAccess() { return firebaseAccess; }, timestamp };
}
const sampleCustomer = { customerID: "c1", userUID: "uid-1", name: "Original Name", email: "unchanged@example.com", phone: "09171234567", company: "AGB", address: "Davao", active: true };
const goodEdit = { name: "Updated Name", phone: "09179998888", company: "New Company", address: "New Address" };

// Suppress expected console.error from fault-injection tests, while still checking HTTP responses.
async function silentExpectedError(callback) {
    const prior = console.error;
    console.error = () => {};
    try { return await callback(); } finally { console.error = prior; }
}

test("registers exactly the existing GET and PUT /api/profile routes", () => {
    const fixture = createFixture();
    assert.deepEqual(fixture.routes.map(route => `${route.method} ${route.url}`), ["get /api/profile", "put /api/profile"]);
});
test("registration does not call Firebase or Firestore", () => {
    const fixture = createFixture({ dbOffline: true });
    assert.equal(fixture.firebaseAccess, 0);
});
test("GET requires authentication before reaching the database", async () => {
    const fixture = createFixture();
    const result = await fixture.request("get", {}, { authenticated: false });
    assert.equal(result.statusCode, 401);
    assert.equal(fixture.firebaseAccess, 0);
});
test("PUT requires authentication before reaching the database", async () => {
    const fixture = createFixture();
    const result = await fixture.request("put", goodEdit, { authenticated: false });
    assert.equal(result.statusCode, 401);
    assert.equal(fixture.firebaseAccess, 0);
});
test("GET and PUT deny admin, secretary and warehouse roles", async () => {
    const fixture = createFixture();
    for (const role of ["admin", "secretary", "warehouse"]) {
        for (const method of ["get", "put"]) {
            const result = await fixture.request(method, goodEdit, { role });
            assert.equal(result.statusCode, 403);
        }
    }
    assert.equal(fixture.firebaseAccess, 0);
});
test("GET returns customer profile by user profile's customerID", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer } });
    const result = await fixture.request("get", {}, { customerID: "c1" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.customer.id, "c1");
    assert.equal(result.body.customer.name, "Original Name");
});
test("GET finds a customer using the signed-in user UID when no customerID exists", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer } });
    const result = await fixture.request("get");
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.customer.customerID, "c1");
});
test("GET falls back to userUID if customerID is stale", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer } });
    const result = await fixture.request("get", {}, { customerID: "old-id" });
    assert.equal(result.body.customer.id, "c1");
});
test("GET returns 404 when no customer record is linked", async () => {
    const fixture = createFixture();
    const result = await fixture.request("get");
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.message, "Customer profile not found.");
});
test("GET returns HTTP 500 when Firestore access fails", async () => {
    const fixture = createFixture({ dbOffline: true });
    const result = await silentExpectedError(() => fixture.request("get", {}, { customerID: "c1" }));
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.message, "Failed to load customer profile.");
});
test("PUT rejects invalid names before writing to Firestore", async () => {
    const fixture = createFixture();
    const result = await fixture.request("put", { ...goodEdit, name: "5" });
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.firebaseAccess, 0);
});
test("PUT rejects invalid Philippine mobile numbers before writing", async () => {
    const fixture = createFixture();
    const result = await fixture.request("put", { ...goodEdit, phone: "1234" });
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.firebaseAccess, 0);
});
test("PUT rejects company text longer than 120 characters", async () => {
    const fixture = createFixture();
    const result = await fixture.request("put", { ...goodEdit, company: "x".repeat(121) });
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.firebaseAccess, 0);
});
test("PUT rejects addresses longer than 250 characters", async () => {
    const fixture = createFixture();
    const result = await fixture.request("put", { ...goodEdit, address: "x".repeat(251) });
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.firebaseAccess, 0);
});
test("PUT returns HTTP 404 when no customer profile exists", async () => {
    const fixture = createFixture();
    const result = await fixture.request("put", goodEdit);
    assert.equal(result.statusCode, 404);
    assert.equal(fixture.events.length, 0);
});
test("PUT resolves stale customerID by matching the logged-in UID", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer } });
    const result = await fixture.request("put", goodEdit, { customerID: "stale-id" });
    assert.equal(result.statusCode, 200);
    assert.equal(fixture.customers.get("c1").name, "Updated Name");
});
test("PUT synchronizes customer document, user profile and Firebase Auth displayName", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer }, users: { "uid-1": { role: "customer" } } });
    const result = await fixture.request("put", goodEdit, { customerID: "c1" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.message, "Profile updated successfully.");
    assert.deepEqual(fixture.events.map(item => item[0]), ["customers.update", "users.set", "auth.updateUser"]);
    assert.equal(fixture.customers.get("c1").updatedAt, fixture.timestamp);
    assert.equal(fixture.users.get("uid-1").name, "Updated Name");
    assert.deepEqual(fixture.events[2], ["auth.updateUser", "uid-1", { displayName: "Updated Name" }]);
});
test("PUT ignores attempted email or customerID changes in request body", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer } });
    const result = await fixture.request("put", { ...goodEdit, email: "hijack@example.org", customerID: "other-customer" }, { customerID: "c1" });
    assert.equal(result.statusCode, 200);
    assert.equal(fixture.customers.get("c1").email, sampleCustomer.email);
    assert.equal(fixture.customers.get("c1").customerID, "c1");
});
test("PUT returns HTTP 500 when Firestore update fails", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer }, failCustomerUpdate: true });
    const result = await silentExpectedError(() => fixture.request("put", goodEdit, { customerID: "c1" }));
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.message, "Failed to update profile.");
});
test("PUT returns HTTP 500 when Firebase Auth synchronization fails", async () => {
    const fixture = createFixture({ customers: { c1: sampleCustomer }, failAuthUpdate: true });
    const result = await silentExpectedError(() => fixture.request("put", goodEdit, { customerID: "c1" }));
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.message, "Failed to update profile.");
});
