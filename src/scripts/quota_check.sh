#!/usr/bin/env bash
# quota_check.sh
# Reverse-engineered from the Antigravity Cockpit extension (jlcodes99/vscode-antigravity-cockpit).
# Locates the language server process, extracts CSRF token and listening port,
# then hits the GetUserStatus API over HTTPS to dump quota data to quota_snapshot.json.

set -e

echo "🔍 Scanning for Antigravity Language Server..."

# Detect platform
if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ "$(uname -m)" == "arm64" ]]; then
        PROCESS_NAME="language_server_macos_arm"
    else
        PROCESS_NAME="language_server_macos"
    fi
else
    PROCESS_NAME="language_server_linux"
fi

# Step 1: Find the process with csrf_token AND app_data_dir antigravity
CMDLINE=$(ps -ww -eo pid,args | grep "$PROCESS_NAME" | grep -- '--csrf_token' | grep -- '--app_data_dir antigravity' | grep -v grep | head -n 1)

if [ -z "$CMDLINE" ]; then
    echo "❌ Language server process not found. Ensure Antigravity is running." >&2
    exit 1
fi

# Extract PID (first field)
PID=$(echo "$CMDLINE" | awk '{print $1}')

# Step 2: Extract CSRF Token
CSRF_TOKEN=$(echo "$CMDLINE" | sed -n 's/.*--csrf_token[= ]\([a-f0-9-]*\).*/\1/p')
if [ -z "$CSRF_TOKEN" ]; then
    echo "❌ Could not extract CSRF token." >&2
    exit 1
fi

echo "✅ Found Language Server PID=$PID with CSRF Token"

# Step 3: Find listening ports
if [[ "$(uname -s)" == "Darwin" ]]; then
    PORTS=$(lsof -nP -a -iTCP -sTCP:LISTEN -p "$PID" 2>/dev/null | grep -oE ':[0-9]+' | tr -d ':' | sort -un)
else
    # Linux: try lsof, then ss, then netstat
    PORTS=$(lsof -nP -a -iTCP -sTCP:LISTEN -p "$PID" 2>/dev/null | grep -oE ':[0-9]+' | tr -d ':' | sort -un 2>/dev/null || \
            ss -tlnp 2>/dev/null | grep "pid=$PID," | grep -oE ':[0-9]+' | tr -d ':' | sort -un 2>/dev/null || \
            netstat -tulpn 2>/dev/null | grep "$PID" | grep -oE ':[0-9]+' | tr -d ':' | sort -un)
fi

if [ -z "$PORTS" ]; then
    echo "❌ Could not find listening ports for PID $PID." >&2
    exit 1
fi

echo "✅ Found listening ports: $PORTS"

# Step 4: Try each port with HTTPS POST
for PORT in $PORTS; do
    echo "  Trying port $PORT..."
    URL="https://127.0.0.1:$PORT/exa.language_server_pb.LanguageServerService/GetUserStatus"

    RESPONSE=$(curl -sk -X POST "$URL" \
        -H "X-Codeium-Csrf-Token: $CSRF_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Connect-Protocol-Version: 1" \
        -d "{}" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
        echo "$RESPONSE" > quota_snapshot.json
        echo "✅ Quota snapshot saved to quota_snapshot.json"
        exit 0
    else
        echo "  ⚠️ Port $PORT failed"
    fi
done

echo "❌ All ports failed. Could not retrieve quota data." >&2
exit 1
