#!/usr/bin/env bash
#
# Toggles Antigravity settings for autonomous swarm operation.
#
# By default, backs up the current settings.json and injects autonomous overrides 
# (autoRunCommands, allowInBackground, autoApproveEdits).
# If --restore is passed, it restores the original settings from the backup.

set -euo pipefail

RESTORE=false
for arg in "$@"; do
    case "$arg" in
        --restore|-r) RESTORE=true ;;
    esac
done

HOME_DIR="$HOME"
SETTINGS_PATH="$HOME_DIR/.config/Antigravity/User/settings.json"
BACKUP_PATH="$HOME_DIR/.antigravity-configs/settings_backup.json"

# Fallbacks for different OS structures (e.g. Mac vs Linux vs VS Code)
if [ ! -f "$SETTINGS_PATH" ]; then
    SETTINGS_PATH="$HOME_DIR/Library/Application Support/Antigravity/User/settings.json"
fi
if [ ! -f "$SETTINGS_PATH" ]; then
    SETTINGS_PATH="$HOME_DIR/.config/Code/User/settings.json"
fi

if [ ! -f "$SETTINGS_PATH" ]; then
    echo "⚠️ Could not find Antigravity or VS Code settings.json"
    exit 1
fi

if [ "$RESTORE" = true ]; then
    if [ -f "$BACKUP_PATH" ]; then
        echo "🔄 Restoring original Antigravity settings..."
        cp -f "$BACKUP_PATH" "$SETTINGS_PATH"
        rm -f "$BACKUP_PATH"
        echo "✅ Settings restored successfully."
    else
        echo "⚠️ No settings backup found. Nothing to restore."
    fi
else
    echo "🚀 Enabling Autonomous Mode..."
    
    # 1. Backup if one doesn't exist to prevent overwriting an existing backup
    if [ ! -f "$BACKUP_PATH" ]; then
        mkdir -p "$(dirname "$BACKUP_PATH")"
        cp -f "$SETTINGS_PATH" "$BACKUP_PATH"
        echo "✅ Settings backed up to $BACKUP_PATH"
    fi

    # 2. Inject autonomous overrides using node for reliable JSON parsing
    node -e "
        const fs = require('fs');
        const path = '$SETTINGS_PATH';
        let config = {};
        if (fs.existsSync(path)) {
            try {
                const content = fs.readFileSync(path, 'utf8');
                if (content.trim()) config = JSON.parse(content);
            } catch (e) {
                console.error('Failed to parse settings.json', e);
                process.exit(1);
            }
        }
        
        config['cascade.autoRunCommands'] = true;
        config['cascade.allowInBackground'] = true;
        config['cascade.autoApproveEdits'] = true;
        
        fs.writeFileSync(path, JSON.stringify(config, null, 2));
    "
    echo "✅ Autonomous settings injected into settings.json"
fi
