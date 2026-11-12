# XTECH Automation - Codebase guide

**Purpose:** Make the capstone source easier to read, debug, review, and explain during a panel defense. This document describes the repository at merge commit `217e11d` and the formatting conventions introduced by the readability branch. It is not a guarantee that the application has passed real-world acceptance tests.

## 1. High-level architecture

```text
Browser: frontend/index.html + frontend/css/ + frontend/js/
     |  Firebase Authentication obtains an ID token
     |  HTTPS requests carry Authorization: Bearer <ID token>
     v
Cloudflare Worker: worker/production.mjs -> worker/direct.mjs
     |  Express routing, validation, role checks
     v
backend/server.js -> backend/routes/*.routes.js
     |  Firebase Admin Auth / Firestore adapter / Resend / Gemini
     v
Separate Firebase projects for production and staging
```

Cloudflare serves static frontend assets and routes `/api/*` to the Express API. Cloudflare's workers.dev endpoint and the custom production domain are not interchangeable with the isolated staging Worker. Never use production credentials in staging.

## 2. Locate features by file

| Area | Important files | Responsibility |
| --- | --- | --- |
| Startup / API registration | `backend/server.js`, `worker/production.mjs`, `worker/direct.mjs` | Server lifecycle and route registration, Worker dispatch |
| Firebase | `backend/firebase.js`, `backend/utils/firebase-project.js` | Firebase Admin initialization and environment isolation |
| Authorization | `backend/middleware/auth.js` | Bearer token validation, revocation check, role authorization |
| Inventory | `backend/routes/inventory.routes.js`, `frontend/js/inventory-ui.js` | Product CRUD, archive, stock in/out and audit |
| Customers | `backend/routes/customers.routes.js`, `frontend/js/customer-ui.js` | Customer records and history |
| Pickups | `backend/routes/pickups.routes.js`, `frontend/js/pickup-ui.js` | Requests, approval, completion and stock deduction |
| Sales | `backend/routes/sales.routes.js`, `frontend/js/sales-ui.js` | Quantity-only sales and stock audit |
| Reports | `backend/routes/report-dashboard.routes.js`, `frontend/js/reports-ui.js`, `frontend/js/dashboard-ui.js` | Role-specific dashboard, summary and CSV |
| Sign-in & registration | `backend/routes/email-otp.routes.js`, `backend/routes/customer-registration.routes.js`, `frontend/js/auth-ui.js` | Firebase login, email OTP and account creation |
| User accounts | `backend/routes/user-accounts.routes.js`, `frontend/js/staff-ui.js` | Staff management |
| Account profile | `backend/routes/customer-profile.routes.js`, `frontend/js/profile-ui.js`, `frontend/js/security-ui.js` | Customer profile and security |
| Notifications | `backend/routes/account-notification.routes.js`, `frontend/js/notification-ui.js` | Customer-only notifications |
| AI help | `backend/routes/ai-assistant.routes.js`, `backend/xtechManual.js`, `frontend/js/ai-assistant-ui.js` | Role-scoped user help and chat |
| Browser composition | `frontend/js/app.js`, `frontend/js/app-lifecycle.js`, `frontend/js/app-shell-ui.js` | Dependency assembly, startup, navigation |
| Browser state | `frontend/js/app-state.js`, `frontend/js/auth-session-state.js` | Operational and authentication-flow state |
| Shared browser code | `frontend/js/api-client.js`, `frontend/js/shared-utils.js`, `frontend/js/ui-feedback.js` | API calls, validation and feedback |
| Code validation | `scripts/validate.js`, `scripts/release-audit.js`, `tests/`, `.github/workflows/ci.yml` | Checks, regressions, CI |

## 3. Read the code in this order

1. Open `frontend/index.html`: note the script load order and pages.
2. Open `frontend/js/app.js`: inspect how dependencies are passed to feature modules.
3. Open `frontend/js/app-lifecycle.js`: trace Firebase initialization and the auth observer.
4. Open `frontend/js/api-client.js`: follow token attachment, error reporting, and pending state.
5. Open `backend/server.js`: find where routes, Firebase, and middleware are registered.
6. Open `backend/middleware/auth.js`: trace `authRequired` and `roles(...)`.
7. Open a feature's `backend/routes/*.routes.js` file: validate input, check permissions, run database transaction, and return an HTTP response.
8. Open the matching `frontend/js/*-ui.js` module to identify its form handlers and rendering logic.

## 4. Readability conventions

- **Formatting:** Run Prettier with the existing `.prettierrc.json`. No functional rewrite should be performed by the formatter.
- **Indentation and wrapping:** Let Prettier handle them consistently instead of manually aligning code.
- **Naming:** Prefer descriptive names. Keep existing exported names, API fields, Firestore field names, statuses and endpoint paths unchanged in this formatting stage.
- **Functions:** Keep validation, role checks, data operations and response formatting conceptually separate. Consider future refactoring only with a test for the behavior being changed.
- **Comments:** Explain *why* a business rule exists; avoid comments that merely repeat what obvious statements do.
- **Errors:** Backend returns an HTTP status and a safe response; UI handles user-facing messaging. Never silently retry a write that could duplicate a sale or pickup.
- **Security:** Authorization is enforced on the server. Hidden UI navigation is not sufficient access control.
- **Dependencies:** Browser modules should receive state and services through explicit factory parameters rather than creating duplicate global state.
- **Secrets:** Keep `.env`, service account JSON, API tokens and other credentials out of Git. Never print them into presentation logs.

## 5. Critical business invariants

1. Product stock cannot become negative and archived products cannot be stocked in/out.
2. The product edit API cannot directly change `quantity`; stock changes require `stock-in` / `stock-out` auditing.
3. A pickup request checks available stock but **does not reserve or deduct it**. Approval checks again. Completion deducts the quantity in a Firestore transaction and records `PICKUP_OUT`.
4. A confirmed sale deducts stock transactionally and records `SALE_OUT`.
5. Customer accounts cannot read other customers' pickup or notification records.
6. Customers may cancel their own pending pickups, but cannot approve or complete them.
7. Admin-only user management and report export are server enforced.
8. No monetary calculations or price fields should be reintroduced in the current quantity-only workflow.

## 6. Readability commands

```powershell
npm.cmd run format:source:check   # read-only: verify consistency
npm.cmd run format:source:write   # apply Prettier to supported code files
npm.cmd run lint -- --max-warnings 0
npm.cmd test
npm.cmd run test:release-audit
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run test:staging-isolation
npm.cmd run test:staging-preflight
```

`format:source:write` is intentionally not an automatic GitHub Action because CI should not silently rewrite a pull request. CI runs the read-only check. The formatter covers tracked/new nonignored JS, CJS, MJS, HTML, CSS, relevant JSON/JSONC, and workflow YAML. It does **not** rewrite PowerShell, Dockerfile, Firestore rules, Markdown manuals, generated assets, credentials, or the dependency lockfile. Those require separate, format-aware review.

## 7. Safety and change review

- Create a dedicated branch from a clean reviewed commit before modifying source.
- Back up original source files outside the Git working tree.
- Review `git diff --stat` and a few representative diffs before creating the pull request.
- Run the full automated suite, then perform the staging smoke tests.
- Never auto-push, merge, deploy, rotate credentials, or modify Firestore records during a readability pass.
- The repository currently contains some historical deployment and container-transition files. Do not delete them as part of a formatting-only update; review them separately if they become unused.

## 8. Debugging quick reference

| Symptom | Where to inspect first | What to confirm |
| --- | --- | --- |
| Browser 404 or broken route | Network panel; `worker/direct.mjs`; Wrangler assets routing | `/api/*` reaches Express and frontend assets load |
| Login/TOTP denied | Firebase staging project settings; auth module | Right Firebase project, TOTP enabled, valid account |
| 401 Unauthorized | `backend/middleware/auth.js` | Valid bearer token and revocation status |
| 403 Forbidden | Role middleware and Firestore user profile | User's actual role permits this endpoint |
| Products fail to load | `backend/routes/inventory.routes.js` | Firestore availability; role; error response |
| Stock rejected | Product active flag; quantity; stock transaction code | Non-negative quantity and current authoritative stock |
| Pickup fails to complete | Pickup state machine and stock transaction | `Approved` status and available inventory |
| Email OTP not arriving | `backend/mailer.js`, email provider logs | Correct Resend configuration and no cooldown |
| 503 at API | Worker logs, Firebase initialization | Correct service account for the deployment environment |
| CI failure after format | Exact failing test and Git diff | Fix the formatting-sensitive assertion or revert only the affected formatting with review |

## 9. Panel-defense explanation

> "I standardized the layout of our JavaScript, frontend markup, styles and supported configurations without intentionally changing application logic. I kept the code readable through consistent formatting, an explicit module guide, and automated checks. Our CI now checks the entire supported codebase for formatting consistency. Each readability change goes through a separate branch, tests and manual review before being merged."

**Do not claim the new readability branch is merged, deployed, or live-tested until those steps have actually occurred.**
