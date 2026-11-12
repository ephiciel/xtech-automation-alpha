"use strict";
/**
 * XTECH code readability formatter.
 *
 * This command changes layout only: whitespace, indentation, and wrapping.
 * It does not rename identifiers, rewrite expressions, install packages,
 * connect to Firebase, or deploy Cloudflare Workers.
 *
 * Usage:
 *   npm run format:source          # dry-run: list files needing formatting
 *   npm run format:source:check    # CI check: fail on differences
 *   npm run format:source:write    # apply local formatting
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const prettier = require("prettier");

const root = path.resolve(__dirname, "..");
const ignorePath = path.join(root, ".prettierignore");
const mode = process.argv[2] || "--check";

if (!new Set(["--check", "--write"]).has(mode)) {
    console.error("Usage: node scripts/readability-format.cjs --check|--write");
    process.exit(2);
}

function isCodePath(name) {
    const filename = name.replaceAll("\\", "/");
    if (/^(?:backend|frontend|scripts|src|tests|worker)\//.test(filename)) {
        return /\.(?:js|cjs|mjs|css|html)$/.test(filename);
    }
    if (filename === "eslint.config.mjs" || filename === "package.json") return true;
    if (filename === ".prettierrc.json" || filename === ".github/workflows/ci.yml") return true;
    return /^wrangler(?:\.[a-z0-9-]+)?\.jsonc$/i.test(filename);
}

async function main() {
    // Include newly created code too, but never anything ignored by Git.
    const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
        cwd: root,
        encoding: "utf8"
    });
    const files = [...new Set(output.split("\0").filter(Boolean))]
        .filter(isCodePath)
        .sort((a, b) => a.localeCompare(b));
    const changed = [];
    const errors = [];
    let scanned = 0;

    for (const name of files) {
        const full = path.join(root, name);
        try {
            const info = await prettier.getFileInfo(full, { ignorePath });
            if (info.ignored || !info.inferredParser) continue;
            const source = await fs.readFile(full, "utf8");
            const config = (await prettier.resolveConfig(full)) || {};
            const formatted = await prettier.format(source, { ...config, filepath: full });
            scanned++;
            if (formatted !== source) {
                changed.push(name);
                if (mode === "--write") await fs.writeFile(full, formatted, "utf8");
            }
        } catch (error) {
            errors.push({ name, message: error.message });
        }
    }

    const verb = mode === "--write" ? "Formatted" : "Needs formatting";
    console.log(`XTECH source formatting: checked ${scanned} supported files.`);
    for (const name of changed) console.log(`${verb}: ${name}`);
    for (const { name, message } of errors) console.error(`ERROR ${name}: ${message}`);
    console.log(
        `${changed.length} file(s) ${mode === "--write" ? "updated" : "out of style"}; ${errors.length} error(s).`
    );

    if (errors.length || (mode === "--check" && changed.length)) process.exitCode = 1;
}
main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
