#!/bin/bash
#
# Model Tag Team — Install Script (macOS/Linux)
#
# Deploys all Tag Team files to their correct Antigravity locations.
# Safe to re-run — overwrites existing files.
#
# Usage: chmod +x install.sh && ./install.sh
#

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src"
HOME_DIR="$HOME"

echo "🏷️  Model Tag Team — Installing..."
echo ""

# 1. GEMINI.md
mkdir -p "$HOME_DIR/.gemini"
cp -f "$SRC/GEMINI.md" "$HOME_DIR/.gemini/GEMINI.md"
echo "  ✅ Layer 1: GEMINI.md → ~/.gemini/GEMINI.md"

# 2. Skill
mkdir -p "$HOME_DIR/.gemini/antigravity/skills/smart-handoff"
cp -f "$SRC/skill/SKILL.md" "$HOME_DIR/.gemini/antigravity/skills/smart-handoff/SKILL.md"
echo "  ✅ Layer 2: SKILL.md → ~/.gemini/antigravity/skills/smart-handoff/SKILL.md"

# 3. Workflows
mkdir -p "$HOME_DIR/.gemini/antigravity/.agent/workflows"
for wf in pivot.md resume.md health.md; do
    cp -f "$SRC/workflows/$wf" "$HOME_DIR/.gemini/antigravity/.agent/workflows/$wf"
    echo "  ✅ Workflow: $wf"
done

# 4. Configs
mkdir -p "$HOME_DIR/.antigravity-configs/rules"
mkdir -p "$HOME_DIR/.antigravity-configs/templates"
mkdir -p "$HOME_DIR/.antigravity-configs/workflows"

cp -f "$SRC/model_fallback.json" "$HOME_DIR/.antigravity-configs/model_fallback.json"
echo "  ✅ Config: model_fallback.json"

cp -f "$SRC/templates/handoff_manifest.md" "$HOME_DIR/.antigravity-configs/templates/handoff_manifest.md"
echo "  ✅ Template: handoff_manifest.md"

for rule in handoff.md context_compression.md; do
    cp -f "$SRC/rules/$rule" "$HOME_DIR/.antigravity-configs/rules/$rule"
    echo "  ✅ Rule: $rule"
done

for wf in pivot.md resume.md; do
    cp -f "$SRC/workflows/$wf" "$HOME_DIR/.antigravity-configs/workflows/$wf"
done

# 5. Rules symlink
LINK_PATH="$HOME_DIR/.gemini/antigravity/rules"
if [ ! -L "$LINK_PATH" ] && [ ! -d "$LINK_PATH" ]; then
    ln -s "$HOME_DIR/.antigravity-configs/rules" "$LINK_PATH"
    echo "  ✅ Symlink: rules → ~/.antigravity-configs/rules"
else
    echo "  ℹ️  Rules link already exists: $LINK_PATH"
fi

# 6. Global gitignore
mkdir -p "$HOME_DIR/.config/git"
cp -f "$SRC/gitignore-global" "$HOME_DIR/.config/git/ignore"
git config --global core.excludesfile "$HOME_DIR/.config/git/ignore"
echo "  ✅ Global gitignore configured"

echo ""
echo "🏷️  Model Tag Team installed successfully!"
echo ""
echo "  Commands available:"
echo "    /pivot   — Generate handoff manifest and switch models"
echo "    /resume  — Pick up from active manifest"
echo "    /health  — Audit system status"
echo ""
echo "  Run /health in your next Antigravity session to verify."
