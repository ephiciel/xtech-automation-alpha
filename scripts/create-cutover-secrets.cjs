// Creates a TEMPORARY secrets file outside the repository for one deployment.
// It never prints secret values and should not be committed to GitHub.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");

function fail(message) {
  console.error(`Cutover preflight failed: ${message}`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const dotenvFile = path.join(root, ".env");
if (!fs.existsSync(dotenvFile)) fail(".env is missing from the project root.");

const parsed = dotenv.parse(fs.readFileSync(dotenvFile, "utf8"));
const secrets = Object.fromEntries(
  Object.entries(parsed).filter(([key, value]) =>
    /^[A-Z][A-Z0-9_]*$/.test(key) &&
    typeof value === "string" && value.trim() !== "" &&
    key !== "CLOUDFLARE_WORKER" && key !== "PORT"
  )
);

let accountJSON = secrets.GOOGLE_SERVICE_ACCOUNT_JSON || secrets.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!accountJSON) {
  const configuredPath = String(parsed.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  const keyPaths = [
    configuredPath && path.resolve(root, configuredPath),
    path.join(root, "backend", "serviceAccountKey.json"),
  ].filter(Boolean);
  const localPath = keyPaths.find(p => fs.existsSync(p));
  if (!localPath) fail("Firebase service account JSON missing. Place the existing backend/serviceAccountKey.json locally. Do not upload it to GitHub.");
  accountJSON = fs.readFileSync(localPath, "utf8");
}
let obj;
try { obj = JSON.parse(accountJSON); }
catch { fail("Firebase service account JSON could not be parsed."); }
if (obj.project_id !== "xtech-automation" || !obj.private_key || !obj.client_email) {
  fail("Firebase service account JSON has missing credentials or the wrong project_id.");
}
secrets.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(obj);
delete secrets.FIREBASE_SERVICE_ACCOUNT_JSON;
delete secrets.FIREBASE_SERVICE_ACCOUNT_PATH;

const required = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID", "FIREBASE_MESSAGING_SENDER_ID"];
const missing = required.filter(key => !secrets[key]);
if (missing.length) fail("Missing values in .env: " + missing.join(", "));
if (secrets.FIREBASE_PROJECT_ID !== "xtech-automation") fail("Incorrect FIREBASE_PROJECT_ID in .env.");

const outfile = path.join(os.tmpdir(), `xtech-cutover-${crypto.randomUUID()}.json`);
fs.writeFileSync(outfile, JSON.stringify(secrets), { mode: 0o600, flag: "wx" });
// Only the temporary file PATH is printed; never secret values.
process.stdout.write(outfile);
