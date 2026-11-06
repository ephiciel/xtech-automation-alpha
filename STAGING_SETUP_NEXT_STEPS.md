# XTECH — Stage 4.7 isolated staging setup

This package only changes **local source and configuration**. It has not created a Firebase project, Worker, DNS entry, Cloudflare secret, or deployed anything. **The staging Worker cannot start successfully with the placeholder Firebase ID**; this is deliberate.

## 1. Create an isolated Firebase staging project

Create a *separate* Firebase project in the Firebase Console, with its own Authentication users and Firestore database. Never share the production service account, project ID, or customer records with staging. Use synthetic test customers and stock data. Note the new project's `project_id` (public identifier, not a secret).

Do **not** copy the production service-account JSON or its private key into this project, a chat, GitHub, or Wrangler `vars`.

## 2. Configure a staging-only Worker

Edit **only** `wrangler.staging.jsonc`, replacing:

`SET_ME_TO_SEPARATE_STAGING_FIREBASE_PROJECT_ID`

with the actual separate Firebase staging project ID. Do not rename the staging Worker to `xtech-api`, add custom routes, or attach `xtech-automation.com`. Keep `workers_dev: true`, `XTECH_ENV: staging`, and `main: worker/index.mjs`.

Cloudflare runtime bindings must include the *staging project's* `GOOGLE_SERVICE_ACCOUNT_JSON` as a **secret**, not a plaintext Wrangler var. Separate staging-only secrets are also needed for `RESEND_API_KEY` and `GEMINI_API_KEY` to test those integrations. Use test-only accounts and avoid sending messages to real customers.

## 3. Perform the strictly offline checks first

In PowerShell at the project root (replace with your *nonproduction* project ID):

```powershell
npm run test:staging-isolation
npm run preflight:staging:isolated -- --project your-real-staging-firebase-project-id
node scripts/staging-preflight.js --config wrangler.staging.jsonc --project your-real-staging-firebase-project-id --strict
npm run lint
npm test
```

The first line tests the guard itself. The second and third inspect files without network access or credential loading. They must have **no blocking issues** before staging deployment. Offline checks **do not verify** that the Cloudflare Worker has the correct secrets.

## 4. Manual staging acceptance (separate stage)

Only after confirming a separate Firebase project and staging-only Cloudflare secrets, use a dedicated staging deploy command with **explicit** `--config wrangler.staging.jsonc` and its own Worker name. Review the exact command before running it. Never use the production `npm run cf:deploy` shortcut. Verify registration, Resend OTP, role permissions, Firestore mutations, stock auditing, notifications, reports, Gemini, and rollback using synthetic staging accounts only.

Do not merge this branch into `main`, modify the production domain route, or change production secrets until staging acceptance is complete. Preserve the production Worker version and rollback plan.
