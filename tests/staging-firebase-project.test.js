"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertFirebaseProject } = require("../backend/utils/firebase-project");

const prod = { XTECH_ENV: "production" };
const stage = { XTECH_ENV: "staging", XTECH_STAGING_FIREBASE_PROJECT_ID: "xtech-test-stage-123" };

test("default mode accepts only production Firebase", () => {
  assert.equal(assertFirebaseProject("xtech-automation", {}), "xtech-automation");
  assert.throws(() => assertFirebaseProject("xtech-test-stage-123", {}), /production Firebase project/);
});
test("explicit production mode accepts production project", () => assert.equal(assertFirebaseProject("xtech-automation", prod), "xtech-automation"));
test("explicit production mode rejects staging project", () => assert.throws(() => assertFirebaseProject("xtech-test-stage-123", prod), /production Firebase project/));
test("staging accepts a matching separate project", () => assert.equal(assertFirebaseProject("xtech-test-stage-123", stage), "xtech-test-stage-123"));
test("staging refuses production credentials", () => assert.throws(() => assertFirebaseProject("xtech-automation", stage), /Refusing production/));
test("staging rejects unexpected staging credentials", () => assert.throws(() => assertFirebaseProject("other-stage-id", stage), /Wrong staging Firebase project/));
test("staging rejects missing expected project", () => assert.throws(() => assertFirebaseProject("xtech-test-stage-123", {XTECH_ENV: "staging"}), /missing or unsafe/));
test("staging rejects production configured as expected", () => assert.throws(() => assertFirebaseProject("xtech-automation", {XTECH_ENV: "staging", XTECH_STAGING_FIREBASE_PROJECT_ID: "xtech-automation"}), /missing or unsafe/));
test("staging rejects unedited placeholder", () => assert.throws(() => assertFirebaseProject("xtech-test-stage-123", {XTECH_ENV: "staging", XTECH_STAGING_FIREBASE_PROJECT_ID: "SET_ME_TO_SEPARATE_STAGING_FIREBASE_PROJECT_ID"}), /missing or unsafe/));
test("staging rejects other placeholder prefixes", () => assert.throws(() => assertFirebaseProject("xtech-test-stage-123", {XTECH_ENV: "staging", XTECH_STAGING_FIREBASE_PROJECT_ID: "REPLACE_THIS"}), /missing or unsafe/));
test("unsupported environment name fails closed", () => assert.throws(() => assertFirebaseProject("xtech-automation", {XTECH_ENV: "development"}), /Invalid XTECH_ENV/));
test("missing actual credential project always fails", () => assert.throws(() => assertFirebaseProject("", stage), /missing project_id/));
