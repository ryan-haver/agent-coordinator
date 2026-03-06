#!/usr/bin/env pwsh
# Integration Gate Script — Agent Coordinator
# Usage: pwsh scripts/integration-gate.ps1
# Exit 0 = all green. Exit 1 = failure (milestone is NOT closed).

param(
    [switch]$SkipTsdb  # Skip TSDB Part B tests even if TSDB_URL is set
)

$ErrorActionPreference = "Stop"
$Root = "$PSScriptRoot\..\src\mcp-server"
$Failed = $false

function Write-Banner([string]$text) {
    Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Pass([string]$msg) { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "  ❌ $msg" -ForegroundColor Red; $script:Failed = $true }

# ── Step 1: TypeScript check ──────────────────────────────────────────
Write-Banner "Step 1: TypeScript (tsc --noEmit)"
Push-Location $Root
try {
    npx tsc --noEmit 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Pass "tsc --noEmit passed" }
    else { Write-Fail "tsc --noEmit FAILED" }
}
catch { Write-Fail "tsc exception: $_" }

try {
    npx tsc -p tsconfig.test.json --noEmit 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Pass "tsc -p tsconfig.test.json passed" }
    else { Write-Fail "tsconfig.test.json FAILED" }
}
catch { Write-Fail "tsc test exception: $_" }

# ── Step 2: Unit tests ────────────────────────────────────────────────
Write-Banner "Step 2: Unit Tests (npm test)"
try {
    $unitOutput = npm test 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        $passLine = ($unitOutput -split "`n" | Select-String "Tests\s+\d+ passed").ToString()
        Write-Pass "Unit tests passed — $passLine"
    }
    else {
        Write-Fail "Unit tests FAILED"
        Write-Host $unitOutput -ForegroundColor Red
    }
}
catch { Write-Fail "Unit test exception: $_" }

# ── Step 3: Integration tests ─────────────────────────────────────────
Write-Banner "Step 3: Integration Tests (npm run test:integration)"
$env_backup = $env:TSDB_URL
if ($SkipTsdb) { $env:TSDB_URL = "" }
try {
    $intOutput = npm run test:integration 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        $passLine = ($intOutput -split "`n" | Select-String "Tests\s+\d+").ToString()
        Write-Pass "Integration tests passed — $passLine"
    }
    else {
        Write-Fail "Integration tests FAILED"
        Write-Host ($intOutput -split "`n" | Select-String "×|FAIL|Error" | Select-Object -First 10) -ForegroundColor Red
    }
}
catch { Write-Fail "Integration test exception: $_" }
finally { $env:TSDB_URL = $env_backup }

Pop-Location

# ── Summary ───────────────────────────────────────────────────────────
Write-Banner "Gate Result"
if ($Failed) {
    Write-Host "  ❌ GATE FAILED — milestone is NOT closed" -ForegroundColor Red
    Write-Host "     Fix all failures before marking the milestone complete." -ForegroundColor Yellow
    exit 1
}
else {
    Write-Host "  ✅ ALL GATES PASSED — milestone may be closed" -ForegroundColor Green
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "     Gated at: $timestamp" -ForegroundColor Gray
    exit 0
}
