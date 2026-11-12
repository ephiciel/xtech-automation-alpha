"use strict";
/**
 * XTECH Stage 4.6 staging isolation preflight.
 * STATIC ONLY: reads project files, never loads credentials, runs HTTP, calls
 * Firebase/Cloudflare/Gemini/Resend, modifies a file, or deploys anything.
 *
 * --audit  Prints findings, exits 0 even when staging is BLOCKED (default).
 * --strict Prints findings, exits 2 if staging has any BLOCK finding.
 * --config <path>  Explicit candidate staging Wrangler configuration.
 * --env <name>     Explicit named environment in the selected config.
 * --project <id>   Intended SEPARATE Firebase staging project ID (not secret).
 */
const fs = require("node:fs");
const path = require("node:path");

const PROD_DOMAIN = "xtech-automation.com";
const PROD_FIREBASE = "xtech-automation";
const PROD_WORKER = "xtech-api";
const SECRET_KEYS = new Set([
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "RESEND_API_KEY",
    "GEMINI_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "FIREBASE_ADMIN_PRIVATE_KEY",
    "API_KEY"
]);

function parseJsonc(source) {
    // Strip JSONC comments without damaging strings containing https:// or /*.
    let output = "",
        quote = false,
        escape = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i],
            n = source[i + 1];
        if (quote) {
            output += c;
            if (escape) escape = false;
            else if (c === "\\") escape = true;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') {
            quote = true;
            output += c;
            continue;
        }
        if (c === "/" && n === "/") {
            while (i < source.length && source[i] !== "\n") i++;
            output += "\n";
            continue;
        }
        if (c === "/" && n === "*") {
            i += 2;
            while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
            i++;
            output += " ";
            continue;
        }
        output += c;
    }
    return JSON.parse(output.replace(/,\s*([}\]])/g, "$1"));
}

function inspect({
    config,
    configName,
    envName = "",
    stagingProjectId = "",
    firebaseSource = "",
    gitignore = "",
    exists = () => true
}) {
    const findings = [];
    const add = (level, id, message) => findings.push({ level, id, message });
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        add("BLOCK", "INVALID_CONFIG", "A valid Wrangler config object is required.");
        return findings;
    }

    const env = envName ? config.env?.[envName] : null;
    if (envName && (!env || typeof env !== "object")) {
        add("BLOCK", "MISSING_ENV", `Named Wrangler environment '${envName}' is not configured.`);
    }

    const workerName = envName ? `${config.name || ""}-${envName}` : String(config.name || "");
    if (!workerName) add("BLOCK", "WORKER_NAME", "A separate Worker name must be configured.");
    else if (
        workerName.toLowerCase() === PROD_WORKER ||
        (envName && envName.toLowerCase() === "production")
    ) {
        add("BLOCK", "PROD_WORKER", "Worker name/environment still selects the production Worker.");
    } else add("OK", "WORKER_NAME", `Worker has a distinct name: ${workerName}.`);

    const selected = env || config;
    const patterns = [];
    if (typeof selected.route === "string") patterns.push(selected.route);
    else if (selected.route?.pattern) patterns.push(selected.route.pattern);
    if (Array.isArray(selected.routes))
        for (const r of selected.routes)
            patterns.push(typeof r === "string" ? r : r.pattern || r.zone_name || "");
    const prodRoute = patterns.some((p) => String(p).toLowerCase().includes(PROD_DOMAIN));
    if (prodRoute)
        add(
            "BLOCK",
            "PRODUCTION_ROUTE",
            "Selected config routes traffic for xtech-automation.com."
        );
    else if (patterns.length)
        add(
            "OK",
            "ROUTE",
            "Selected routes do not contain the production domain; verify the staging zone independently."
        );
    else if (selected.workers_dev === true)
        add("OK", "WORKERS_DEV", "Selected config explicitly uses a workers.dev endpoint.");
    else
        add(
            "BLOCK",
            "STAGING_ENDPOINT",
            "Explicitly configure workers_dev:true or a separate staging route."
        );

    if (!envName && path.basename(configName).toLowerCase() === "wrangler.jsonc") {
        add(
            "BLOCK",
            "DEFAULT_CONFIG",
            "Production wrangler.jsonc is the default; use an explicit separate staging config or --env staging."
        );
    }

    const main = String(selected.main || config.main || "");
    if (!main || !exists(main))
        add("BLOCK", "ENTRYPOINT", "The selected Worker main entrypoint does not exist.");
    else add("OK", "ENTRYPOINT", "Worker entrypoint exists.");

    const assets = selected.assets || config.assets;
    if (!assets || !assets.directory || !exists(String(assets.directory))) {
        add("BLOCK", "ASSETS", "Frontend assets directory does not exist.");
    } else add("OK", "ASSETS", "Frontend assets directory exists.");
    const rules = assets?.run_worker_first || [];
    if (!Array.isArray(rules) || !rules.some((x) => x === "/api/*")) {
        add("BLOCK", "API_ROUTE_PRIORITY", "Worker-first asset routing must include '/api/*'.");
    } else add("OK", "API_ROUTE_PRIORITY", "API worker-first routing is configured.");

    const vars = selected.vars || {};
    const leaked = Object.keys(vars).filter(
        (k) =>
            SECRET_KEYS.has(k.toUpperCase()) ||
            /(?:SECRET|PRIVATE_KEY|PASSWORD|TOKEN)$/.test(k.toUpperCase())
    );
    if (leaked.length)
        add(
            "BLOCK",
            "PLAINTEXT_SECRETS",
            "Secret-like configuration keys are in vars. Store them using environment-specific Cloudflare secrets (values intentionally not displayed)."
        );
    else
        add(
            "OK",
            "SECRETS",
            "No recognized secrets found in plaintext Wrangler vars (remote secret presence not verified)."
        );

    if (!stagingProjectId || stagingProjectId === PROD_FIREBASE) {
        add(
            "BLOCK",
            "FIREBASE_PROJECT",
            "Specify an existing, non-production staging Firebase project ID using --project."
        );
    }
    if (/serviceAccount\.project_id\s*!==\s*["']xtech-automation["']/.test(firebaseSource)) {
        add(
            "BLOCK",
            "FIREBASE_HARDCODED",
            "backend/firebase.js explicitly rejects Firebase projects other than production. Separate staging data is not yet supported."
        );
    } else if (!/project_id/.test(firebaseSource)) {
        add(
            "BLOCK",
            "FIREBASE_PROJECT_VALIDATION",
            "Firebase project selection could not be verified by static inspection."
        );
    } else if (stagingProjectId && stagingProjectId !== PROD_FIREBASE) {
        add(
            "WARN",
            "FIREBASE_UNVERIFIED",
            "Separate Firebase project support may exist; confirm the actual credentials resolve to the stated staging project before testing."
        );
    }

    if (
        !/^\.env$/m.test(gitignore) ||
        !/serviceAccountKey\.json/.test(gitignore) ||
        !/\.dev\.vars/.test(gitignore)
    ) {
        add(
            "BLOCK",
            "SECRET_IGNORES",
            "Check .gitignore for .env, serviceAccountKey.json and .dev.vars exclusions."
        );
    } else add("OK", "SECRET_IGNORES", "Common local secret files are Git-ignored.");

    add(
        "WARN",
        "REMOTE_NOT_TESTED",
        "No actual staging credentials, email, Firebase, Gemini, Cloudflare API, or Worker deployment were tested."
    );
    return findings;
}

function parseArgs(argv) {
    const opts = { mode: "audit", config: "wrangler.jsonc", env: "", project: "" };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--strict") opts.mode = "strict";
        else if (a === "--audit") opts.mode = "audit";
        else if (["--config", "--env", "--project"].includes(a)) {
            if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error(`${a} requires a value`);
            opts[a.slice(2)] = argv[++i];
        } else throw Error(`Unknown option: ${a}`);
    }
    return opts;
}
function audit(root, opts) {
    const configFile = path.resolve(root, opts.config);
    const raw = fs.readFileSync(configFile, "utf8");
    const config = parseJsonc(raw);
    const firebaseSource = fs.readFileSync(path.join(root, "backend/firebase.js"), "utf8");
    const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    return inspect({
        config,
        configName: opts.config,
        envName: opts.env,
        stagingProjectId: opts.project,
        firebaseSource,
        gitignore,
        exists: (rel) => fs.existsSync(path.resolve(root, rel))
    });
}
function main(argv, root = path.resolve(__dirname, "..")) {
    const opts = parseArgs(argv);
    const findings = audit(root, opts);
    console.log("XTECH Stage 4.6 - Read-only staging preflight (NO NETWORK CALLS)");
    console.log(`Configuration: ${opts.config}; environment: ${opts.env || "default"}`);
    console.log("IMPORTANT: this checks CONFIGURATION ONLY, never live credentials.");
    for (const f of findings) console.log(`[${f.level}] ${f.id}: ${f.message}`);
    const blockers = findings.filter((f) => f.level === "BLOCK").length;
    console.log(
        `\n${blockers ? `STAGING NOT READY: ${blockers} blocking issue(s).` : "Static staging configuration checks have no blocking issues."}`
    );
    console.log("Never run unqualified 'wrangler deploy' while wrangler.jsonc targets production.");
    return opts.mode === "strict" && blockers ? 2 : 0;
}
if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        console.error(`Preflight could not run: ${error.message}`);
        process.exitCode = 1;
    }
}
module.exports = { parseJsonc, inspect, parseArgs, audit, main };
