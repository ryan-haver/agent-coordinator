---
description: Coordinate a multi-agent swarm with human-in-the-loop phase gates. Generates a manifest and agent prompts for dispatch via Agent Manager.
metadata:
  name: "swarm"
  scope: global
---

# Multi-Agent Swarm (Supervised)

You are now in **SWARM COORDINATOR MODE**. Your task: break a complex project into agent-scoped work, generate a manifest and prompts, and guide the user through phased dispatch.

## Task to Orchestrate
$ARGUMENTS

---

## Step 1: ANALYZE

Break the task into agent assignments. Determine:

1. **Which roles are needed?**
   - Architect (always) — plans the approach
   - Developer(s) — how many, and what scope for each?
   - QA (always) — verifies the result
   - Explorer (optional) — for unfamiliar codebases
   - Code Reviewer (optional) — for detailed diff review and plan alignment
   - Debugger (optional) — for targeted root cause analysis and bug fixes

2. **What are the scope boundaries?**
   - Which directories/files does each Developer own?
   - Are there any shared files that need careful coordination?

3. **What models should each agent use?**
    - Read `~/.antigravity-configs/model_fallback.json` for current model names
    - Default: Architect = Claude (Tier 1), Developer = Gemini Pro (Tier 2), QA = Gemini Flash (Tier 3)
    - Adjust based on task complexity

Present this breakdown to the user:

```
📋 Swarm Plan for: [task summary]

Agents:
  α Architect    → Claude (Tier 1)   → plan.md, docs
  β Developer    → Gemini Pro (T2)   → /src/backend/**
  γ Developer    → Gemini Pro (T2)   → /src/frontend/**
  δ QA           → Gemini Flash (T3) → read-only, tests

Phases:
  1. Planning:       α
  2. Implementation: β, γ (parallel)
  3. Verification:   δ

Does this look right? (adjust agents/scope before we generate prompts)
```

Wait for user confirmation before proceeding.

---

## Step 2: GENERATE MANIFEST

After user confirms the agent plan:

1. Use the `swarm-manifest.md` template from the `agent-coordination` skill's `templates/` directory
2. Write it to `swarm-manifest.md` in the project root
3. Fill in:
   - `$TIMESTAMP` → current timestamp
   - `$MISSION` → the original task from $ARGUMENTS
   - `## Agents` table → populated from the plan in Step 1

---

## Step 3: PHASE 1 — DISPATCH ARCHITECT

Generate a ready-to-paste prompt for the Architect agent:

```
📌 PHASE 1: PLANNING
Model: Claude (Tier 1) — see model_fallback.json for exact name
Paste this prompt into Agent Manager (Ctrl+E → New Task):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Insert populated architect.md prompt here with $MISSION, $AGENT_ID filled in]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After dispatching, wait for the Architect to complete.
Then review plan.md and come back here.
```

**⏸️ GATE**: Wait for user to confirm:
- "Architect completed. I've reviewed plan.md. Proceed to Phase 2."

---

## Step 4: PHASE 2 — DISPATCH DEVELOPERS

Generate prompts for all Developer agents (users dispatch in parallel):

```
📌 PHASE 2: IMPLEMENTATION
Dispatch these agents in parallel via Agent Manager:

━━━ Agent β (Backend Developer) — Gemini Pro ━━━
[Populated developer.md prompt with scope = /src/backend/**]

━━━ Agent γ (Frontend Developer) — Gemini Pro ━━━
[Populated developer.md prompt with scope = /src/frontend/**]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After ALL developers complete, come back here.
```

**⏸️ GATE**: Wait for user to confirm:
- "All developers completed. Proceed to Phase 3."

---

## Step 5: PHASE 3 — DISPATCH QA

Generate the QA agent prompt:

```
📌 PHASE 3: VERIFICATION
Model: Gemini Flash (Tier 3) — see model_fallback.json for exact name
Paste this prompt into Agent Manager:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated qa.md prompt]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After QA completes, come back here for the final report.
```

**⏸️ GATE**: Wait for user to confirm:
- "QA completed."

---

## Step 6: SYNTHESIZE

Read the final state of `swarm-manifest.md` and generate a report:

```markdown
## 🐝 Swarm Report

### Mission
[Original task]

### Agents
| ID | Role | Model | Status |
|----|------|-------|--------|
| α  | Architect | Claude (Tier 1) | ✅ |
| β  | Developer (Backend) | Gemini Pro (Tier 2) | ✅ |
| γ  | Developer (Frontend) | Gemini Pro (Tier 2) | ✅ |
| δ  | QA | Gemini Flash (Tier 3) | ✅ |

### Issues Found
[List from ## Issues, or "None"]

### Handoff Notes
[Key context from ## Handoff Notes]

### Deliverables
- [x] plan.md created
- [x] Implementation complete
- [x] QA verification done
- [ ] User final review

### Next Steps
[Any remaining work or cleanup]
```

---

## Quick Reference

| Shortcut | Action |
|----------|--------|
| `Ctrl+E` | Open Agent Manager |
| `New Task` | Create a new agent task |
| Model dropdown | Select model for the agent |
| Inbox | Check agent completion status |
