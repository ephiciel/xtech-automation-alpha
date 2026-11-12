"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inspect, parseArgs } = require("../scripts/staging-isolation-check");
const { parseJsonc } = require("../scripts/staging-preflight");
const root = path.resolve(__dirname, "..");
const project = "xtech-test-stage-123";
const valid = () => ({
    name: "xtech-api-staging",
    main: "worker/production.mjs",
    workers_dev: true,
    routes: [],
    compatibility_date: "2026-10-30",
    vars: {
        CLOUDFLARE_WORKER: "true",
        PORT: "3000",
        XTECH_ENV: "staging",
        XTECH_STAGING_FIREBASE_PROJECT_ID: project
    },
    assets: {
        directory: "./frontend",
        binding: "ASSETS",
        run_worker_first: ["/api", "/api/*", "/__xtech_direct/*"]
    }
});
const issues = (config, id = project) => inspect(config, id);
const has = (rows, key) => rows.some((x) => x.key === key);

test("proper isolated staging config passes guard", () => assert.deepEqual(issues(valid()), []));
test("production Worker name is rejected", () => {
    const v = valid();
    v.name = "xtech-api";
    assert.ok(has(issues(v), "WORKER_NAME"));
});
test("Worker names must clearly indicate staging", () => {
    const v = valid();
    v.name = "xtech-api-secondary";
    assert.ok(has(issues(v), "WORKER_NAME"));
});
test("production custom routes cannot be present", () => {
    const v = valid();
    v.routes = [{ pattern: "xtech-automation.com/*" }];
    assert.ok(has(issues(v), "NO_CUSTOM_ROUTES"));
});
test("even staging custom routes require separate manual review", () => {
    const v = valid();
    v.routes = [{ pattern: "staging.example.com/*" }];
    assert.ok(has(issues(v), "NO_CUSTOM_ROUTES"));
});
test("workers.dev must be explicit", () => {
    const v = valid();
    delete v.workers_dev;
    assert.ok(has(issues(v), "WORKERS_DEV"));
});
test("unexpected Worker entrypoint is rejected", () => {
    const v = valid();
    v.main = "worker/index.mjs";
    assert.ok(has(issues(v), "ENTRYPOINT"));
});
test("old compatibility date is blocked", () => {
    const v = valid();
    v.compatibility_date = "2024-01-01";
    assert.ok(has(issues(v), "COMPATIBILITY"));
});
test("API worker-first routing required", () => {
    const v = valid();
    v.assets.run_worker_first = [];
    assert.ok(has(issues(v), "ASSETS"));
});
test("staging mode must be set explicitly", () => {
    const v = valid();
    v.vars.XTECH_ENV = "production";
    assert.ok(has(issues(v), "STAGING_MODE"));
});
test("production Firebase project argument is denied", () =>
    assert.ok(has(issues(valid(), "xtech-automation"), "PROJECT_ARGUMENT")));
test("missing Firebase project argument is denied", () =>
    assert.ok(has(issues(valid(), ""), "PROJECT_ARGUMENT")));
test("mismatched expected Firebase project is denied", () => {
    const v = valid();
    v.vars.XTECH_STAGING_FIREBASE_PROJECT_ID = "other-project";
    assert.ok(has(issues(v), "FIREBASE_MATCH"));
});
test("unmodified staging placeholder is denied", () => {
    const v = valid();
    v.vars.XTECH_STAGING_FIREBASE_PROJECT_ID = "SET_ME_TO_SEPARATE_STAGING_FIREBASE_PROJECT_ID";
    assert.ok(has(issues(v), "FIREBASE_MATCH"));
});
test("API credentials must not appear in Wrangler vars", () => {
    const v = valid();
    v.vars.GEMINI_API_KEY = "example-do-not-use";
    assert.ok(has(issues(v), "PLAINTEXT_SECRETS"));
});
test("production name collision detected", () =>
    assert.ok(
        has(
            inspect(valid(), project, { productionConfig: { name: "xtech-api-staging" } }),
            "PROD_NAME_COLLISION"
        )
    ));
test("Firebase runtime guard must remain installed", () =>
    assert.ok(
        has(
            inspect(valid(), project, { firebaseSource: "module.exports = {}" }),
            "FIREBASE_RUNTIME_GUARD"
        )
    ));
test("--project requires its value", () =>
    assert.throws(() => parseArgs(["--project"]), /requires a value/));
test("the shipped staging config is distinct and has no routes", () => {
    const cfg = parseJsonc(fs.readFileSync(path.join(root, "wrangler.staging.jsonc"), "utf8"));

    assert.equal(cfg.name, "xtech-api-staging");
    assert.equal(cfg.workers_dev, true);
    assert.deepEqual(cfg.routes, []);
    assert.equal(cfg.vars.XTECH_ENV, "staging");
    assert.equal(cfg.vars.FIREBASE_PROJECT_ID, "xtech-automation-staging");
    assert.equal(cfg.vars.XTECH_STAGING_FIREBASE_PROJECT_ID, "xtech-automation-staging");
    assert.equal(cfg.main, "worker/production.mjs");

    assert.ok(cfg.assets.run_worker_first.includes("/__xtech_direct/*"));
});
test("the original production Wrangler config remains separately addressable", () => {
    const cfg = parseJsonc(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
    assert.ok(cfg.routes?.some((x) => String(x.pattern).includes("xtech-automation.com")));
    assert.equal(cfg.name, "xtech-api");
});
test("staging preflight recognizes the stage entrypoint and assets", () => {
    const cfg = parseJsonc(fs.readFileSync(path.join(root, "wrangler.staging.jsonc"), "utf8"));
    assert.ok(fs.existsSync(path.join(root, cfg.main)));
    assert.ok(fs.existsSync(path.join(root, cfg.assets.directory)));
});
