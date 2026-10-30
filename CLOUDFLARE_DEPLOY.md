# XTECH Automation — Cloudflare Workers migration

This patch removes the Render hosting dependency while keeping the existing XTECH frontend, Express API routes, Firebase Authentication, Firestore data, Resend email OTP, and Gemini assistant.

## Important architecture note

Cloudflare Workers can run Express with current Node.js compatibility. The official Firebase Admin Firestore client still relies on Node gRPC internally, so this patch uses `@ljoukov/firebase-admin-cloudflare` for Firestore CRUD, queries, batches, and transactions. Firebase Authentication remains on the official `firebase-admin` Auth API.

Do not delete your Render service until the Cloudflare deployment has passed all production tests.

## 1. Copy this patch into your repository

Copy the patch contents into your existing repository root and replace matching files.

Your repository should contain:

- `backend/server.js`
- `backend/firebase.js`
- `worker/index.mjs`
- `wrangler.jsonc`
- `.dev.vars.example`
- `package.json`

Keep your current `frontend/` directory. The patch intentionally does not replace your current frontend so your favicon, mobile layout changes, and recent UI work remain intact.

## 2. Install dependencies

Run from the repository root:

```powershell
npm.cmd install
```

This updates `package-lock.json` and installs Wrangler plus the Worker-compatible Firestore package.

Then run:

```powershell
npm.cmd test
node --check .\backend\server.js
node --check .\backend\firebase.js
node --check .\worker\index.mjs
```

## 3. Log in to Cloudflare

```powershell
npx.cmd wrangler login
npx.cmd wrangler whoami
```

A browser window will ask you to authorize Wrangler.

## 4. Configure Cloudflare Worker variables and secrets

In Cloudflare Dashboard:

Workers & Pages → Create application → Worker

Create the Worker with this exact name:

`xtech-automation`

The Worker name must match the `name` in `wrangler.jsonc`.

### Plain variables

Add these under Settings → Variables and Secrets as normal text variables:

- `APP_URL` = `https://xtech-automation.com`
- `FIREBASE_API_KEY` = your Firebase web API key
- `FIREBASE_AUTH_DOMAIN` = `xtech-automation.firebaseapp.com`
- `FIREBASE_PROJECT_ID` = `xtech-automation`
- `FIREBASE_STORAGE_BUCKET` = `xtech-automation.firebasestorage.app`
- `FIREBASE_MESSAGING_SENDER_ID` = your existing Firebase sender ID
- `FIREBASE_APP_ID` = your existing Firebase app ID
- `MAIL_FROM` = `XTECH Automation <no-reply@xtech-automation.com>`
- `EMAIL_OTP_EXPIRY_MINUTES` = `10`
- `EMAIL_OTP_RESEND_SECONDS` = `60`
- `ADMIN_EMAIL` = `admin@xtech-automation.com`
- `ADMIN_MFA_BYPASS` = `true` only while you intentionally want the temporary demo bypass

`CLOUDFLARE_WORKER=true` already exists in `wrangler.jsonc`.

### Secrets

Add these as Secret values, not plain variables:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`

For `GOOGLE_SERVICE_ACCOUNT_JSON`, paste the entire contents of your Firebase service account JSON file. Do not upload the JSON file to GitHub.

You can also create secrets with Wrangler:

```powershell
npx.cmd wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx.cmd wrangler secret put GEMINI_API_KEY
npx.cmd wrangler secret put RESEND_API_KEY
```

## 5. First deployment

From the repository root:

```powershell
npx.cmd wrangler deploy
```

Wrangler will deploy both the API Worker and your `frontend/` static assets.

Test the generated `workers.dev` URL before changing DNS.

Test at minimum:

- `/api/status`
- login
- inventory list
- stock in/out
- customer list
- pickup create/status update
- sales
- reports
- Email OTP
- Gemini assistant

## 6. Move xtech-automation.com from Render to the Worker

Only do this after the `workers.dev` deployment works.

Cloudflare Dashboard → Workers & Pages → `xtech-automation` → Settings → Domains & Routes → Add → Custom Domain

Add:

`xtech-automation.com`

If Cloudflare says the hostname already has a conflicting CNAME/A record, remove only the old Render web-hosting DNS record for the root hostname. Do not delete your Cloudflare Email Routing MX records or Resend TXT/DKIM records.

Cloudflare will create the Worker DNS record and TLS certificate automatically.

## 7. Firebase authorized domains

In Firebase Console:

Authentication → Settings → Authorized domains

Keep/add:

- `xtech-automation.com`
- your temporary `workers.dev` hostname while testing

After the final domain is stable, the temporary hostname can be removed if you no longer need it.

## 8. Connect GitHub for automatic Cloudflare deployments

Cloudflare Dashboard → Workers & Pages → `xtech-automation` → Settings → Builds → Connect

Choose GitHub and select:

`ephiciel/xtech-automation-alpha`

Production branch: `main`

Cloudflare can then deploy automatically whenever you push to `main`.

## 9. Push the migration to GitHub

```powershell
git status
git add .
git commit -m "Migrate XTECH hosting to Cloudflare Workers"
git push
```

Before committing, confirm that `.env`, `.dev.vars`, and `backend/serviceAccountKey.json` are not staged.

## 10. Remove Render only after validation

When `https://xtech-automation.com` is confirmed working through Cloudflare, you can disconnect/delete the Render service. Until then, keep Render as rollback protection.
