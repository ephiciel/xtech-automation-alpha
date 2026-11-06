"use strict";
/** Explicitly separate production Firebase credentials from staging credentials.
 * This function performs NO network calls and never reads secret values.
 */
const PROD_FIREBASE_PROJECT = "xtech-automation";
const STAGING_PLACEHOLDER = "SET_ME_TO_SEPARATE_STAGING_FIREBASE_PROJECT_ID";

function assertFirebaseProject(projectId, environment = process.env) {
  const mode = String(environment.XTECH_ENV || "production").trim().toLowerCase();
  if (!["production", "staging"].includes(mode)) {
    throw new Error("Invalid XTECH_ENV. Use 'production' or 'staging'.");
  }
  const actual = String(projectId || "").trim();
  if (!actual) throw new Error("Firebase service account is missing project_id.");
  if (mode === "staging") {
    const expected = String(environment.XTECH_STAGING_FIREBASE_PROJECT_ID || "").trim();
    if (!expected || expected === PROD_FIREBASE_PROJECT || expected === STAGING_PLACEHOLDER ||
      /(?:^SET_ME|^REPLACE|^PLACEHOLDER|__.*__)/i.test(expected)) {
      throw new Error("Staging Firebase project ID is missing or unsafe. Configure a separate staging Firebase project.");
    }
    if (actual === PROD_FIREBASE_PROJECT) {
      throw new Error("Refusing production Firebase credentials in staging mode.");
    }
    if (actual !== expected) {
      throw new Error(`Wrong staging Firebase project. Expected ${expected} but received ${actual}.`);
    }
    return actual;
  }
  if (actual !== PROD_FIREBASE_PROJECT) {
    throw new Error(`Wrong production Firebase project. Expected ${PROD_FIREBASE_PROJECT} but received ${actual}.`);
  }
  return actual;
}

module.exports = { assertFirebaseProject, PROD_FIREBASE_PROJECT, STAGING_PLACEHOLDER };
