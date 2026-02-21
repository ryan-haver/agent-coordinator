<#
.SYNOPSIS
    Toggles Antigravity settings for autonomous swarm operation.
.DESCRIPTION
    By default, backs up the current settings.json and injects autonomous overrides 
    (autoRunCommands, allowInBackground, autoApproveEdits).
    If -Restore is passed, it restores the original settings from the backup.
#>

param(
    [switch]$Restore
)

$ErrorActionPreference = "Stop"
$home_ = $env:USERPROFILE
$settingsPath = Join-Path $env:APPDATA "Antigravity\User\settings.json"
$backupPath = Join-Path $home_ ".antigravity-configs\settings_backup.json"

# Check if the path differs slightly (e.g. VS Code vs Antigravity)
if (-not (Test-Path $settingsPath)) {
    # Fallback to standard VS Code path if Antigravity path isn't found
    $settingsPath = Join-Path $env:APPDATA "Code\User\settings.json"
}

if (-not (Test-Path $settingsPath)) {
    Write-Warning "Could not find Antigravity or VS Code settings.json"
    exit 1
}

function Read-Settings {
    param([string]$Path)
    if ((Get-Item $Path).Length -gt 0) {
        return (Get-Content $Path -Raw | ConvertFrom-Json -AsHashtable)
    }
    return @{}
}

function Write-Settings {
    param([hashtable]$Data, [string]$Path)
    $Data | ConvertTo-Json -Depth 5 | Set-Content $Path
}

if ($Restore) {
    if (Test-Path $backupPath) {
        Write-Host "Restoring original Antigravity settings..." -ForegroundColor Cyan
        Copy-Item $backupPath $settingsPath -Force
        Remove-Item $backupPath -Force
        Write-Host "Settings restored successfully." -ForegroundColor Green
    }
    else {
        Write-Host "No settings backup found. Nothing to restore." -ForegroundColor Yellow
    }
}
else {
    Write-Host "Enabling Autonomous Mode..." -ForegroundColor Cyan
    
    # 1. Backup if one doesn't already exist (prevent original backup overwrite)
    if (-not (Test-Path $backupPath)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $backupPath) | Out-Null
        Copy-Item $settingsPath $backupPath -Force
        Write-Host "Settings backed up to $backupPath" -ForegroundColor Green
    }

    # 2. Inject autonomous overrides
    $settings = Read-Settings $settingsPath
    
    # These keys map to the Agent Extension settings
    $settings["cascade.autoRunCommands"] = $true
    $settings["cascade.allowInBackground"] = $true
    $settings["cascade.autoApproveEdits"] = $true
    
    Write-Settings $settings $settingsPath
    Write-Host "Autonomous settings injected into settings.json" -ForegroundColor Green
}
