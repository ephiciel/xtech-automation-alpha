"use strict";
// Real Express router over 127.0.0.1 only. No valid credentials, DB, mail, AI or network providers.
// Uses CLOUDFLARE_WORKER=true to skip local static serving without calling startServer().
process.env.CLOUDFLARE_WORKER = "true";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
let server;
let base;
const request = async (method, pathname, body) => {
  const headers = body === undefined ? {} : { "content-type": "application/json" };
  const response = await fetch(`${base}${pathname}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
};
test.before(async () => {
  const { app } = require("../backend/server.js");
  // No Firebase initialization: never invoke exported startServer().
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("public status endpoint is registered in real Express app", async () => {
  const r = await request("GET", "/api/status");
  assert.equal(r.status, 200);
  assert.match(r.body, /success/);
});
test("public configuration endpoint is registered", async () => {
  const r = await request("GET", "/api/config");
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body, /private_key|serviceAccountKey|GOOGLE_SERVICE_ACCOUNT_JSON/);
});
test("health endpoint responds independently of Firebase", async () => {
  const r = await request("GET", "/health");
  assert.equal(r.status, 200);
  assert.match(r.body, /ok/);
});
test("registration validation runs without creating a Firebase user", async () => {
  const r = await request("POST", "/api/auth/register-customer", { name: "!", email: "not-an-email" });
  assert.equal(r.status, 400);
});
test("OTP request rejects invalid addresses before touching Firebase", async () => {
  const r = await request("POST", "/api/auth/email-otp/request", { email: "bad" });
  assert.equal(r.status, 400);
});
test("OTP verification rejects malformed codes before touching Firestore", async () => {
  const r = await request("POST", "/api/auth/email-otp/verify", { email: "test@example.com", code: "1" });
  assert.equal(r.status, 400);
});
test("extracted protected routes all deny unauthenticated HTTP requests", async () => {
  const protectedRoutes = [
    ["GET", "/api/auth/me"], ["GET", "/api/notifications"],
    ["PATCH", "/api/notifications/read-all"], ["PATCH", "/api/notifications/id/read"],
    ["GET", "/api/products"], ["GET", "/api/products/archived"],
    ["GET", "/api/products/P-1"], ["POST", "/api/products"],
    ["GET", "/api/inventory/transactions"], ["POST", "/api/inventory/stock-in"],
    ["POST", "/api/inventory/stock-out"],
    ["GET", "/api/customers"], ["POST", "/api/customers"],
    ["GET", "/api/pickups"], ["POST", "/api/pickups"],
    ["PATCH", "/api/pickups/test/status"],
    ["GET", "/api/sales"], ["POST", "/api/sales"],
    ["GET", "/api/reports/summary"], ["GET", "/api/reports/csv/inventory"],
    ["GET", "/api/dashboard"],
    ["GET", "/api/users"], ["POST", "/api/users"],
    ["PATCH", "/api/users/a/status"],
    ["GET", "/api/profile"], ["PUT", "/api/profile"],
    ["GET", "/api/chat/history"], ["DELETE", "/api/chat/history"],
    ["POST", "/api/chat"]
  ];
  for (const [method, url] of protectedRoutes) {
    const response = await request(method, url, ["POST", "PUT", "PATCH"].includes(method) ? {} : undefined);
    assert.equal(response.status, 401, `Expected 401 from ${method} ${url}; got ${response.status} ${response.body.slice(0, 140)}`);
  }
});
