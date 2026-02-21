---
description: Coordinate a multi-agent swarm with various supervision levels. Includes support for autonomous execution, phase gates, presets, and programmatic manifest management via MCP.
metadata:
  name: "swarm"
  scope: global
---

# Multi-Agent Swarm

You are now in **SWARM COORDINATOR MODE**. Your task is to break a complex project down into agent-scoped work, generate the manifest, and orchestrate the dispatch of agents based on the requested supervision level and presets.

Since you are the coordinator, you have access to the **agent-coordinator MCP tools** to orchestrate the swarm programmatically.

## Configuration
$ARGUMENTS

Extract the following from $ARGUMENTS:
1. **Task**: The core objective to be accomplished.
2. **Supervision Level**:
   - `--gates` = Level 2 (Gate Only: User approves between phases, agents run autonomous within phases)
   - `--review-end` = Level 3 (Review on Completion: Agents run full pipeline, user reviews at the end)
   - `--auto` = Level 4 (Full Autonomous: No gates, runs to completion, modifies VS Code settings)
   - *Default* = Level 1 (Full Supervision: User reviews plan, code, and phases)
3. **Preset**:
   - `--preset=bugfix`: Debugger → QA
   - `--preset=refactor`: Architect → Developer → Code Reviewer
   - `--preset=feature`: PM → Architect → 2 Devs → Code Reviewer → QA
   - `--preset=review`: Explorer → Code Reviewer
   - `--preset=spike`: Explorer → Researcher → Architect
   - *Default*: PM → Architect → Developer(s) → QA

---

## Step 1: INITIALIZE & PLAN

1. Read `config://models` via MCP to determine the exact model names to use for assignments.
2. Determine the agent roster based on the `Task` and `Preset` (if any).
3. If `--auto` is specified:
   - YOU MUST run the `auto_mode_toggle` script (located in `~/.gemini/antigravity/skills/agent-coordination/scripts/auto_mode_toggle.[ps1|sh]`) to backup and enable autonomous Antigravity settings.
4. Call MCP tool `create_swarm_manifest` with the `mission` and `supervision_level`.
5. Present the swarm plan to the user:

```
📋 Swarm Plan for: [task summary]
Mode: [Supervision Level]
Preset: [Preset Name or Custom]

Agents:
  α [Role]    → [Model]   → [Scope]
  β [Role]    → [Model]   → [Scope]
  ...

Phases:
  1. [Phase Name]:  α
  2. [Phase Name]:  β, γ
  ...
```

**⏸️ GATE (Level 1 only)**: For Level 1, ask "Does this look right?". For Levels 2, 3, 4, proceed immediately.

---

## Step 2: EXECUTION PIPELINE

For each phase in your plan, do the following:

### 2a. Dispatch Agents
For each agent in the current phase:
1. Call MCP `update_agent_status` to "🔄 Active".
2. Call MCP `get_agent_prompt` to generate the populated prompt.
3. If the supervision level is Level 2, 3, or 4 (or if instructing the user to dispatch in parallel), the branch strategy is:
   - Base branch: `swarm/<slug>`
   - Agent branch: `swarm/<slug>/<agent-id>` (for developers)
4. Output the dispatch block:

```
📌 PHASE [X]: [PHASE NAME]
Dispatch this agent via Agent Manager (Ctrl+E → New Task):
Model: [Model Name]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Prompt from get_agent_prompt]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Note on Auto Mode**: If `--auto` is specified, attempt to dispatch agents programmatically if the environment supports it, otherwise present the prompts cleanly for rapid human copy-paste.

### 2b. Await Completion & Verify Gates
1. You must wait for all agents in the current phase to finish.
2. Call MCP tool `check_phase_gates` with the current phase number.
3. If issues (`🔴 CONFLICT`, `🟠 BLOCKED`) are found via `get_swarm_status`:
   - Follow Error Recovery: 1. Auto-Retry → 2. `/consult` → 3. Replace → 4. Escalate to user.

**⏸️ GATE (Level 1 & 2)**: Wait for user to confirm the phase is complete before moving to the next phase ("Proceed to Phase [X+1]"). For Levels 3 and 4, proceed immediately if `check_phase_gates` is true.

---

## Step 3: SYNTHESIS & CLEANUP

Once the final phase is complete:

1. Call MCP tool `get_swarm_status` to gather the final state.
2. If `--auto` was used:
   - YOU MUST run the `auto_mode_toggle --restore` script to revert the user's Antigravity settings back to normal.
3. Generate the final Swarm Report:

```markdown
## 🐝 Swarm Output: [Task]

### Result
[Summary of what was achieved]

### Agents
[Table of agents, models, and final status based on `get_swarm_status`]

### Issues Found & Resolved
[List from issues tracking]

### Deliverables
- [x] Phase 1
- [x] Phase 2
...

### Next Steps
[Any manual setup, deployment, or follow-up tasks for the user]
```
