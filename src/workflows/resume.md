---
description: Resume — read the active handoff manifest, adopt the assigned persona, and continue where the previous model left off
---

# /resume — Smart Handoff Resume

Use this at the start of a new session after a model switch. Reads the manifest, adopts your assigned persona, and continues seamlessly.

## Steps

### 1. Locate the Active Manifest
// turbo
Check for the handoff manifest:
```
cat ~/.antigravity-configs/handoff_active.md
```
If not found, check recent conversation artifact directories for `handoff_active.md`.

### 2. Read and Parse the Manifest
Read the full manifest. Extract:
- **Current Objective** — what we're trying to accomplish
- **Last Successful Action** — where the previous model stopped
- **Active Files** — which files need attention
- **Bug Tracker** — what's broken or incomplete
- **Handoff Instructions** — specific briefing for YOUR model
- **Model Persona** — your assigned behavioral profile

### 3. Adopt Your Assigned Persona

Read the `## Incoming Model Persona` section from the manifest and adopt it fully.

**If you are Gemini (3 Pro or 3 Flash):**
> Adopt the **Multi-File Global Scanner** persona:
> - Scan ALL active files before making any changes
> - Build a cross-file dependency map
> - Prefer broad multi-file edits over iterative single-file changes
> - Cast a wide net when debugging — check imports, callers, related modules

**If you are Claude:**
> Adopt the **Logical Precision & DRY Architect** persona:
> - Deep-read the specific file/function in the bug tracker first
> - Reason step-by-step through logic before proposing changes
> - Check for DRY violations and extract shared logic
> - Consider all edge cases: nulls, empty collections, concurrency, races

### 4. Scan Active Files
// turbo
For each file listed in the manifest:
- Open and review the file
- Verify it matches the manifest description
- Note discrepancies

### 5. Check Repository State
// turbo
Verify git state matches expectations:
```
git status
git log -3 --oneline
```
Confirm branch and last commit match the manifest.

### 6. Check for Reasoning Failure Context
If the manifest contains a `## Reasoning Failure` section:
- Read all failed approaches carefully
- **Do NOT repeat them** — the previous model already tried
- Start with the **Recommended Next Approach** if one is provided
- If no recommendation, analyze WHY each approach failed and try something fundamentally different

### 7. Confirm Ready
Present readiness report:

```
✅ Handoff Resume Complete

📋 Manifest: [manifest location]
🤖 Previous: {{OUTGOING_MODEL}} ({{OUTGOING_ROLE}})
🎭 My Persona: {{PERSONA_NAME}}
🎯 Objective: {{OBJECTIVE}}
📁 Active Files: {{COUNT}} files scanned
🐛 Pending Bugs: {{BUG_COUNT}} issues tracked
⚠️ Reasoning Failures: {{FAILURE_COUNT}} (will NOT repeat these approaches)

Ready to continue. Immediate next step: {{NEXT_ACTION}}

Shall I proceed?
```

### 8. Archive the Manifest
After user confirms:
// turbo
Rename to prevent stale pickup:
```powershell
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Move-Item "$env:USERPROFILE\.antigravity-configs\handoff_active.md" "$env:USERPROFILE\.antigravity-configs\handoff_$ts.md"
```

### 9. Begin Work
Resume from the exact point described in the manifest:
- Follow your assigned persona's behavioral rules
- Start with the first pending bug or incomplete task
- Use `task.md` artifact to track progress

> [!TIP]
> If the manifest seems outdated or doesn't match the current file state,
> ask the user for clarification before proceeding. Don't assume — verify.
