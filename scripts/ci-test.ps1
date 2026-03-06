# CI Test Runner — spins up TSDB + Qdrant, runs full test suite, tears down.
# Usage: pwsh scripts/ci-test.ps1
# Exit code 0 = all tests pass. Non-zero = failure.

param(
    [switch]$SkipPartB,
    [switch]$KeepContainers
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Agent Coordinator — CI Test Run    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan

# ── Step 1: Run Part A tests (no external deps) ────────────────────────

Write-Host "`n▶ Part A: Unit + Integration tests (no external deps)..." -ForegroundColor Yellow

Push-Location "$Root\src\mcp-server"
try {
    npx vitest run --test-timeout=5000 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Part A failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Part A passed.`n" -ForegroundColor Green
}
finally {
    Pop-Location
}

if ($SkipPartB) {
    Write-Host "⏭ Skipping Part B (--SkipPartB flag set)." -ForegroundColor DarkYellow
    exit 0
}

# ── Step 2: Start test containers ───────────────────────────────────────

Write-Host "▶ Starting TimescaleDB + Qdrant containers..." -ForegroundColor Yellow

docker compose -f "$Root\docker-compose.test.yml" up -d --wait 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to start containers. Is Docker running?" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Containers healthy.`n" -ForegroundColor Green

# ── Step 3: Run Part B tests (with live backends) ──────────────────────

Write-Host "▶ Part B: Integration tests with live TSDB + Qdrant..." -ForegroundColor Yellow

$env:TSDB_URL = "postgresql://coordinator:ci_test@localhost:5444/telemetry"
$env:QDRANT_URL = "http://localhost:6335"

Push-Location "$Root\src\mcp-server"
try {
    npx vitest run --test-timeout=10000 2>&1
    $testExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
    Remove-Item Env:\TSDB_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\QDRANT_URL -ErrorAction SilentlyContinue
}

# ── Step 4: Tear down ──────────────────────────────────────────────────

if (-not $KeepContainers) {
    Write-Host "`n▶ Tearing down containers..." -ForegroundColor Yellow
    docker compose -f "$Root\docker-compose.test.yml" down -v 2>&1
}

if ($testExitCode -ne 0) {
    Write-Host "`n✗ Part B failed." -ForegroundColor Red
    exit 1
}

Write-Host "`n✓ All tests passed (Part A + Part B).`n" -ForegroundColor Green
exit 0
