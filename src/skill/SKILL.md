---
name: agent-coordination
description: "Unified Agent Coordination System — manages context-aware model switching (handoff), multi-agent swarm operations, and cross-model consultation. Provides /pivot, /resume, /health, /swarm, and /swarm-auto workflows."
---

# Unified Agent Coordination System

## Overview

This skill provides the complete coordination layer for multi-agent operations in Antigravity:

- **Handoff** — Context-aware model switching via structured manifests
- **Swarm** — Multi-agent decomposition with phased execution
- **Consult** — Lightweight cross-model collaboration when stuck
- **Routing** — Task-aware model selection from the fallback chain
- **MCP Server** — Programmatic manifest management via MCP tools

---

## Model Fallback Chain

Read exact model names from `~/.antigravity-configs/model_fallback.json`. Current tiers:

| Tier | Models | Role | Best For |
|------|--------|------|----------|
| 1 | Claude (Opus, Sonnet) | **The Architect** | Deep reasoning, architecture, subtle debugging |
| 1 | Claude (Sonnet) | **The Precision Specialist** | Code review, plan alignment, security analysis |
| 2 | Gemini Pro (High/Low) | **The Context King** | Large context, multi-file implementation, refactoring |
| 2 | GPT-OSS | **The Alternative** | Alternative reasoning, diverse perspective |
| 3 | Gemini Flash | **The Speed Specialist** | Fast iteration, simple tasks, docs, formatting |

> [!NOTE]
> Model versions change over time. Always check `model_fallback.json` for the exact model selector names.

---

## Escalation Ladder

When stuck, agents follow this progression (cheapest first):

| Situation | Action | Cost |
|-----------|--------|------|
| Stuck for 1-2 attempts | Keep trying | Free |
| Stuck for 3+ attempts | **Consult** another model | Low — focused question only |
| Context filling up | **Handoff** to fresh session | Medium — full manifest |
| Multi-track remaining work | **Swarm** to parallel agents | High — full decomposition |

---

## Part 1: Handoff Protocol

### Context Degradation Signals

Watch for these throughout every session:
- Conversation history becoming very long (many exchanges)
- Needing to re-read files you already viewed earlier
- Losing track of decisions made earlier in the conversation
- Repeating analysis you already performed
- 3+ failed attempts at the same task (reasoning loop)

### When Degradation Is Detected

#### Step 1: Stop and Alert
```
⚠️ Context degradation detected — recommending handoff.
```

#### Step 2: Generate Manifest
Read the template at `~/.antigravity-configs/templates/handoff_manifest.md` and fill in ALL fields with actual session data. Save to:
- Current conversation artifact dir as `handoff_active.md`
- `~/.antigravity-configs/handoff_active.md` (global)

#### Step 3: Select Fallback Target (Task-Aware)

Read `~/.antigravity-configs/model_fallback.json` and route based on **trigger type** and **remaining work**:

**Trigger-based override:**
| Trigger | Routing Rule |
|---------|-------------|
| Context overflow | → Model with largest context window (Gemini Pro) |
| Reasoning loop (3+ failures) | → Deepest reasoner (Claude), always escalate UP |

**Task-based routing** (for user-initiated `/pivot` or when no trigger override applies):
| Remaining Work Type | Route To | Why |
|---------------------|----------|-----|
| Deep debugging, subtle logic bugs | Claude | Step-by-step reasoning |
| Architecture, design decisions | Claude | Careful tradeoff analysis |
| Large refactoring across many files | Gemini Pro | Huge context window |
| Multi-file scanning, dependency tracing | Gemini Pro | Cross-file context |
| Docs, formatting, simple cleanup | Gemini Flash | Fast, don't need heavy reasoning |
| Quick fixes, config changes | Gemini Flash | Speed over depth |

#### Step 4: Inject Model Persona

**For Gemini targets:**
> Persona: Multi-File Global Scanner
> - Scan ALL active files before making changes
> - Build cross-file dependency maps
> - Prefer breadth-first multi-file edits

**For Claude targets:**
> Persona: Logical Precision & DRY Architect
> - Deep-read specific files from bug tracker first
> - Reason step-by-step before proposing changes
> - Check for DRY violations
> - Consider all edge cases

#### Step 5: Prompt the User
```
📋 Manifest: handoff_active.md
🤖 Current: [model] ([role])
➡️ Switch to: [target] ([role])
🎭 Persona: [persona name]

To continue:
1. Open a new chat
2. Switch global model to [target]
3. Type /resume
```

### Context Compression

When conversation gets long but work is still productive:
1. Identify fully-completed blocks (resolved bugs, finished edits, answered questions)
2. Compress into `context_summary_N.md` in the conversation artifact dir
3. Reference the summary instead of re-reading history
4. Note: `📦 Compressed completed work into context_summary_N.md`

### Reasoning Failure Escalation

When you detect you're looping (3+ failed attempts at same task):
1. Acknowledge it: `🔁 Reasoning loop detected — N failed attempts at: [task]`
2. Document in manifest under `## Reasoning Failure`: what was tried, why each failed
3. Escalate to next tier
4. The incoming model MUST read the failure section and NOT repeat the same approaches

---

## Part 2: Swarm Protocol

### The Swarm Manifest

The `swarm-manifest.md` file lives in the **project root** and is the single source of truth for all agents. Every agent MUST read it before starting work and update it when finishing.

#### Manifest Sections

| Section | Purpose | Who Writes |
|---------|---------|------------|
| `## Mission` | Original user request | `/swarm` workflow |
| `## Mode` | Supervision level and autonomous mode | PM agent |
| `## Agents` | Agent roster with roles, models, scope, status | PM agent + each agent |
| `## File Claims` | File-level locks to prevent conflicts | Each agent before editing |
| `## Phase Gates` | Phase completion checkboxes | Each agent on completion |
| `## Branches` | Git branch tracking per agent | Each agent |
| `## Handoff Notes` | Context for successor agents or recovery | Any agent |
| `## Issues` | Problems found during execution | QA agent or any agent |

Template: `~/.antigravity-configs/templates/swarm-manifest.md`

### Agent Roles

Nine pre-defined roles with model recommendations. Prompts are in `~/.antigravity-configs/templates/agent-prompts/`.

| Role | Default Model | File Access | Core Job |
|------|--------------|-------------|----------|
| **Project Manager** | Claude (Tier 1) | `*.md`, manifest, spec | Scope, plan, assign, enforce spec |
| **Architect** | Claude (Tier 1) | `*.md`, plan files only | Analyze codebase → write `plan.md`. No code edits. |
| **Developer** | Gemini Pro (Tier 2) | Scoped directories only | Implement plan. Update manifest on completion. |
| **Debugger** | Claude (Tier 1) | Scoped directories only | Root cause analysis, minimal targeted fixes. |
| **QA** | Gemini Flash (Tier 3) | Read-only + test commands | Run tests, review diffs, report issues in manifest. |
| **Code Reviewer** | Claude (Tier 1) | Read-only | Review diffs for quality, security, and plan alignment. |
| **DevOps** | Gemini Flash (Tier 3) | Build/CI files only | Build verification, linting, CI/CD checks. |
| **Explorer** | Gemini Pro (Tier 2) | Read-only | Map codebase, discover patterns, report in manifest. |
| **Researcher** | Gemini Pro (Tier 2) | Read-only + NLM tools | Web/drive research, source curation, knowledge queries. |

> [!NOTE]
> Model names above are generic families. Check `~/.antigravity-configs/model_fallback.json` for exact model selector names.

### Coordination Rules

These rules MUST be followed by every agent in the swarm:

#### 1. Manifest First
```
Before doing ANY work:
1. Read swarm-manifest.md
2. Find your row in ## Agents
3. Update your status to "🔄 Active"
```

#### 2. Claim Before Edit
```
Before editing ANY file:
1. Check ## File Claims in swarm-manifest.md
2. If the file is claimed by another agent → DO NOT EDIT
3. If unclaimed → add your claim row, then edit
```

#### 3. Stay In Scope
Each agent has a scope defined in `## Agents`. Only edit files within your scope. If you need to change a file outside your scope, add it to `## Issues`.

#### 4. Update Status On Completion
```
When your work is done:
1. Update your status in ## Agents to "✅ Complete"
2. Update your file claims to "✅ Done"
3. Check the ## Phase Gates checkbox if you're the last in your phase
4. Add any notes to ## Handoff Notes
```

#### 5. Report Conflicts and Issues
- File edited by another agent → `🔴 CONFLICT`
- Bug or design problem → `🟡 BUG` or `🟠 DESIGN`
- Can't complete scope → `🟠 BLOCKED`

#### 6. Handoff Integration
If you hit context limits mid-task, follow the Handoff Protocol (Part 1) AND add a row to `## Handoff Notes`.

### Phase Sequencing

```
Phase 1: PLANNING          → PM + Architect (+ optional Explorer, Researcher)
          ↓ user reviews spec.md + plan.md
Phase 2: IMPLEMENTATION    → Developer(s) in parallel
          ↓ all devs complete
Phase 3: VERIFICATION      → QA (+ optional Code Reviewer, DevOps)
          ↓ QA signs off
Done: PM reviews manifest and generates final report
```

### Cross-Project Knowledge (NotebookLM)

Each swarm project maintains a NotebookLM notebook. When starting a NEW project, PMs and Architects should query historical project notebooks for established patterns and decisions:

1. List available projects: `nlm notebook list`
2. Query an old project: `nlm notebook query <historical-project-alias> "What pattern was used for X?"`

This prevents the swarm from reinventing the wheel on every new initiative.

---

## Part 3: Consultation Protocol

When an agent is stuck (3+ attempts failed), before a full handoff:

1. Write `consult_request.md` in project root:
   - What you're trying to do
   - What you've tried (and why it failed)
   - Specific question for the other model
   - Key code snippets (minimal)

2. Recommend a model: logic bugs → Claude, broad context → Gemini Pro

3. The consultant reads ONLY `consult_request.md`, writes `consult_response.md`, and is done

4. The original agent reads the response and continues with full context intact

---

## Part 4: MCP Coordination Server

The `agent-coordinator` MCP server provides tools to programmatically manage the Swarm Manifest, allowing the AI to orchestrate the swarm directly rather than generating manual instructions. 

### Available MCP Tools

*   **`create_swarm_manifest`**: Initializes a new `swarm-manifest.md` for a project. (Req: `mission`)
*   **`read_manifest_section`**: Reads a specific table/section from the manifest (e.g. `Agents`, `File Claims`).
*   **`update_agent_status`**: Changes the status of an agent in the Agents table (e.g. to `✅ Complete`).
*   **`check_phase_gates`**: Validates if all agents assigned to a specific phase have completed their work.
*   **`claim_file`** / **`check_file_claim`** / **`release_file_claim`**: Manages file-level locks in the File Claims section to prevent conflicts between parallel agents.
*   **`get_agent_prompt`**: Retrieves and populates a role-specific prompt (e.g., Architect, Developer) with the mission and scope variables.
*   **`report_issue`**: Appends an issue to the Issues table (e.g. `🔴 CONFLICT`, `🟡 BUG`).
*   **`get_swarm_status`**: Summarizes the entire manifest state (agents, phase gates, issues) as a structured JSON object.

### Available MCP Resources

*   **`manifest://current`**: The live contents of the `swarm-manifest.md` in the current workspace.
*   **`config://models`**: The global `model_fallback.json` configuration for routing rules.

---

## File Locations

| File | Location |
|------|----------|
| Handoff manifest template | `~/.antigravity-configs/templates/handoff_manifest.md` |
| Swarm manifest template | `~/.antigravity-configs/templates/swarm-manifest.md` |
| Spec template | `~/.antigravity-configs/templates/spec.md` |
| Agent prompt templates | `~/.antigravity-configs/templates/agent-prompts/*.md` |
| Active handoff manifest | `~/.antigravity-configs/handoff_active.md` |
| Model fallback config | `~/.antigravity-configs/model_fallback.json` |
| Archived manifests | `~/.antigravity-configs/handoff_[timestamp].md` |
| Rules | `~/.antigravity-configs/rules/*.md` |
