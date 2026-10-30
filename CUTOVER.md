# XTECH production cutover — direct Cloudflare Worker

**Production domain:** `https://xtech-automation.com`  
**API route:** `xtech-automation.com/api/*`  
**Worker name:** `xtech-api`  
**Tested direct Worker:** `xtech-api-direct-test`  
**GitHub repository:** `ephiciel/xtech-automation-alpha` (`main`)

## Architecture and safety

This changes the **existing** `xtech-api` Worker from a Container-backed proxy to a direct Cloudflare Worker. The current API route, website/frontend deployment, Firebase project, database, and URL remain unchanged. This was chosen so Cloudflare's **existing GitHub Builds connection to `xtech-api`** can continue without changing Worker names or DNS.

`worker/direct.mjs` is the code from the successfully tested staging worker. `worker/production.mjs` only imports it and retains old Durable Object class exports; it does **not** call any Durable Object or Container. The production `wrangler.jsonc` has **no `containers` block or `durable_objects.bindings`**. The old Durable Object namespaces remain registered as a non-destructive rollback precaution. **Do not delete either namespace or the old Container application during the rollback window.**

## STEP 0 — Before touching production

- Confirm the seven test features still pass at `xtech-api-direct-test.<account>.workers.dev`.
- Ensure `.env` exists in your local repository root (never commit it).
- Ensure `backend/serviceAccountKey.json` still exists **locally**, or set `GOOGLE_SERVICE_ACCOUNT_JSON` in your local `.env`. **Never commit or paste this key into chat.**
- Ensure the local `.env` contains the same Firebase web configuration, Resend, Gemini and admin settings needed by the tested API.
- In the Cloudflare dashboard, check **Workers & Pages > xtech-api > Settings > Builds** is still connected to `ephiciel/xtech-automation-alpha`, production branch `main`, deploy command `npx wrangler deploy`. **Temporarily disable automatic production deployments** during cutover if a build can be triggered unexpectedly. Re-enable after verification.
- Go to **Workers & Pages > xtech-api > Deployments**, note the last known working version ID for rollback. The old Container route might already be unhealthy; if so, its rollback is not guaranteed.

## STEP 1 — Extract into your local repository

Extract ZIP to `C:\Users\arcadio\Downloads\xtech-automation-alpha`, preserving paths. Replace `wrangler.jsonc` when asked. Do not delete old `src/index.js`, Dockerfile, or other old files.

Expected additions/updates:

- `wrangler.jsonc` (new direct production config; Worker name stays `xtech-api`)
- `wrangler.container.rollback.jsonc` (old config backup)
- `worker/direct.mjs` (tested Worker code)
- `worker/production.mjs` (keeps legacy DO class exports without using them)
- `scripts/create-cutover-secrets.cjs`
- `scripts/deploy-direct-production.ps1`
- `scripts/rollback-container.ps1`
- `CUTOVER.md`

## STEP 2 — Deploy **locally before pushing GitHub**

In PowerShell, at project root:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\deploy-direct-production.ps1
```

This will check JS syntax and run `wrangler deploy --dry-run`, then create a temporary JSON file **outside the project** containing `.env` values plus your local Firebase service account. It deploys **the direct Worker to `xtech-api`**, uploading the secrets with the code, and deletes that temporary file. **No secrets are committed to GitHub.** Cloudflare preserves existing Worker secrets not present in the uploaded file.

The script **refuses to deploy** if the Firebase service-account JSON cannot be read locally. It does not transfer/extract secret values from Cloudflare, and the old production Worker may not already have the JSON secret.

**Do not use** the old command `npx wrangler deploy --secrets-file .env` by itself until `wrangler.jsonc` is switched to direct mode; the old config would redeploy a Container.

## STEP 3 — Verify production BEFORE GitHub push

Visit:

- `https://xtech-automation.com/api/status` — should be HTTP 200 and `success: true`.
- `https://xtech-automation.com/api/config` — nonempty Firebase web app properties, same Firebase project.
- `https://xtech-automation.com/` — login and dashboard load.
- Admin/customer sign-in and OTP, pickup request/notifications, inventory list, sales (use a test record).

If the frontend is served by Cloudflare Pages, leave Pages and DNS untouched: the only route being updated is `/api/*`. Watch errors with `npx wrangler tail xtech-api --format pretty`.

## STEP 4 — Commit and enable automatic GitHub deployment

After the live API is verified, commit only code/config/docs:

```powershell
git add wrangler.jsonc wrangler.container.rollback.jsonc worker/direct.mjs worker/production.mjs scripts/create-cutover-secrets.cjs scripts/deploy-direct-production.ps1 scripts/rollback-container.ps1 CUTOVER.md
git status
git commit -m "Migrate XTECH production API from Container to direct Worker"
git push origin main
```

Cloudflare Workers Builds is already connected to **`xtech-api`**. With `main` and `npx wrangler deploy`, GitHub pushes will now build a normal Worker, with no Docker image. Watch the first GitHub-triggered deployment and test `/api/status` again. **Secrets remain configured in the Cloudflare Worker**, not in GitHub, and Cloudflare preserves existing secrets not supplied in a deploy.

If the old Container build integration is still connected to a different Worker such as `xtech-automation-alpha`, disable that duplicate build connection.

## ROLLBACK — if live API fails

**Preferred:** In Cloudflare Workers & Pages > `xtech-api` > Deployments, choose a previously **known-working** version, then **Rollback**. CLI alternative:

```powershell
npx wrangler rollback --name xtech-api
```

Rollback to the old Container version is **not guaranteed** if the earlier Durable Object/Container assignment was already broken or changed. Cloudflare may also block rollbacks across Durable Object class lifecycle changes. We deliberately retained both legacy exports to reduce this risk.

**Alternative:** Keep the old code/config in Git. The archive has `wrangler.container.rollback.jsonc`, which can be used for a best-effort rebuild if you still have a valid Container entitlement and namespace:

```powershell
.\scripts\rollback-container.ps1
```

After a rollback, temporarily disable GitHub auto-deploy or the next `main` build may reactivate the direct Worker. Restore the old config in Git if you intend a permanent rollback.

## LATER — cleanup

Only after a sustained healthy production period, consider deleting unused Container applications and legacy Durable Object classes. Deleting Durable Object classes permanently deletes their stored data and can affect rollback; do not delete them during cutover.
