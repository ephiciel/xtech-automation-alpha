# XTECH Automation — Combined Stage 4.45–4.50 release-candidate checklist

> This consolidation is a **code-quality release candidate**, not automatic production approval.
> The installer is non-deploying, does not contact Firebase and does not change production data.

## Combined scope

| Stage | Delivered in this branch | Sign-off needed |
| --- | --- | --- |
| 4.45 | Shared toast/form-message/busy-button implementation in `ui-feedback.js`; existing callers keep explicit dependencies | Check all relevant forms and toast behavior in browser |
| 4.46 | Classifies transport failures as `NETWORK_ERROR` / status `0`, preserving original error text; no automatic retries for write operations | Verify offline/reconnect and expired-token behavior |
| 4.47 | Read-only security audit: tracked credentials, Firebase token revocation/role checks, client token wiring | Human threat-model review, Firebase rules review, scan third-party dependencies |
| 4.48 | Cross-module regression tests and existing unit/integration suites | Browser end-to-end acceptance by role and real backend |
| 4.49 | Accessible status announcements and resource preconnect hints; automated checks | Keyboard, zoom, screen reader, mobile, and performance measurements |
| 4.50 | CI release audit and documented release/rollback checklist | Sign-off before code freeze or deployment |

## Required manual acceptance matrix — isolated staging/test accounts only

- [ ] **Admin:** password + TOTP sign-in; dashboard, inventory, stock in/out, audit trails, staff permissions, report export, logout/re-login.
- [ ] **Secretary:** access customers, sales, pickups; restricted inventory and reports remain inaccessible.
- [ ] **Warehouse:** inventory and stock workflows; customer, sales, and reports restrictions remain effective.
- [ ] **Customer:** registration and verified email code; own pickup requests/history and notifications; no other customer's records.
- [ ] **MFA:** enrollment, invalid OTP, resend cooldown, expired OTP, cancelled TOTP, password reset, and logout while challenged.
- [ ] **Stock transaction:** reject negative stock, archived product, duplicate IDs; assert audit and notification integrity.
- [ ] **Connectivity:** simulate offline, timeouts, 401/403/429/500 responses; ensure no duplicate sale/pickup on retry.
- [ ] **Browser and device:** Edge/Chrome, mobile viewport, keyboard-only navigation, 200% zoom, focus order, accessible status announcements.
- [ ] **Performance:** record mobile/desktop Lighthouse or browser performance measurements; examine third-party CDN latency and startup requests.
- [ ] **Security:** verify Firestore security rules, role-enforced API routes, Cloudflare secrets, rate limiting, CORS, logs, and dependencies.
- [ ] **Cloudflare:** validate Workers build and deployment in staging, `/api/status`, `/api/config` without secret exposure, domain API routing and rollback.
- [ ] **Client acceptance:** AGB XTECH reviews and accepts inventory, pickup, and sales workflows.

## Release and rollback procedure

1. Keep production unchanged until feature-branch CI is green and the manual matrix is signed off.
2. Review the single PR as a combined change. Do **not** merge merely because local tests pass.
3. Record known issues, exact commit SHA, staging test evidence, and the last known good deployment/commit.
4. If approval is granted, merge manually and confirm post-merge CI. Deploy through the existing approved Cloudflare workflow only.
5. If deployed behavior regresses, roll back through the saved Cloudflare deployment version and/or the previous verified Git commit. Confirm `/api/status`, login, and inventory after rollback.
6. Do not delete Firebase records or secrets as part of rollback. Any schema/data migration needs an independent backup/rollback plan.

## Automated evidence to attach to PR

- `npm run lint -- --max-warnings 0`
- Prettier checks on changed/new JavaScript
- `npm test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:staging-isolation`
- `npm run test:staging-preflight`
- `npm run test:release-audit`
- `git diff --check`

**Release verdict:** Pending manual review and staging/browser evidence. This document is intentionally not a pass certificate.
