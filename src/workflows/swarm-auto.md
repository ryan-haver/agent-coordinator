---
description: Fast multi-agent swarm — generates ALL agent prompts upfront for rapid sequential dispatch via Agent Manager. No interactive phase gates.
metadata:
  name: "swarm-auto"
  scope: global
---

# Multi-Agent Swarm (Rapid Supervised)

You are now in **RAPID SWARM MODE**. Your task: break a complex project into agent-scoped work, generate the manifest and ALL agent prompts at once, so the user can dispatch them rapidly through Agent Manager.

## Task to Orchestrate
$ARGUMENTS

---

## How This Differs from `/swarm`

| | `/swarm` (supervised) | `/swarm-auto` (rapid) |
|---|---|---|
| Prompt generation | One phase at a time | ALL phases upfront |
| Phase gates | User confirms each | User dispatches sequentially |
| Speed | Slower, more control | Faster, less hand-holding |
| Best for | Critical/risky tasks | Familiar/well-scoped tasks |

---

## Step 1: ANALYZE + PLAN

Same analysis as `/swarm`:

1. Determine roles, scope boundaries, and models (optional roles: Explorer, Code Reviewer, Debugger)
2. Present the agent plan for quick confirmation:

```
⚡ Rapid Swarm for: [task summary]

Agents: α Architect (Claude) → β,γ Devs (Gemini Pro) → δ QA (Flash)
Scope:  β=/src/backend/**  γ=/src/frontend/**

Generate all prompts? (Y / adjust)
```

Wait for user confirmation.

---

## Step 2: GENERATE EVERYTHING

After confirmation, generate the manifest AND all prompts in one output:

### 2a. Write `swarm-manifest.md`
1. Use the `swarm-manifest.md` template from the `agent-coordination` skill's `templates/` directory
2. Write it to `swarm-manifest.md` in the project root
3. Fill in:
   - `$TIMESTAMP` → current timestamp
   - `$MISSION` → the original task from $ARGUMENTS
   - `## Agents` table → populated from key agents defined in Step 1

### 2b. Output ALL Agent Prompts

```
⚡ RAPID SWARM — ALL PROMPTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PHASE 1: Dispatch NOW
Agent: α Architect | Model: Claude (Tier 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated architect.md prompt]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PHASE 2: Dispatch AFTER Architect completes
Agent: β Backend Dev | Model: Gemini Pro (Tier 2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated developer.md prompt with backend scope]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent: γ Frontend Dev | Model: Gemini Pro (Tier 2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated developer.md prompt with frontend scope]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PHASE 3: Dispatch AFTER ALL Devs complete
Agent: δ QA | Model: Gemini Flash (Tier 3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated qa.md prompt]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2c. Dispatch Guide

```
🚀 DISPATCH ORDER:
1. Ctrl+E → New Task → paste α prompt → set Claude (Tier 1) → go
2. When α completes → New Task × 2 → paste β and γ → set Gemini Pro (Tier 2) → go
3. When β+γ complete → New Task → paste δ → set Gemini Flash (Tier 3) → go
4. When δ completes → come back here for report
```

---

## Step 3: FINAL REPORT

When user returns after all agents complete, read `swarm-manifest.md` and generate the same synthesis report as `/swarm` Step 6.

---

## Quick Reference

| Shortcut | Action |
|----------|--------|
| `Ctrl+E` | Open Agent Manager |
| `New Task` | Create a new agent task |
| Model dropdown | Select model for the agent |
| Inbox | Check agent completion status |
