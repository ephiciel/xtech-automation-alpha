$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\wrangler.jsonc") -or -not (Test-Path ".\worker\production.mjs")) {
    throw "Run this script from the ROOT of the XTECH repository after extracting this ZIP."
}

if (-not (Test-Path ".\src\index.js") -or -not (Test-Path ".\wrangler.container.rollback.jsonc")) {
    throw "Rollback files are missing. Refusing production cutover."
}

Write-Host "Validating XTECH direct Worker..." -ForegroundColor Cyan
node --check .\worker\direct.mjs
if ($LASTEXITCODE -ne 0) { throw "Direct Worker syntax check failed." }
node --check .\worker\production.mjs
if ($LASTEXITCODE -ne 0) { throw "Production Worker syntax check failed." }
node --check .\backend\server.js
if ($LASTEXITCODE -ne 0) { throw "Backend syntax check failed." }

npx wrangler deploy --config wrangler.jsonc --dry-run
if ($LASTEXITCODE -ne 0) { throw "Wrangler dry run failed. No deployment performed." }

Write-Host "Preparing temporary secret bundle outside GitHub..." -ForegroundColor Cyan
$tempFile = & node .\scripts\create-cutover-secrets.cjs
if ($LASTEXITCODE -ne 0 -or -not $tempFile -or -not (Test-Path $tempFile)) {
    throw "Missing production secrets. The deployment has NOT started."
}
try {
    Write-Host "Deploying direct API to xtech-api (current /api/* route)..." -ForegroundColor Cyan
    npx wrangler deploy --config wrangler.jsonc --secrets-file $tempFile
    if ($LASTEXITCODE -ne 0) { throw "Wrangler deployment failed. Inspect the error before retrying." }
} finally {
    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Deployment command succeeded. Verify /api/status, login and pickup on the LIVE domain BEFORE pushing GitHub." -ForegroundColor Green
