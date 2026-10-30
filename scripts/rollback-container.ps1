$ErrorActionPreference = "Stop"
# Best-effort rollback to the prior Container-based setup.
# DO NOT use if Cloudflare says a required Container/DO namespace was deleted.
if (-not (Test-Path ".\wrangler.container.rollback.jsonc") -or -not (Test-Path ".\src\index.js")) {
  throw "Missing old Container config or src/index.js; cannot attempt rollback."
}
Write-Host "This will rebuild the OLD Container Worker. It may fail if its namespace/app is broken." -ForegroundColor Yellow
Write-Host "Cloudflare Deployments > Rollback may be preferable if the prior version is healthy." -ForegroundColor Yellow
npx wrangler deploy --config wrangler.container.rollback.jsonc --secrets-file .env
if ($LASTEXITCODE -ne 0) { throw "Container rollback deployment failed. Check Cloudflare Logs and previous Worker versions." }
