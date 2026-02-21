#!/usr/bin/env bash
#
# Install or reinstall Model Tag Team into your Antigravity environment.
#
# Copies all Agent Coordination files to their correct deployment locations:
#   - GEMINI.md → ~/.gemini/GEMINI.md
#   - SKILL.md → ~/.gemini/antigravity/skills/agent-coordination/SKILL.md
#   - Workflows → ~/.gemini/antigravity/.agent/workflows/
#   - Templates → ~/.antigravity-configs/templates/
#   - Agent prompts → ~/.antigravity-configs/templates/agent-prompts/
#   - Configs → ~/.antigravity-configs/
#   - Global gitignore → ~/.config/git/ignore
#
# Safe to re-run. Run from the model-tag-team directory: ./install.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src"
HOME_DIR="$HOME"

echo "🏷️  Model Tag Team — Installing..."
echo ""

# 0. Clean up old skill directory (smart-handoff → agent-coordination)
OLD_SKILL="$HOME_DIR/.gemini/antigravity/skills/smart-handoff"
if [ -d "$OLD_SKILL" ]; then
    rm -rf "$OLD_SKILL"
    echo "  🧹 Removed old skill directory: smart-handoff"
fi

# 1. GEMINI.md (merge-safe — append if existing, never overwrite user content)
GEMINI_SRC="$SRC/GEMINI.md"
GEMINI_DST="$HOME_DIR/.gemini/GEMINI.md"
mkdir -p "$(dirname "$GEMINI_DST")"
if [ -f "$GEMINI_DST" ]; then
    if grep -q "Agent Coordination\|Smart Handoff" "$GEMINI_DST" 2>/dev/null; then
        echo "  ℹ️  Layer 1: GEMINI.md already contains coordination instructions — skipped"
    else
        echo "" >> "$GEMINI_DST"
        cat "$GEMINI_SRC" >> "$GEMINI_DST"
        echo "  ✅ Layer 1: GEMINI.md — appended coordination instructions"
    fi
else
    cp "$GEMINI_SRC" "$GEMINI_DST"
    echo "  ✅ Layer 1: GEMINI.md → $GEMINI_DST"
fi

# 2. Skill (agent-coordination)
SKILL_DST="$HOME_DIR/.gemini/antigravity/skills/agent-coordination/SKILL.md"
mkdir -p "$(dirname "$SKILL_DST")"
cp "$SRC/skill/SKILL.md" "$SKILL_DST"
echo "  ✅ Layer 2: SKILL.md → $SKILL_DST"

# 3. Workflows (handoff + swarm)
WF_DST="$HOME_DIR/.gemini/antigravity/.agent/workflows"
mkdir -p "$WF_DST"
for wf in pivot.md resume.md health.md swarm.md swarm-auto.md; do
    if [ -f "$SRC/workflows/$wf" ]; then
        cp "$SRC/workflows/$wf" "$WF_DST/$wf"
        echo "  ✅ Workflow: $wf"
    else
        echo "  ⚠️  Workflow not found: $wf"
    fi
done

# 4. Configs
CFG_DST="$HOME_DIR/.antigravity-configs"
mkdir -p "$CFG_DST/rules" "$CFG_DST/templates/agent-prompts" "$CFG_DST/workflows"

cp "$SRC/model_fallback.json" "$CFG_DST/model_fallback.json"
echo "  ✅ Config: model_fallback.json"

# Templates (handoff + swarm manifests)
for tmpl in handoff_manifest.md swarm-manifest.md; do
    if [ -f "$SRC/templates/$tmpl" ]; then
        cp "$SRC/templates/$tmpl" "$CFG_DST/templates/$tmpl"
        echo "  ✅ Template: $tmpl"
    fi
done

# Agent prompts (all 9)
PROMPT_SRC="$SRC/templates/agent-prompts"
if [ -d "$PROMPT_SRC" ]; then
    PROMPT_COUNT=0
    for p in "$PROMPT_SRC"/*.md; do
        [ -f "$p" ] || continue
        cp "$p" "$CFG_DST/templates/agent-prompts/$(basename "$p")"
        PROMPT_COUNT=$((PROMPT_COUNT + 1))
    done
    echo "  ✅ Agent prompts: $PROMPT_COUNT templates deployed"
fi

# Rules
for rule in handoff.md context_compression.md; do
    cp "$SRC/rules/$rule" "$CFG_DST/rules/$rule"
    echo "  ✅ Rule: $rule"
done

# Workflows backup copy
for wf in pivot.md resume.md health.md swarm.md swarm-auto.md; do
    [ -f "$SRC/workflows/$wf" ] && cp "$SRC/workflows/$wf" "$CFG_DST/workflows/$wf"
done

# 5. Rules symlink
LINK_PATH="$HOME_DIR/.gemini/antigravity/rules"
if [ ! -e "$LINK_PATH" ]; then
    ln -s "$CFG_DST/rules" "$LINK_PATH"
    echo "  ✅ Symlink: rules → $CFG_DST/rules"
else
    echo "  ℹ️  Symlink already exists: $LINK_PATH"
fi

# 6. Global gitignore (merge-safe — append if existing, never overwrite user entries)
GI_DST="$HOME_DIR/.config/git/ignore"
mkdir -p "$(dirname "$GI_DST")"
if [ -f "$GI_DST" ]; then
    if grep -q "Agent Coordination\|Smart Handoff" "$GI_DST" 2>/dev/null; then
        echo "  ℹ️  Global gitignore already contains coordination entries — skipped"
    else
        echo "" >> "$GI_DST"
        cat "$SRC/gitignore-global" >> "$GI_DST"
        echo "  ✅ Global gitignore — appended coordination entries"
    fi
else
    cp "$SRC/gitignore-global" "$GI_DST"
    echo "  ✅ Global gitignore configured"
fi
git config --global core.excludesfile "$GI_DST"

echo ""
echo "🏷️  Model Tag Team installed successfully!"
echo ""
echo "  Commands available:"
echo "    /pivot      — Generate handoff manifest and switch models"
echo "    /resume     — Pick up from active manifest"
echo "    /swarm      — Decompose task into multi-agent swarm"
echo "    /swarm-auto — Rapid swarm with all prompts upfront"
echo "    /health     — Audit system status"
echo ""
echo "  Run /health in your next Antigravity session to verify."
