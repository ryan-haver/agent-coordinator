<#
.SYNOPSIS
    Uninstall Model Tag Team from your Antigravity environment.
.DESCRIPTION
    Removes all Tag Team files from deployment locations.
    Does NOT delete the source project — only the deployed copies.
.NOTES
    Run from the model-tag-team directory: .\uninstall.ps1
#>

$ErrorActionPreference = "Stop"
$home_ = $env:USERPROFILE

Write-Host "🏷️  Model Tag Team — Uninstalling..." -ForegroundColor Cyan
Write-Host ""

# 1. GEMINI.md — clear contents (don't delete, it may have other content)
$gemini = Join-Path $home_ ".gemini\GEMINI.md"
if (Test-Path $gemini) {
    Set-Content $gemini ""
    Write-Host "  ✅ Cleared GEMINI.md" -ForegroundColor Green
}

# 2. Skill
$skillDir = Join-Path $home_ ".gemini\antigravity\skills\smart-handoff"
if (Test-Path $skillDir) {
    Remove-Item $skillDir -Recurse -Force
    Write-Host "  ✅ Removed smart-handoff skill" -ForegroundColor Green
}

# 3. Workflows
$wfDir = Join-Path $home_ ".gemini\antigravity\.agent\workflows"
foreach ($wf in @("pivot.md", "resume.md", "health.md")) {
    $p = Join-Path $wfDir $wf
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "  ✅ Removed $wf" -ForegroundColor Green }
}

# 4. Rules junction
$junctionPath = Join-Path $home_ ".gemini\antigravity\rules"
if (Test-Path $junctionPath) {
    cmd /c rmdir "$junctionPath" 2>$null  # rmdir removes junctions without deleting contents
    Write-Host "  ✅ Removed rules junction" -ForegroundColor Green
}

# 5. Config directory (optional — prompt)
$cfgDir = Join-Path $home_ ".antigravity-configs"
if (Test-Path $cfgDir) {
    $answer = Read-Host "  Remove ~/.antigravity-configs/ entirely? (y/N)"
    if ($answer -eq "y") {
        Remove-Item $cfgDir -Recurse -Force
        Write-Host "  ✅ Removed ~/.antigravity-configs/" -ForegroundColor Green
    }
    else {
        Write-Host "  ℹ️  Kept ~/.antigravity-configs/" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🏷️  Model Tag Team uninstalled." -ForegroundColor Cyan
Write-Host "  Note: Global gitignore at ~/.config/git/ignore was left intact." -ForegroundColor Gray
