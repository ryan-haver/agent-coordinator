#!/usr/bin/env bash
#
# Agent Coordinator — Uninstall Script (macOS/Linux)
#
# Removes all Agent Coordination files from deployment locations.
# Does NOT delete the source project — only the deployed copies.
#
# Usage: chmod +x uninstall.sh && ./uninstall.sh
#

set -euo pipefail

HOME_DIR="$HOME"

echo "🏷️  Agent Coordinator — Uninstalling..."
echo ""

# 1. GEMINI.md — remove the coordination block, preserve other content
GEMINI="$HOME_DIR/.gemini/GEMINI.md"
if [ -f "$GEMINI" ]; then
    if grep -q "Agent Coordination\|Smart Handoff" "$GEMINI" 2>/dev/null; then
        # Remove coordination section (handles both mid-file and end-of-file positions)
        sed -i.bak '/^# \(Agent Coordination System\|Agent Coordinator\|Global Smart Handoff\)/,${/^# \(Agent Coordination System\|Agent Coordinator\|Global Smart Handoff\)/!{/^# [^#]/!d;}}' "$GEMINI"
        sed -i.bak -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$GEMINI"
        rm -f "${GEMINI}.bak"
        echo "  ✅ Removed coordination block from GEMINI.md"
    else
        echo "  ℹ️  GEMINI.md has no coordination content — skipped"
    fi
fi

# 2. Skill (both old and new names)
for name in agent-coordination smart-handoff; do
    SKILL_DIR="$HOME_DIR/.gemini/antigravity/skills/$name"
    if [ -d "$SKILL_DIR" ]; then
        rm -rf "$SKILL_DIR"
        echo "  ✅ Removed $name skill"
    fi
done

# 3. Workflows
WF_DIR="$HOME_DIR/.gemini/antigravity/.agent/workflows"
for wf in pivot.md resume.md health.md swarm.md swarm-auto.md consult.md status.md; do
    if [ -f "$WF_DIR/$wf" ]; then
        rm -f "$WF_DIR/$wf"
        echo "  ✅ Removed $wf"
    fi
done

# 4. Rules symlink
LINK_PATH="$HOME_DIR/.gemini/antigravity/rules"
if [ -L "$LINK_PATH" ]; then
    rm -f "$LINK_PATH"
    echo "  ✅ Removed rules symlink"
elif [ -d "$LINK_PATH" ]; then
    rm -rf "$LINK_PATH"
    echo "  ✅ Removed rules directory"
fi

# 5. Config directory (optional — prompt)
CFG_DIR="$HOME_DIR/.antigravity-configs"
if [ -d "$CFG_DIR" ]; then
    printf "  Remove ~/.antigravity-configs/ entirely? (y/N) "
    read -r answer
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        rm -rf "$CFG_DIR"
        echo "  ✅ Removed ~/.antigravity-configs/"
    else
        echo "  ℹ️  Kept ~/.antigravity-configs/"
    fi
fi

echo ""
echo "🏷️  Agent Coordinator uninstalled."
echo "  Note: Global gitignore at ~/.config/git/ignore was left intact."
