"use strict";
/** Strict, OFFLINE staging deployment gate. No secrets, network, writes or deployment. */
const fs = require("node:fs");
const path = require("node:path");
const { parseJsonc } = require("./staging-preflight");
const { PROD_FIREBASE_PROJECT, STAGING_PLACEHOLDER } = require("../backend/utils/firebase-project");

function inspect(config, requestedProjectId, paths = {}) {
  const problems = [];
  const block = (key, explanation) => problems.push({ key, explanation });
  const vars = config?.vars || {};
  const project = String(requestedProjectId || "").trim();
  const declared = String(vars.XTECH_STAGING_FIREBASE_PROJECT_ID || "").trim();
  const name = String(config?.name || "").trim().toLowerCase();
  const routes = Array.isArray(config?.routes) ? config.routes : [];

  if (!name || name === "xtech-api" || !/staging/.test(name)) block("WORKER_NAME", "Select a clearly distinct staging Worker name.");
  if (config?.workers_dev !== true) block("WORKERS_DEV", "Staging must use an explicit workers.dev endpoint.");
  if (config?.route || routes.length || config?.custom_domain) block("NO_CUSTOM_ROUTES", "Staging must not use any custom domain or route.");
  if (config?.main !== "worker/index.mjs") block("ENTRYPOINT", "Expected the standalone direct Worker entrypoint worker/index.mjs.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(config?.compatibility_date || "")) || config.compatibility_date < "2026-08-04") {
    block("COMPATIBILITY", "Set a compatibility date supporting Node.js APIs (2026-08-04 or later).");
  }
  if (config?.assets?.directory !== "./frontend" || config.assets.binding !== "ASSETS" ||
      !Array.isArray(config.assets.run_worker_first) ||
      !config.assets.run_worker_first.includes("/api/*")) {
    block("ASSETS", "Frontend assets must use ASSETS and the /api/* worker-first route.");
  }
  if (vars.CLOUDFLARE_WORKER !== "true" || vars.XTECH_ENV !== "staging" || String(vars.PORT) !== "3000") {
    block("STAGING_MODE", "Staging Worker must explicitly set CLOUDFLARE_WORKER, PORT and XTECH_ENV=staging.");
  }
  if (!project || project === PROD_FIREBASE_PROJECT || project === STAGING_PLACEHOLDER ||
      !/^[a-z][a-z0-9-]{3,60}$/i.test(project)) {
    block("PROJECT_ARGUMENT", "Supply the actual separate staging Firebase project ID with --project.");
  }
  if (!declared || declared === PROD_FIREBASE_PROJECT || declared === STAGING_PLACEHOLDER || declared !== project) {
    block("FIREBASE_MATCH", "Config staging Firebase project ID must match --project and must not be production or a placeholder.");
  }
  const secretVars = Object.keys(vars).filter(k => /(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|RESEND_API_KEY|GEMINI_API_KEY|GOOGLE_SERVICE_ACCOUNT_JSON|FIREBASE_SERVICE_ACCOUNT_JSON)/i.test(k));
  if (secretVars.length) block("PLAINTEXT_SECRETS", "Move API credentials into staging Worker secrets; never use Wrangler vars.");
  if (paths.productionConfig && paths.productionConfig.name === config.name) block("PROD_NAME_COLLISION", "Staging Worker name matches production.");
  if (paths.firebaseSource && !/assertFirebaseProject\(serviceAccount\.project_id,\s*process\.env\)/.test(paths.firebaseSource)) {
    block("FIREBASE_RUNTIME_GUARD", "backend/firebase.js must verify credential project ID using the environment-aware guard.");
  }
  return problems;
}

function parseArgs(argv) {
  const opts = { project: "", mode: "strict", config: "wrangler.staging.jsonc" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--audit") opts.mode = "audit";
    else if (arg === "--strict") opts.mode = "strict";
    else if (arg === "--project" || arg === "--config") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error(`${arg} requires a value`);
      opts[arg.slice(2)] = argv[++i];
    } else throw Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function main(argv, root = path.resolve(__dirname, "..")) {
  const args = parseArgs(argv);
  const projectRoot = path.resolve(root);
  const configPath = path.resolve(projectRoot, args.config);
  if (configPath !== path.join(projectRoot, "wrangler.staging.jsonc")) {
    throw Error("The staging guard permits only the dedicated wrangler.staging.jsonc file.");
  }
  const config = parseJsonc(fs.readFileSync(configPath, "utf8"));
  const productionConfig = parseJsonc(fs.readFileSync(path.join(projectRoot, "wrangler.jsonc"), "utf8"));
  const firebaseSource = fs.readFileSync(path.join(projectRoot, "backend", "firebase.js"), "utf8");
  const problems = inspect(config, args.project, { productionConfig, firebaseSource });
  console.log("XTECH Stage 4.7 - OFFLINE isolated staging guard (no network, secrets or deployment)");
  for (const item of problems) console.log(`[BLOCK] ${item.key}: ${item.explanation}`);
  console.log(problems.length ? `STAGING BLOCKED: ${problems.length} issue(s).` : "Static isolation checks passed. Live staging verification is STILL REQUIRED.");
  return problems.length && args.mode === "strict" ? 2 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(`Staging guard could not run: ${e.message}`); process.exitCode = 1; }
}
module.exports = { inspect, parseArgs, main };
