---
description: Fast multi-agent swarm — generates ALL agent prompts upfront for rapid sequential dispatch via Agent Manager. Inherits all supervision and preset flags from /swarm.
metadata:
  name: "swarm-auto"
  scope: global
---

# Multi-Agent Swarm (Rapid Mode)

You are now in **RAPID SWARM MODE**. Your task is to break a complex project down into agent-scoped work, generate the manifest using the MCP tools, and output **ALL** agent prompts at once for rapid human dispatch or automated execution, depending on the requested supervision level.

## Configuration
$ARGUMENTS

Extract the following from $ARGUMENTS, matching the logic of the standard `/swarm` command:
1. **Task**: The core objective to be accomplished.
2. **Supervision Level**:
   - `--gates` = Level 2 (Gate Only: User approves between phases, agents run autonomously within phases)
   - `--review-end` = Level 3 (Review on Completion: Agents run full pipeline, user reviews at the end)
   - `--auto` = Level 4 (Full Autonomous: No gates, no approvals, modifies VS Code settings)
   - *Default* = Level 1 (Full Supervision: User reviews plan, code, and phases)
3. **Preset**:
   - `--preset=bugfix`: Debugger → QA
   - `--preset=refactor`: Architect → Developer → Code Reviewer
   - `--preset=feature`: PM → Architect → 2 Devs → Code Reviewer → QA
   - `--preset=review`: Explorer → Code Reviewer
   - `--preset=spike`: Explorer → Researcher → Architect
   - *Default*: PM → Architect → Developer(s) → QA

---

## Step 1: PLAN AND INITIALIZE

1. Read `config://models` via MCP to determine the exact model names to use for assignments.
2. Determine the agent roster based on the `Task` and `Preset`, grouping them into logical Execution Phases.
3. If `--auto` is specified:
   - YOU MUST run the `auto_mode_toggle` script (located in `~/.gemini/antigravity/skills/agent-coordination/scripts/auto_mode_toggle.[ps1|sh]`) to backup and enable autonomous Antigravity settings.
4. Call MCP tool `create_swarm_manifest` with the `mission` and `supervision_level`.
5. Present the swarm plan for confirmation (ONLY IF Level 1 or 2 is used). If Level 3 or 4, proceed immediately.

```
⚡ Rapid Swarm for: [task summary]
Mode: [Supervision Level]
Preset: [Preset Name or Custom]

Agents: α Architect (Claude) → β,γ Devs (Gemini Pro) → δ QA (Flash)
Scope:  β=/src/backend/**  γ=/src/frontend/**
```

---

## Step 2: GENERATE ALL PROMPTS

Call MCP `get_agent_prompt` for every single agent defined in your roster. 

If the supervision level is Level 2, 3, or 4 (or if instructed to dispatch in parallel), the branch strategy is:
- Base branch: `swarm/<slug>`
- Agent branch: `swarm/<slug>/<agent-id>` (for developers)

Output the prompts grouped by phase:

```
⚡ RAPID SWARM — ALL PROMPTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PHASE 1: [Phase Name] (Dispatch NOW)
Agent: α [Role] | Model: [Model Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated prompt from get_agent_prompt]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PHASE 2: [Phase Name] (Dispatch AFTER Phase 1 completes)
Agent: β [Role] | Model: [Model Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Populated prompt from get_agent_prompt]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
...
```

---

## Step 3: COMPLETION / CLEANUP

If `--auto` was used, ensure the final agent (`QA` or `PM`) is instructed to run `auto_mode_toggle --restore` in their prompt to revert the user's Antigravity settings back to normal once the swarm finishes. 

Since you generated all the prompts up front, your job as the coordinator is done. The human user (or the `--auto` orchestrator) will take it from here.
