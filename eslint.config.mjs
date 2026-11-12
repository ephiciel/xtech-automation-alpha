import js from "@eslint/js";
import globals from "globals";

// Treat existing code issues as warnings during the first cleanup.
// We will gradually make important rules stricter.
const baselineRules = Object.fromEntries(
    Object.keys(js.configs.recommended.rules).map((rule) => [rule, "warn"])
);

export default [
    {
        ignores: [
            "node_modules/**",
            ".wrangler/**",
            "coverage/**",
            "dist/**",
            "**/*.min.js",
            "**/*.bak"
        ]
    },
    {
        files: ["backend/**/*.js", "scripts/**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.browser
            }
        },
        rules: {
            ...baselineRules,
            "no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_"
                }
            ]
        }
    },
    {
        files: ["frontend/js/**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                Chart: "readonly",
                QRCode: "readonly"
            }
        },
        rules: baselineRules
    },
    {
        files: ["worker/**/*.{js,mjs}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node
            }
        },
        rules: baselineRules
    }
];
