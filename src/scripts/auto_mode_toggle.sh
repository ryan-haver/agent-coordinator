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
    # Read settings keys from config (with fallbacks)
    CONFIG_FILE="$HOME_DIR/.antigravity-configs/model_fallback.json"
    
    node -e "
        const fs = require('fs');
        const settingsPath = process.argv[1];
        const configPath = process.argv[2];
        let config = {};
        if (fs.existsSync(settingsPath)) {
            try {
                const content = fs.readFileSync(settingsPath, 'utf8');
                if (content.trim()) config = JSON.parse(content);
            } catch (e) {
                console.error('Failed to parse settings.json', e);
                process.exit(1);
            }
        }
        
        // Read keys from model_fallback.json (with defaults)
        let keyAutoRun = 'cascade.autoRunCommands';
        let keyBackground = 'cascade.allowInBackground';
        let keyApproveEdits = 'cascade.autoApproveEdits';
        if (fs.existsSync(configPath)) {
            try {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (cfg.auto_mode_settings && cfg.auto_mode_settings.keys) {
                    keyAutoRun = cfg.auto_mode_settings.keys.auto_run_commands || keyAutoRun;
                    keyBackground = cfg.auto_mode_settings.keys.allow_in_background || keyBackground;
                    keyApproveEdits = cfg.auto_mode_settings.keys.auto_approve_edits || keyApproveEdits;
                }
            } catch (e) { /* use defaults */ }
        }
        
        config[keyAutoRun] = true;
        config[keyBackground] = true;
        config[keyApproveEdits] = true;
        
        fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2));
    " -- "$SETTINGS_PATH" "$CONFIG_FILE"
    echo "✅ Autonomous settings injected into settings.json"
fi
