<#
.SYNOPSIS
    Install or reinstall Model Tag Team into your Antigravity environment.
.DESCRIPTION
    Copies all Tag Team files to their correct deployment locations:
    - GEMINI.md → ~/.gemini/GEMINI.md
    - SKILL.md → ~/.gemini/antigravity/skills/smart-handoff/SKILL.md
    - Workflows → ~/.gemini/antigravity/.agent/workflows/
    - Configs → ~/.antigravity-configs/
    - Global gitignore → ~/.config/git/ignore
.NOTES
    Safe to re-run — uses -Force to overwrite existing files.
    Run from the model-tag-team directory: .\install.ps1
#>

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$src = Join-Path $root "src"
$home_ = $env:USERPROFILE

Write-Host "🏷️  Model Tag Team — Installing..." -ForegroundColor Cyan
Write-Host ""

# 1. GEMINI.md
$geminiSrc = Join-Path $src "GEMINI.md"
$geminiDst = Join-Path $home_ ".gemini\GEMINI.md"
Copy-Item $geminiSrc $geminiDst -Force
Write-Host "  ✅ Layer 1: GEMINI.md → $geminiDst" -ForegroundColor Green

# 2. Skill
$skillSrc = Join-Path $src "skill\SKILL.md"
$skillDst = Join-Path $home_ ".gemini\antigravity\skills\smart-handoff\SKILL.md"
New-Item -ItemType Directory -Force -Path (Split-Path $skillDst) | Out-Null
Copy-Item $skillSrc $skillDst -Force
Write-Host "  ✅ Layer 2: SKILL.md → $skillDst" -ForegroundColor Green

# 3. Workflows
$wfDst = Join-Path $home_ ".gemini\antigravity\.agent\workflows"
New-Item -ItemType Directory -Force -Path $wfDst | Out-Null
foreach ($wf in @("pivot.md", "resume.md", "health.md")) {
    Copy-Item (Join-Path $src "workflows\$wf") (Join-Path $wfDst $wf) -Force
    Write-Host "  ✅ Workflow: $wf → $wfDst\$wf" -ForegroundColor Green
}

# 4. Configs
$cfgDst = Join-Path $home_ ".antigravity-configs"
New-Item -ItemType Directory -Force -Path "$cfgDst\rules", "$cfgDst\templates", "$cfgDst\workflows" | Out-Null

Copy-Item (Join-Path $src "model_fallback.json") "$cfgDst\model_fallback.json" -Force
Write-Host "  ✅ Config: model_fallback.json" -ForegroundColor Green

Copy-Item (Join-Path $src "templates\handoff_manifest.md") "$cfgDst\templates\handoff_manifest.md" -Force
Write-Host "  ✅ Template: handoff_manifest.md" -ForegroundColor Green

foreach ($rule in @("handoff.md", "context_compression.md")) {
    Copy-Item (Join-Path $src "rules\$rule") "$cfgDst\rules\$rule" -Force
    Write-Host "  ✅ Rule: $rule" -ForegroundColor Green
}

foreach ($wf in @("pivot.md", "resume.md")) {
    Copy-Item (Join-Path $src "workflows\$wf") "$cfgDst\workflows\$wf" -Force
}

# 5. Rules junction
$junctionPath = Join-Path $home_ ".gemini\antigravity\rules"
if (-not (Test-Path $junctionPath)) {
    cmd /c mklink /J "$junctionPath" "$cfgDst\rules" | Out-Null
    Write-Host "  ✅ Junction: rules → $cfgDst\rules" -ForegroundColor Green
} else {
    Write-Host "  ℹ️  Junction already exists: $junctionPath" -ForegroundColor Yellow
}

# 6. Global gitignore
$giDst = Join-Path $home_ ".config\git\ignore"
New-Item -ItemType Directory -Force -Path (Split-Path $giDst) | Out-Null
Copy-Item (Join-Path $src "gitignore-global") $giDst -Force
git config --global core.excludesfile $giDst
Write-Host "  ✅ Global gitignore configured" -ForegroundColor Green

Write-Host ""
Write-Host "🏷️  Model Tag Team installed successfully!" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Commands available:" -ForegroundColor White
Write-Host "    /pivot   — Generate handoff manifest and switch models" -ForegroundColor Gray
Write-Host "    /resume  — Pick up from active manifest" -ForegroundColor Gray
Write-Host "    /health  — Audit system status" -ForegroundColor Gray
Write-Host ""
Write-Host "  Run /health in your next Antigravity session to verify." -ForegroundColor White
