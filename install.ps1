<#
.SYNOPSIS
    Install or reinstall Agent Coordinator into your Antigravity environment.
.DESCRIPTION
    Copies all Agent Coordination files to their correct deployment locations:
    - GEMINI.md -> ~/.gemini/GEMINI.md
    - SKILL.md -> ~/.gemini/antigravity/skills/agent-coordination/SKILL.md
    - Workflows -> ~/.gemini/antigravity/.agent/workflows/
    - Templates -> ~/.antigravity-configs/templates/
    - Agent prompts -> ~/.antigravity-configs/templates/agent-prompts/
    - Configs -> ~/.antigravity-configs/
    - Global gitignore -> ~/.config/git/ignore
.NOTES
    Safe to re-run. Uses -Force to overwrite existing files.
    Run from the agent-coordinator directory: .\install.ps1
    Use -Force to update GEMINI.md and gitignore even if already present.
#>

param(
    [switch]$Force,
    [switch]$Help
)

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    return
}

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$src = Join-Path $root "src"
$home_ = $env:USERPROFILE

Write-Host "[Agent Coordinator] Installing..." -ForegroundColor Cyan
Write-Host ""

# 0. Clean up old skill directory (smart-handoff -> agent-coordination)
$oldSkill = Join-Path $home_ ".gemini\antigravity\skills\smart-handoff"
if (Test-Path $oldSkill) {
    Remove-Item $oldSkill -Recurse -Force
    Write-Host "  Removed old skill directory: smart-handoff" -ForegroundColor Yellow
}

# 1. GEMINI.md (merge-safe: append if existing, never overwrite user content)
$geminiSrc = Join-Path $src "GEMINI.md"
$geminiDst = Join-Path $home_ ".gemini\GEMINI.md"
New-Item -ItemType Directory -Force -Path (Split-Path $geminiDst) | Out-Null
if (Test-Path $geminiDst) {
    $existing = Get-Content $geminiDst -Raw -ErrorAction SilentlyContinue
    if ($existing -and ($existing -match "Agent Coordination" -or $existing -match "Smart Handoff")) {
        if ($Force) {
            $cleaned = $existing -replace '(?ms)\r?\n?# (Agent Coordination System|Agent Coordinator|Global Smart Handoff).*?(?=\r?\n# [^#]|\z)', ''
            $cleaned = $cleaned.Trim()
            $coordContent = Get-Content $geminiSrc -Raw
            if ($cleaned) { Set-Content $geminiDst "$cleaned`n`n$coordContent" } else { Set-Content $geminiDst $coordContent }
            Write-Host "  Layer 1: GEMINI.md - updated coordination instructions (--force)" -ForegroundColor Green
        }
        else {
            Write-Host "  Layer 1: GEMINI.md already contains coordination instructions - skipped (use -Force to update)" -ForegroundColor Yellow
        }
    }
    else {
        $coordContent = Get-Content $geminiSrc -Raw
        Add-Content $geminiDst "`n$coordContent"
        Write-Host "  Layer 1: GEMINI.md - appended coordination instructions" -ForegroundColor Green
    }
}
else {
    Copy-Item $geminiSrc $geminiDst -Force
    Write-Host "  Layer 1: GEMINI.md -> $geminiDst" -ForegroundColor Green
}

# 2. Skill (agent-coordination)
$skillSrc = Join-Path $src "skill\SKILL.md"
$skillDst = Join-Path $home_ ".gemini\antigravity\skills\agent-coordination\SKILL.md"
New-Item -ItemType Directory -Force -Path (Split-Path $skillDst) | Out-Null
Copy-Item $skillSrc $skillDst -Force
Write-Host "  Layer 2: SKILL.md -> $skillDst" -ForegroundColor Green

# 3. Workflows (handoff + swarm)
$wfDst = Join-Path $home_ ".gemini\antigravity\.agent\workflows"
New-Item -ItemType Directory -Force -Path $wfDst | Out-Null
foreach ($wf in @("pivot.md", "resume.md", "health.md", "swarm.md", "swarm-auto.md")) {
    $wfSrc = Join-Path $src "workflows\$wf"
    if (Test-Path $wfSrc) {
        Copy-Item $wfSrc (Join-Path $wfDst $wf) -Force
        Write-Host "  Workflow: $wf" -ForegroundColor Green
    }
    else {
        Write-Host "  Workflow not found: $wf" -ForegroundColor Yellow
    }
}

# 4. Configs
$cfgDst = Join-Path $home_ ".antigravity-configs"
New-Item -ItemType Directory -Force -Path "$cfgDst\rules", "$cfgDst\templates\agent-prompts" | Out-Null

Copy-Item (Join-Path $src "model_fallback.json") "$cfgDst\model_fallback.json" -Force
Write-Host "  Config: model_fallback.json" -ForegroundColor Green

# Templates (handoff + swarm manifests + spec)
foreach ($tmpl in @("handoff_manifest.md", "swarm-manifest.md", "spec.md")) {
    $tmplSrc = Join-Path $src "templates\$tmpl"
    if (Test-Path $tmplSrc) {
        Copy-Item $tmplSrc "$cfgDst\templates\$tmpl" -Force
        Write-Host "  Template: $tmpl" -ForegroundColor Green
    }
}

# Agent prompts (all 9)
$promptSrc = Join-Path $src "templates\agent-prompts"
if (Test-Path $promptSrc) {
    $prompts = Get-ChildItem $promptSrc -Filter "*.md"
    foreach ($p in $prompts) {
        Copy-Item $p.FullName "$cfgDst\templates\agent-prompts\$($p.Name)" -Force
    }
    Write-Host "  Agent prompts: $($prompts.Count) templates deployed" -ForegroundColor Green
}

# Rules
foreach ($rule in @("handoff.md", "context_compression.md")) {
    Copy-Item (Join-Path $src "rules\$rule") "$cfgDst\rules\$rule" -Force
    Write-Host "  Rule: $rule" -ForegroundColor Green
}

# 5. Rules junction
$junctionPath = Join-Path $home_ ".gemini\antigravity\rules"
if (-not (Test-Path $junctionPath)) {
    cmd /c mklink /J "$junctionPath" "$cfgDst\rules" | Out-Null
    Write-Host "  Junction: rules -> $cfgDst\rules" -ForegroundColor Green
}
else {
    Write-Host "  Junction already exists: $junctionPath" -ForegroundColor Yellow
}

# 6. Global gitignore (merge-safe: append if existing, never overwrite user entries)
$giDst = Join-Path $home_ ".config\git\ignore"
New-Item -ItemType Directory -Force -Path (Split-Path $giDst) | Out-Null
if (Test-Path $giDst) {
    $existing = Get-Content $giDst -Raw -ErrorAction SilentlyContinue
    if ($existing -and ($existing -match "Agent Coordination" -or $existing -match "Smart Handoff")) {
        if ($Force) {
            $cleaned = $existing -replace '(?ms)\r?\n?# (Agent Coordinator|Agent Coordination|Smart Handoff).*?(?=\r?\n# [^#]|\z)', ''
            $cleaned = $cleaned.Trim()
            $ignoreContent = Get-Content (Join-Path $src "gitignore-global") -Raw
            if ($cleaned) { Set-Content $giDst "$cleaned`n`n$ignoreContent" } else { Set-Content $giDst $ignoreContent }
            Write-Host "  Global gitignore - updated coordination entries (--force)" -ForegroundColor Green
        }
        else {
            Write-Host "  Global gitignore already contains coordination entries - skipped (use -Force to update)" -ForegroundColor Yellow
        }
    }
    else {
        $ignoreContent = Get-Content (Join-Path $src "gitignore-global") -Raw
        Add-Content $giDst "`n$ignoreContent"
        Write-Host "  Global gitignore - appended coordination entries" -ForegroundColor Green
    }
}
else {
    Copy-Item (Join-Path $src "gitignore-global") $giDst -Force
    Write-Host "  Global gitignore configured" -ForegroundColor Green
}
git config --global core.excludesfile $giDst

Write-Host ""
Write-Host "Agent Coordinator installed successfully!" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Commands available:" -ForegroundColor White
Write-Host "    /pivot      - Generate handoff manifest and switch models" -ForegroundColor Gray
Write-Host "    /resume     - Pick up from active manifest" -ForegroundColor Gray
Write-Host "    /swarm      - Decompose task into multi-agent swarm" -ForegroundColor Gray
Write-Host "    /swarm-auto - Rapid swarm with all prompts upfront" -ForegroundColor Gray
Write-Host "    /health     - Audit system status" -ForegroundColor Gray
Write-Host ""
Write-Host "  Run /health in your next Antigravity session to verify." -ForegroundColor White
