---
description: System health check — audits the Smart Handoff configuration and reports layer-by-layer status
---

# /health — Smart Handoff Health Check

Audit the three-layer handoff system and report status.

## Steps

### 1. Layer 1 — Global Instructions
// turbo
Verify `GEMINI.md` is loaded:
```powershell
if (Test-Path "$env:USERPROFILE\.gemini\GEMINI.md") { Get-Content "$env:USERPROFILE\.gemini\GEMINI.md" } else { echo "MISSING" }
```
- ✅ **GREEN**: File exists AND contains "Smart Handoff" reference
- 🟡 **YELLOW**: File exists but empty or missing handoff reference
- 🔴 **RED**: File missing

### 2. Layer 2 — Skill Discovery
// turbo
Verify the `smart-handoff` skill is discoverable:
```powershell
if (Test-Path "$env:USERPROFILE\.gemini\antigravity\skills\smart-handoff\SKILL.md") { echo "SKILL EXISTS"; Select-String -Path "$env:USERPROFILE\.gemini\antigravity\skills\smart-handoff\SKILL.md" -Pattern "name:" | Select-Object -First 1 } else { echo "MISSING" }
```
Also verify the template is accessible:
```powershell
if (Test-Path "$env:USERPROFILE\.antigravity-configs\templates\handoff_manifest.md") { echo "TEMPLATE EXISTS" } else { echo "TEMPLATE MISSING" }
```
- ✅ **GREEN**: SKILL.md exists with valid frontmatter AND template is accessible
- 🟡 **YELLOW**: Skill exists but template is missing
- 🔴 **RED**: Skill missing entirely

### 3. Layer 3 — Commands
// turbo
Verify `/pivot` and `/resume` workflows are registered:
```powershell
$wfDir = "$env:USERPROFILE\.gemini\antigravity\.agent\workflows"
$pivot = Test-Path "$wfDir\pivot.md"
$resume = Test-Path "$wfDir\resume.md"
echo "pivot.md: $pivot"
echo "resume.md: $resume"
```
- ✅ **GREEN**: Both workflows present
- 🟡 **YELLOW**: One workflow missing
- 🔴 **RED**: Both missing

### 4. Bonus Checks
// turbo
Verify supporting files:
```powershell
echo "=== Fallback Config ==="
if (Test-Path "$env:USERPROFILE\.antigravity-configs\model_fallback.json") { echo "EXISTS" } else { echo "MISSING" }
echo "=== Active Manifest ==="
if (Test-Path "$env:USERPROFILE\.antigravity-configs\handoff_active.md") { echo "ACTIVE (from previous session)" } else { echo "None active (clean state)" }
echo "=== Gitignore Protection ==="
if (Test-Path "$env:USERPROFILE\.config\git\ignore") { Select-String -Path "$env:USERPROFILE\.config\git\ignore" -Pattern "handoff" -ErrorAction SilentlyContinue | Select-Object -First 1; if (!$?) { echo "NOT PROTECTED" } } else { echo "No global gitignore found" }
```

### 5. Output Report

Present the results in this format:

```
🏥 Smart Handoff Health Check

| Component              | Status | Detail                                  |
|------------------------|--------|-----------------------------------------|
| Global Instructions    | ✅/🟡/🔴 | GEMINI.md [status]                   |
| Smart Handoff Skill    | ✅/🟡/🔴 | SKILL.md [status], Template [status] |
| /pivot Command         | ✅/🔴    | pivot.md [status]                    |
| /resume Command        | ✅/🔴    | resume.md [status]                   |
| Fallback Config        | ✅/🔴    | model_fallback.json [status]         |
| Gitignore Protection   | ✅/🟡    | handoff artifacts [status]           |
| Active Manifest        | ℹ️      | [clean / active from previous]        |
```

If any component is RED, provide the fix command.
