#!/usr/bin/env pwsh
# quota_check.ps1
# Reverse-engineered from the Antigravity Cockpit extension (jlcodes99/vscode-antigravity-cockpit).
# Locates the language_server_windows_x64.exe process, extracts CSRF token and listening port,
# then hits the GetUserStatus API over HTTPS to dump quota data to quota_snapshot.json.

$ErrorActionPreference = "Stop"

Write-Host "🔍 Scanning for Antigravity Language Server..."

# Step 1: Find the language server process via WMI (same approach as Cockpit's WindowsStrategy)
$lsProcesses = Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'" | Select-Object ProcessId, CommandLine

if (-not $lsProcesses) {
    Write-Warning "❌ language_server_windows_x64.exe not found. Ensure Antigravity is running."
    exit 1
}

# Normalize to array
if ($lsProcesses -isnot [System.Array]) {
    $lsProcesses = @($lsProcesses)
}

# Step 2: Find the Antigravity process (must have --csrf_token AND --app_data_dir antigravity)
$targetProcess = $null
foreach ($proc in $lsProcesses) {
    $cmd = $proc.CommandLine
    if ($cmd -match '--csrf_token' -and $cmd -match '--app_data_dir\s+antigravity') {
        $targetProcess = $proc
        break
    }
}

if (-not $targetProcess) {
    Write-Warning "❌ Found language_server processes but none matched Antigravity signature."
    exit 1
}

$pid_ = $targetProcess.ProcessId
$cmdLine = $targetProcess.CommandLine

# Step 3: Extract CSRF Token from command line
if ($cmdLine -match '--csrf_token[=\s]+([a-f0-9-]+)') {
    $csrfToken = $matches[1]
}
else {
    Write-Warning "❌ Could not extract CSRF token from command line."
    exit 1
}

Write-Host "✅ Found Language Server PID=$pid_ with CSRF Token"

# Step 4: Find the listening port (same approach as Cockpit: Get-NetTCPConnection)
$ports = Get-NetTCPConnection -State Listen -OwningProcess $pid_ -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique

if (-not $ports -or $ports.Count -eq 0) {
    Write-Warning "❌ Could not find any listening ports for PID $pid_."
    exit 1
}

Write-Host "✅ Found listening ports: $($ports -join ', ')"

# Step 5: Try each port with HTTPS POST to GetUserStatus (same as Cockpit's ReactorCore)
$quotaData = $null
foreach ($port in $ports) {
    Write-Host "  Trying port $port..."
    $url = "https://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetUserStatus"

    try {
        # Bypass self-signed cert (same as Cockpit: rejectUnauthorized: false)
        $response = Invoke-RestMethod -Uri $url -Method Post `
            -Headers @{
            "X-Codeium-Csrf-Token"     = $csrfToken
            "Content-Type"             = "application/json"
            "Connect-Protocol-Version" = "1"
        } `
            -Body "{}" `
            -SkipCertificateCheck `
            -ErrorAction Stop

        $quotaData = $response
        Write-Host "  ✅ Got response from port $port"
        break
    }
    catch {
        Write-Host "  ⚠️ Port $port failed: $_"
    }
}

if (-not $quotaData) {
    Write-Warning "⚠️ All ports failed. Could not retrieve quota data."
    Write-Warning "Writing fallback quota_snapshot.json — swarm will proceed without quota routing."
    $fallback = @{
        status    = "unavailable"
        error     = "All language server ports failed"
        models    = @()
        timestamp = (Get-Date -Format o)
    }
    $outFile = Join-Path -Path $PWD -ChildPath "quota_snapshot.json"
    $fallback | ConvertTo-Json -Depth 5 | Out-File -FilePath $outFile -Encoding utf8
    Write-Host "⚠️ Fallback quota snapshot saved to $outFile"
    exit 0
}

# Step 6: Write the raw quota snapshot to disk
$outFile = Join-Path -Path $PWD -ChildPath "quota_snapshot.json"
$quotaData | ConvertTo-Json -Depth 10 | Out-File -FilePath $outFile -Encoding utf8

Write-Host "✅ Quota snapshot saved to $outFile"
