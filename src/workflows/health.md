---
description: System health check — audits the Agent Coordination configuration and reports layer-by-layer status
---

# /health — Agent Coordination Health Check

Audit the three-layer handoff system and report status.

## Steps

### 1. Layer 1 — Global Instructions
// turbo
Verify `GEMINI.md` is loaded:

**Windows (PowerShell):**
```powershell
if (Test-Path "$env:USERPROFILE\.gemini\GEMINI.md") { Get-Content "$env:USERPROFILE\.gemini\GEMINI.md" } else { echo "MISSING" }
```
**macOS/Linux (Bash):**
```bash
if [ -f "$HOME/.gemini/GEMINI.md" ]; then cat "$HOME/.gemini/GEMINI.md"; else echo "MISSING"; fi
```
- ✅ **GREEN**: File exists AND contains "Agent Coordination" reference
- 🟡 **YELLOW**: File exists but empty or missing handoff reference
- 🔴 **RED**: File missing

### 2. Layer 2 — Skill Discovery
// turbo
Verify the `agent-coordination` skill is discoverable:
**Windows (PowerShell):**
```powershell
if (Test-Path "$env:USERPROFILE\.gemini\antigravity\skills\agent-coordination\SKILL.md") { echo "SKILL EXISTS"; Select-String -Path "$env:USERPROFILE\.gemini\antigravity\skills\agent-coordination\SKILL.md" -Pattern "name:" | Select-Object -First 1 } else { echo "MISSING" }
```
**macOS/Linux (Bash):**
```bash
if [ -f "$HOME/.gemini/antigravity/skills/agent-coordination/SKILL.md" ]; then echo "SKILL EXISTS"; grep "name:" "$HOME/.gemini/antigravity/skills/agent-coordination/SKILL.md" | head -1; else echo "MISSING"; fi
```
Also verify the template is accessible:

**Windows (PowerShell):**
```powershell
if (Test-Path "$env:USERPROFILE\.antigravity-configs\templates\handoff_manifest.md") { echo "TEMPLATE EXISTS" } else { echo "TEMPLATE MISSING" }
```
**macOS/Linux (Bash):**
```bash
if [ -f "$HOME/.antigravity-configs/templates/handoff_manifest.md" ]; then echo "TEMPLATE EXISTS"; else echo "TEMPLATE MISSING"; fi
```
- ✅ **GREEN**: SKILL.md exists with valid frontmatter AND template is accessible
- 🟡 **YELLOW**: Skill exists but template is missing
- 🔴 **RED**: Skill missing entirely

### 3. Layer 3 — Commands
// turbo
Verify all workflows are registered:
**Windows (PowerShell):**
```powershell
$wfDir = "$env:USERPROFILE\.gemini\antigravity\.agent\workflows"
foreach ($wf in @("pivot.md", "resume.md", "health.md", "swarm.md", "swarm-auto.md")) { echo "$wf`: $(Test-Path "$wfDir\$wf")" }
```
**macOS/Linux (Bash):**
```bash
WF_DIR="$HOME/.gemini/antigravity/.agent/workflows"
for wf in pivot.md resume.md health.md swarm.md swarm-auto.md; do echo "$wf: $([ -f "$WF_DIR/$wf" ] && echo True || echo False)"; done
```
- ✅ **GREEN**: All five workflows present
- 🟡 **YELLOW**: Some workflows missing
- 🔴 **RED**: All missing
### 4. Bonus Checks
// turbo
Verify supporting files:
**Windows (PowerShell):**
```powershell
echo "=== Fallback Config ==="
if (Test-Path "$env:USERPROFILE\.antigravity-configs\model_fallback.json") { echo "EXISTS" } else { echo "MISSING" }
echo "=== Active Manifest ==="
if (Test-Path "$env:USERPROFILE\.antigravity-configs\handoff_active.md") { echo "ACTIVE (from previous session)" } else { echo "None active (clean state)" }
echo "=== Gitignore Protection ==="
if (Test-Path "$env:USERPROFILE\.config\git\ignore") { Select-String -Path "$env:USERPROFILE\.config\git\ignore" -Pattern "handoff" -ErrorAction SilentlyContinue | Select-Object -First 1; if (!$?) { echo "NOT PROTECTED" } } else { echo "No global gitignore found" }
```
**macOS/Linux (Bash):**
```bash
echo "=== Fallback Config ==="
[ -f "$HOME/.antigravity-configs/model_fallback.json" ] && echo "EXISTS" || echo "MISSING"
echo "=== Active Manifest ==="
[ -f "$HOME/.antigravity-configs/handoff_active.md" ] && echo "ACTIVE (from previous session)" || echo "None active (clean state)"
echo "=== Gitignore Protection ==="
if [ -f "$HOME/.config/git/ignore" ]; then grep "handoff" "$HOME/.config/git/ignore" || echo "NOT PROTECTED"; else echo "No global gitignore found"; fi
```

### 5. Model Config Freshness
// turbo
Check if `model_fallback.json` models match the current Antigravity model selector.

**Windows (PowerShell):**
```powershell
$db = "$env:APPDATA\Antigravity\User\globalStorage\state.vscdb"
if (Test-Path $db) { echo "State DB found: $db"; echo "Size: $((Get-Item $db).Length) bytes" } else { echo "State DB not found" }
$config = Get-Content "$env:USERPROFILE\.antigravity-configs\model_fallback.json" -Raw | ConvertFrom-Json
echo "=== Configured Tier Models ==="
$config.model_fallback_chain.tiers | ForEach-Object { echo "  Tier $($_.tier): $($_.model)" }
```
**macOS/Linux (Bash):**
```bash
DB="$HOME/.config/Antigravity/User/globalStorage/state.vscdb"
[ "$(uname)" = "Darwin" ] && DB="$HOME/Library/Application Support/Antigravity/User/globalStorage/state.vscdb"
[ -f "$DB" ] && echo "State DB found: $DB" || echo "State DB not found"
echo "=== Configured Tier Models ==="
python3 -c "import json; d=json.load(open('$HOME/.antigravity-configs/model_fallback.json')); [print(f'  Tier {t[\"tier\"]}: {t[\"model\"]}') for t in d['model_fallback_chain']['tiers']]"
```

Compare the configured model names against the Antigravity model selector. If model versions have changed (e.g., "Claude Opus 4.6" → "Claude Opus 5.0"), flag it:
- ✅ **GREEN**: All tier models match available models in selector
- 🟡 **YELLOW**: Model versions appear outdated — recommend updating `model_fallback.json`
- 🔴 **RED**: A configured tier model no longer exists in the selector

### 6. Output Report

Present the results in this format:

```
🏥 Agent Coordination Health Check

| Component              | Status | Detail                                  |
|------------------------|--------|-----------------------------------------|
| Global Instructions    | ✅/🟡/🔴 | GEMINI.md [status]                   |
| Coordination Skill     | ✅/🟡/🔴 | SKILL.md [status], Template [status] |
| /pivot Command         | ✅/🔴    | pivot.md [status]                    |
| /resume Command        | ✅/🔴    | resume.md [status]                   |
| /health Command        | ✅/🔴    | health.md [status]                   |
| /swarm Command         | ✅/🔴    | swarm.md [status]                    |
| /swarm-auto Command    | ✅/🔴    | swarm-auto.md [status]               |
| Agent Prompts          | ✅/🔴    | N templates [status]                 |
| Fallback Config        | ✅/🔴    | model_fallback.json [status]         |
| Model Freshness        | ✅/🟡/🔴 | Tier models vs selector [status]     |
| Gitignore Protection   | ✅/🟡    | handoff artifacts [status]           |
| Active Manifest        | ℹ️      | [clean / active from previous]        |
```

If any component is RED, provide the fix command.

