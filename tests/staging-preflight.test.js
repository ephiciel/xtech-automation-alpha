"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { inspect, parseJsonc, parseArgs } = require("../scripts/staging-preflight");
const goodCfg = () => ({
  name: "xtech-api-staging", main: "worker/index.mjs", workers_dev: true,
  assets: { directory: "frontend", run_worker_first: ["/api", "/api/*"] },
  vars: { CLOUDFLARE_WORKER: "true", PORT: "3000" }
});
const fields = (overrides = {}) => ({
  config: goodCfg(), configName: "wrangler.staging.jsonc", stagingProjectId: "xtech-staging-test",
  firebaseSource: "if (!serviceAccount.project_id) throw new Error('missing');",
  gitignore: ".env\n.dev.vars\nserviceAccountKey.json\n", exists: () => true, ...overrides
});
const has = (result, id, level) => result.some(x => x.id === id && x.level === level);

test("JSONC parser preserves strings containing // and strips line comments", () => {
  assert.deepEqual(parseJsonc('{"url":"https://abc.example/one", // example\n"n": 2,}'), { url: "https://abc.example/one", n: 2 });
});
test("JSONC parser strips block comments and trailing commas", () => {
  assert.equal(parseJsonc('{/* comment */ "n": [1,2,],}').n.length, 2);
});
test("a standalone isolated staging config does not select the production Worker or route", () => {
  const results = inspect(fields());
  assert.equal(has(results, "PROD_WORKER", "BLOCK"), false);
  assert.equal(has(results, "PRODUCTION_ROUTE", "BLOCK"), false);
});
test("production worker name is blocked", () => {
  const cfg = goodCfg(); cfg.name = "xtech-api";
  assert.ok(has(inspect(fields({config:cfg})), "PROD_WORKER", "BLOCK"));
});
test("production custom domain route is blocked", () => {
  const cfg = goodCfg(); cfg.routes = [{ pattern: "xtech-automation.com/*", zone_name: "xtech-automation.com" }];
  assert.ok(has(inspect(fields({config:cfg})), "PRODUCTION_ROUTE", "BLOCK"));
});
test("default production configuration filename is blocked", () => {
  assert.ok(has(inspect(fields({configName:"wrangler.jsonc"})), "DEFAULT_CONFIG", "BLOCK"));
});
test("an absent staging endpoint is blocked", () => {
  const cfg = goodCfg(); delete cfg.workers_dev;
  assert.ok(has(inspect(fields({config:cfg})), "STAGING_ENDPOINT", "BLOCK"));
});
test("staging workers.dev endpoint is accepted", () => {
  assert.ok(has(inspect(fields()), "WORKERS_DEV", "OK"));
});
test("missing worker entrypoint or frontend directory is blocked", () => {
  const found = inspect(fields({exists: () => false}));
  assert.ok(has(found, "ENTRYPOINT", "BLOCK"));
  assert.ok(has(found, "ASSETS", "BLOCK"));
});
test("missing API worker-first route is blocked", () => {
  const cfg = goodCfg(); cfg.assets.run_worker_first = ["/api"];
  assert.ok(has(inspect(fields({config:cfg})), "API_ROUTE_PRIORITY", "BLOCK"));
});
test("plaintext API secrets in Wrangler vars are blocked without exposing values", () => {
  const cfg = goodCfg(); cfg.vars.RESEND_API_KEY = "dummy-test-secret";
  const results = inspect(fields({config:cfg}));
  const line = results.find(f => f.id === "PLAINTEXT_SECRETS");
  assert.equal(line.level, "BLOCK");
  assert.equal(line.message.includes("dummy-test-secret"), false);
});
test("using the production Firebase project for staging is blocked", () => {
  assert.ok(has(inspect(fields({stagingProjectId:"xtech-automation"})), "FIREBASE_PROJECT", "BLOCK"));
});
test("staging Firebase ID must be supplied explicitly", () => {
  assert.ok(has(inspect(fields({stagingProjectId:""})), "FIREBASE_PROJECT", "BLOCK"));
});
test("hard-coded production-only Firebase checks block isolated staging", () => {
  const source = 'if (serviceAccount.project_id !== "xtech-automation") throw Error("wrong project");';
  assert.ok(has(inspect(fields({firebaseSource:source})), "FIREBASE_HARDCODED", "BLOCK"));
});
test("missing ignore rules for local secrets are blocked", () => {
  assert.ok(has(inspect(fields({gitignore:".env\n"})), "SECRET_IGNORES", "BLOCK"));
});
test("named environment must be explicit", () => {
  assert.ok(has(inspect(fields({envName:"staging"})), "MISSING_ENV", "BLOCK"));
});
test("named staging environment uses distinct worker and workers.dev", () => {
  const cfg = { ...goodCfg(), name:"xtech-api", routes:[{pattern:"xtech-automation.com/*"}], env:{staging:{workers_dev:true,vars:{CLOUDFLARE_WORKER:"true"}}} };
  const results = inspect(fields({config:cfg,configName:"wrangler.jsonc",envName:"staging"}));
  assert.equal(has(results,"PRODUCTION_ROUTE","BLOCK"),false);
  assert.equal(has(results,"PROD_WORKER","BLOCK"),false);
});
test("CLI rejects incomplete flags", () => {
  assert.throws(() => parseArgs(["--config"]), /requires a value/);
});
