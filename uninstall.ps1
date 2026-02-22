<#
.SYNOPSIS
    Uninstall Agent Coordinator from your Antigravity environment.
.DESCRIPTION
    Removes all Agent Coordination files from deployment locations.
    Does NOT delete the source project — only the deployed copies.
.NOTES
    Run from the agent-coordinator directory: .\uninstall.ps1
#>

param()
$ErrorActionPreference = "Stop"
$home_ = $env:USERPROFILE

Write-Host "🏷️  Agent Coordinator — Uninstalling..." -ForegroundColor Cyan
Write-Host ""

# 1. GEMINI.md — remove the coordination block, preserve other content
$gemini = Join-Path $home_ ".gemini\GEMINI.md"
if (Test-Path $gemini) {
    $content = Get-Content $gemini -Raw -ErrorAction SilentlyContinue
    if ($content -and ($content -match "Agent Coordination" -or $content -match "Smart Handoff")) {
        # Remove coordination block (either old or new naming)
        $cleaned = $content -replace '(?ms)\r?\n?# (Agent Coordination System|Agent Coordinator|Global Smart Handoff).*?(?=\r?\n# [^#]|\z)', ''
        $cleaned = $cleaned.Trim()
        if ($cleaned) { Set-Content $gemini $cleaned } else { Set-Content $gemini "" }
        Write-Host "  ✅ Removed coordination block from GEMINI.md" -ForegroundColor Green
    }
    else {
        Write-Host "  ℹ️  GEMINI.md has no coordination content — skipped" -ForegroundColor Yellow
    }
}

# 2. Skill (both old and new names)
foreach ($name in @("agent-coordination", "smart-handoff")) {
    $skillDir = Join-Path $home_ ".gemini\antigravity\skills\$name"
    if (Test-Path $skillDir) {
        Remove-Item $skillDir -Recurse -Force
        Write-Host "  ✅ Removed $name skill" -ForegroundColor Green
    }
}

# 3. Workflows
$wfDir = Join-Path $home_ ".gemini\antigravity\.agent\workflows"
foreach ($wf in @("pivot.md", "resume.md", "health.md", "swarm.md", "swarm-auto.md", "consult.md", "status.md")) {
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

# 6. MCP Server deregistration
$mcpConfigFile = Join-Path $home_ ".gemini\antigravity\mcp_config.json"
if (Test-Path $mcpConfigFile) {
    try {
        $mcpConfig = Get-Content $mcpConfigFile -Raw | ConvertFrom-Json
        if ($mcpConfig.mcpServers."agent-coordinator") {
            $mcpConfig.mcpServers.PSObject.Properties.Remove("agent-coordinator")
            $mcpConfig | ConvertTo-Json -Depth 5 | Set-Content $mcpConfigFile
            Write-Host "  ✅ Removed agent-coordinator from mcp_config.json" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ⚠️ Could not clean mcp_config.json: $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🏷️  Agent Coordinator uninstalled." -ForegroundColor Cyan
Write-Host "  Note: Global gitignore at ~/.config/git/ignore was left intact." -ForegroundColor Gray
