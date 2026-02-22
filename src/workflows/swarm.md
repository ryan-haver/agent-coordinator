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
4. **Quota Pre-check**: Run `~/.gemini/antigravity/skills/agent-coordination/scripts/quota_check.ps1` (or `.sh` on mac/linux) in the terminal. Read the output `quota_snapshot.json` to get the real-time Cockpit quota percentages.
   - If the output contains `"status": "unavailable"`, skip quota-based routing and use defaults from `model_fallback.json`.
   - Otherwise, if any core model is < 30%, explicitly auto-route those assignments to fallback models (`model_fallback.json`).
5. Call MCP tool `create_swarm_manifest` with `mission`, `supervision_level`, and `workspace_root` set to the current project root directory. Explicitly populate the `## Quota Check` table in the manifest with the metrics you just read from the JSON.
6. Present the swarm plan to the user:

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
1. Call MCP `get_agent_prompt` (with `workspace_root`, `role`, `mission`, `scope`, `agent_id`) to generate the populated prompt. The agent will set its own status to Active on start.
2. Dispatch the agent using one of these strategies:

**Option A: Multi-Task UI** — If your editor supports parallel agent tasks (Agent Manager, Ctrl+E → New Task, or similar), open a new task:
```
📌 PHASE [X]: [PHASE NAME]
Model: [Model Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Prompt from get_agent_prompt]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Option B: Sequential Manual** — If no multi-task UI exists, present the prompt to the user. The user will create a new chat/session, paste the prompt, and confirm when the agent is done.

**Option C: `--auto` Mode** — For full autonomous mode, attempt CLI dispatch if available, otherwise present all prompts cleanly for rapid copy-paste.

### 2b. Poll for Completion, Roll Up & Verify Gates
1. **Poll for completion:** Call MCP `poll_agent_completion` (with `workspace_root` and `phase_number`) to check if all agents in this phase are done. If not all complete, wait and poll again. On Level 1/2, you may ask the user to confirm instead.
2. Call MCP `rollup_agent_progress` (with `workspace_root`) to merge all per-agent progress files into the manifest.
3. Call MCP tool `check_phase_gates` (with `workspace_root`) with the current phase number.
4. If issues (`🔴 CONFLICT`, `🟠 BLOCKED`) are found via `get_swarm_status`:
   - Follow Error Recovery: 1. Auto-Retry → 2. `/consult` → 3. Replace → 4. Escalate to user.

> [!NOTE]
> **CI/CD expectation**: Each agent with code-editing permissions (Developer, Debugger, DevOps, QA) is instructed to build, test, and commit before marking complete. If `poll_agent_completion` shows an agent complete, their CI/CD checkpoint has passed.

**⏸️ GATE (Level 1 & 2)**: Wait for user to confirm the phase is complete before moving to the next phase ("Proceed to Phase [X+1]"). For Levels 3 and 4, proceed immediately if `check_phase_gates` is true.

---

## Step 3: SYNTHESIS & CLEANUP

Once the final phase is complete:

1. Call MCP `rollup_agent_progress` (with `workspace_root`) for a final merge of all agent progress into the manifest.
2. Call MCP tool `get_swarm_status` (with `workspace_root`) to gather the final state.
3. Call MCP `complete_swarm` (with `workspace_root`) to finalize the swarm: archives the manifest, generates `swarm-report.md`, cleans up agent files, deregisters from the swarm registry.
4. If `--auto` was used:
   - YOU MUST run the `auto_mode_toggle --restore` script to revert the user's Antigravity settings back to normal.
5. Generate the final Swarm Report:

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
