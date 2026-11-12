"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthMiddleware } = require("../backend/middleware/auth");

function harness(options = {}) {
    const calls = { verify: [], collection: [], docs: [], log: [], gets: 0, next: 0 };
    const user = options.user || { uid: "uid-101", email: "member@example.com" };
    const getAuth = () => {
        calls.gets++;
        return {
            async verifyIdToken(token, revoked) {
                calls.verify.push({ token, revoked });
                if (options.verifyFailure) throw new Error("expired-token");
                return user;
            }
        };
    };
    const getDb = () => {
        calls.gets++;
        return {
            collection(name) {
                calls.collection.push(name);
                return {
                    doc(uid) {
                        calls.docs.push(uid);
                        return {
                            async get() {
                                if (options.dbFailure) throw new Error("database unavailable");
                                return options.missingProfile
                                    ? { exists: false }
                                    : {
                                          exists: true,
                                          data: () =>
                                              options.profile || { role: "warehouse", active: true }
                                      };
                            }
                        };
                    }
                };
            }
        };
    };
    const normalize = (role) => (role === "owner" ? "admin" : role || "customer");
    const { authRequired, roles } = createAuthMiddleware({
        getAuth,
        getDb,
        normalizedRole: normalize,
        logger: { error: (...args) => calls.log.push(args) }
    });
    const response = {
        code: 200,
        payload: undefined,
        status(code) {
            this.code = code;
            return this;
        },
        json(body) {
            this.payload = body;
            return this;
        }
    };
    const next = () => {
        calls.next++;
    };
    return { authRequired, roles, calls, response, next };
}

test("denies requests without a Bearer authorization header before using Firebase", async () => {
    const h = harness();
    await h.authRequired({ headers: {} }, h.response, h.next);
    assert.equal(h.response.code, 401);
    assert.equal(h.response.payload.message, "Authentication required.");
    assert.equal(h.calls.next, 0);
    assert.equal(h.calls.gets, 0);
});

test("denies an empty Bearer token before using Firebase", async () => {
    const h = harness();
    await h.authRequired({ headers: { authorization: "Bearer   " } }, h.response, h.next);
    assert.equal(h.response.code, 401);
    assert.equal(h.response.payload.message, "Authentication token is missing.");
    assert.equal(h.calls.gets, 0);
});

test("verifies token with revocation checking and fetches the associated user profile", async () => {
    const h = harness();
    const req = { headers: { authorization: "Bearer secret-token" } };
    await h.authRequired(req, h.response, h.next);
    assert.deepEqual(h.calls.verify, [{ token: "secret-token", revoked: true }]);
    assert.deepEqual(h.calls.collection, ["users"]);
    assert.deepEqual(h.calls.docs, ["uid-101"]);
    assert.equal(req.user.uid, "uid-101");
    assert.equal(req.profile.role, "warehouse");
    assert.equal(h.calls.next, 1);
});

test("maps legacy owner role to admin", async () => {
    const h = harness({ profile: { role: "owner", active: true } });
    const req = { headers: { authorization: "Bearer token" } };
    await h.authRequired(req, h.response, h.next);
    assert.equal(req.profile.role, "admin");
    assert.equal(h.calls.next, 1);
});

test("uses customer defaults when a Firestore user profile does not exist", async () => {
    const h = harness({ missingProfile: true });
    const req = { headers: { authorization: "Bearer token" } };
    await h.authRequired(req, h.response, h.next);
    assert.deepEqual(req.profile, { role: "customer", email: "member@example.com", active: true });
    assert.equal(h.calls.next, 1);
});

test("rejects deactivated users with HTTP 403", async () => {
    const h = harness({ profile: { role: "customer", active: false } });
    const req = { headers: { authorization: "Bearer token" } };
    await h.authRequired(req, h.response, h.next);
    assert.equal(h.response.code, 403);
    assert.equal(h.response.payload.message, "This account has been deactivated.");
    assert.equal(h.calls.next, 0);
});

test("returns HTTP 401 when token verification fails", async () => {
    const h = harness({ verifyFailure: true });
    const req = { headers: { authorization: "Bearer token" } };
    await h.authRequired(req, h.response, h.next);
    assert.equal(h.response.code, 401);
    assert.equal(h.response.payload.message, "Invalid or expired authentication token.");
    assert.equal(h.calls.next, 0);
    assert.equal(h.calls.log.length, 1);
});

test("returns HTTP 401 when user profile lookup fails", async () => {
    const h = harness({ dbFailure: true });
    const req = { headers: { authorization: "Bearer token" } };
    await h.authRequired(req, h.response, h.next);
    assert.equal(h.response.code, 401);
    assert.equal(h.calls.next, 0);
    assert.equal(h.calls.log.length, 1);
});

test("role middleware allows matching roles", () => {
    const h = harness();
    h.roles("admin", "warehouse")({ profile: { role: "warehouse" } }, h.response, h.next);
    assert.equal(h.calls.next, 1);
    assert.equal(h.response.code, 200);
});

test("role middleware denies missing and unauthorized roles", () => {
    const h = harness();
    const guard = h.roles("admin");
    guard({ profile: { role: "customer" } }, h.response, h.next);
    assert.equal(h.response.code, 403);
    assert.equal(h.response.payload.message, "You do not have permission for this action.");
    guard({}, h.response, h.next);
    assert.equal(h.response.code, 403);
    assert.equal(h.calls.next, 0);
});
