# XTECH Stage 4.6 — Staging Acceptance Checklist

This package adds read-only local preflight tooling. **No production deployment, Firebase write, Git push, credentials access, or external API call is performed by the installer or preflight.**

## Confirmed blockers from current source

1. The default `wrangler.jsonc` is configured with a route for `xtech-automation.com/*` and name `xtech-api` — **production**. Do **not** use unqualified `wrangler deploy` or the existing `cf:deploy` script to test staging.
2. `backend/firebase.js` explicitly checks `serviceAccount.project_id` equals `xtech-automation`. A separate staging Firebase project currently cannot pass that validation without a reviewed change. A separate staging Worker using the same Firebase credentials would still affect **production data**.
3. These checks cannot prove real Resend email delivery, Firebase auth, Gemini API calls, Cloudflare Worker startup, or Cloudflare secrets are working.

## Read-only commands

```powershell
npm run test:staging-preflight
npm run preflight:staging
```

The second command intentionally reports **STAGING NOT READY** until the isolation blockers above are addressed. The installer can succeed while the staging audit reports blockers. This is expected and prevents false confidence.

For a separately reviewed candidate staging config and staging Firebase project:

```powershell
node scripts/staging-preflight.js --strict --config wrangler.staging.jsonc --project YOUR_STAGING_PROJECT_ID
```

Use a **real staging project ID** but never paste secret keys or service account JSON into the command, console output, Git, or ChatGPT.

Alternatively, when using a named Wrangler environment in `wrangler.jsonc`:

```powershell
node scripts/staging-preflight.js --strict --config wrangler.jsonc --env staging --project YOUR_STAGING_PROJECT_ID
```

An audit exit code of 0 with `--audit` means only that the audit ran. `--strict` exits with status 2 when blocking findings remain. Neither mode calls Cloudflare or Firebase.

## Required staging setup (do not execute on production)

- [ ] Create a **separate Firebase staging project**, with staging-only Auth users, Firestore data, and permissions.
- [ ] Update backend Firebase initialization **in a reviewed commit** to support an explicitly configured staging project. Keep production default unchanged and reject mismatched project IDs.
- [ ] Create a **separate Cloudflare staging Worker** using `workers.dev` or an explicitly separate staging hostname. Do not inherit production `routes` without scrutiny.
- [ ] Configure staging-only `GOOGLE_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `GEMINI_API_KEY` and other required secrets in the staging Worker; do not add them under Wrangler `vars` or into the repo. Verify secret availability through Cloudflare without revealing values.
- [ ] Confirm no staging route, custom domain, account, secret, resource binding or credential points to production.
- [ ] Check `wrangler` environment selection explicitly before any future deployment. Cloudflare supports named environments with `--env staging`, but this document does not run that command.
- [ ] Run `npm run test:unit`, `npm run test:integration`, `npm run test:staging-preflight`, `npm run lint`, `npm test`.

## Manual end-to-end acceptance in the ISOLATED staging environment only

| Area | Acceptance criteria | Status |
|---|---|---|
| Registration | New customer account is initially inactive; pending verification; duplicate email blocked | Not run |
| OTP / Resend | Test mailbox receives code; wrong/expired code rejected; correct code verifies only staging user | Not run |
| Firebase Auth | Admin/secretary/warehouse/customer sign-in; role-specific endpoint restrictions | Not run |
| Inventory | Stock in/out audited; archived product locked; insufficient stock refused | Not run |
| Pickups | Pending/approval/completion/cancellation, `PICKUP_OUT` audit, customer notifications | Not run |
| Sales | Confirmed sale decrements inventory once, writes `SALE_OUT` audit, notifies linked customer | Not run |
| Reports | Dashboard counts, date filtering and CSV exports correct | Not run |
| AI chat | Staging Gemini key used; chat history isolated per authenticated user; rate-limit errors safe | Not run |
| Cloudflare | Staging Worker startup, assets, `/health`, `/api/status`, protected route denial work | Not run |
| Recovery | Valid rollback revision, backup of staging fixtures and a documented reversal path | Not run |

Record test evidence without passwords, OTP codes, tokens, keys, customer private data, or service account JSON. Do not use real customer records.

## Release gates

**Do not merge or deploy to production** while a staging isolation BLOCK is open, any unit/integration check fails, staging acceptance has not been completed, or rollback is not rehearsed. Production should remain unchanged through this phase.

Official Cloudflare documentation: https://developers.cloudflare.com/workers/wrangler/environments/
