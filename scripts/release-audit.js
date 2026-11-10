"use strict";
// Stages 4.47–4.50: read-only release-candidate audit. Never contacts providers or mutates data.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const issues = [];
const check = (condition, detail) => {
    if (condition) console.log(`PASS: ${detail}`);
    else {
        issues.push(detail);
        console.error(`FAIL: ${detail}`);
    }
};

const html = read("frontend/index.html");
const app = read("frontend/js/app.js");
const api = read("frontend/js/api-client.js");
const auth = read("backend/middleware/auth.js");
const audit = read("package.json");
const scripts = [...html.matchAll(/<script\s+src="js\/([^"]+)"[^>]*><\/script>/g)].map(
    (item) => item[1]
);
const unique = new Set(scripts);
check(unique.size === scripts.length, "Frontend JavaScript files are not loaded twice");
check(
    scripts.indexOf("ui-feedback.js") > scripts.indexOf("app-lifecycle.js") &&
        scripts.indexOf("ui-feedback.js") < scripts.indexOf("app.js"),
    "UI dependencies load before app.js"
);
check(
    scripts.filter((name) => name === "app.js").length === 1,
    "Application entry point loads exactly once"
);
check(
    /id="toast"[^>]*role="status"[^>]*aria-live="polite"/.test(html),
    "Toast has an accessible status announcement"
);
check(
    /id="loadingOverlay"[^>]*role="status"[^>]*aria-live="polite"/.test(html),
    "Loading overlay has an accessible status announcement"
);
check(
    /verifyIdToken\(idToken, true\)/.test(auth) && /function roles\(/.test(auth),
    "Server retains revoked-token verification and role authorization"
);
check(
    /getToken\(\)/.test(api) && /headers\.Authorization/.test(api),
    "API obtains current Bearer token on each request"
);
check(
    /NETWORK_ERROR/.test(api) && !/\bretry\s*\(/.test(api),
    "Network errors are classified without repeating mutations"
);
check(
    /XTechUiFeedback\.createUiFeedback/.test(app),
    "Shared UI feedback dependencies are injected"
);
check(
    /XTechAppLifecycle\.createAppLifecycle/.test(app),
    "One-time application lifecycle remains registered"
);
check(
    JSON.parse(audit).scripts["test:release-audit"] === "node scripts/release-audit.js",
    "Release audit is available through npm"
);

try {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
        .split("\0")
        .filter(Boolean)
        .map((file) => file.replaceAll("\\", "/"));
    const leaked = tracked.filter((file) =>
        /(^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|serviceAccountKey\.json|.*\.(?:pem|p12|pfx|key))$/i.test(
            file
        )
    );
    check(
        leaked.length === 0,
        `No tracked credential or private-key files (${leaked.join(", ") || "none"})`
    );
} catch (error) {
    check(false, `Unable to inspect Git-tracked secrets: ${error.message}`);
}

if (issues.length) {
    console.error(`RELEASE AUDIT FAILED: ${issues.length} issue(s).`);
    process.exitCode = 1;
} else {
    console.log("RELEASE AUTOMATED AUDIT PASSED.");
    console.log(
        "MANUAL RELEASE GATES STILL REQUIRED: browser, role, accessibility, staging Cloudflare/Firebase, rollback and client acceptance."
    );
}
