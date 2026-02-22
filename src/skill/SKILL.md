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

The `swarm-manifest.md` is the single source of truth for a swarm. Key sections:

| Section | Purpose |
|---------|---------|
| `## Mission` | The task objective |
| `## Mode` | Supervision level and auto-merge settings |
| `## Quota Check` | Model quota snapshot at swarm start |
| `## Notebook` | **NotebookLM project notebook** — ID, alias, source limits. Agents query this for context: `nlm notebook query <alias> "<question>"` |
| `## Fusebase` | **Fusebase deliverables platform** — workspace URL, project folder ID, task board URL. Agents write deliverables here (or to `swarm-docs/` if unavailable) |
| `## Agents` | Agent assignments with ID, Role, Model, Scope, Status, Phase |
| `## File Claims` | File-level locking to prevent edit conflicts |
| `## Phase Gates` | Checkboxes for phase completion verification |
| `## Handoff Notes` | Inter-agent messages and context transfer |
| `## Branches` | Git branch tracking per agent |
| `## Issues` | Bug/conflict/design concern tracker |

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

These rules MUST be followed by every agent in the swarm. **Use MCP tools — do NOT manually edit the manifest.**

#### 1. Announce on Start
Call `update_agent_status` with `status: "🔄 Active"` and your `agent_id` before doing any work.

#### 2. Claim Before Edit
Call `claim_file` with the file path before editing. If it fails (already claimed), do NOT edit — call `report_issue` instead.

#### 3. Stay In Scope
Each agent has a scope defined in `## Agents`. Only edit files within your scope. If you need a file outside your scope, call `report_issue` with severity `🟠 BLOCKED`.

#### 4. Release and Complete
When done editing a file, call `release_file_claim` with `status: "✅ Done"`. When all work is finished, call `update_agent_status` with `status: "✅ Complete"`.

#### 5. Report Conflicts and Issues
Call `report_issue` with appropriate severity:
- `🔴 CONFLICT` — file edited by another agent
- `🟡 BUG` — functional bugs discovered
- `🟠 DESIGN` — design problems or deviations
- `🟠 BLOCKED` — can't complete scope
- `🟢 NITPICK` — minor style/quality issues

#### 6. Communicate via Handoff Notes
Call `post_handoff_note` to leave context for successor agents (e.g., API changes, important decisions). Call `get_handoff_notes` to read notes from previous phases.

#### 7. Handoff Integration
If you hit context limits mid-task, follow the Handoff Protocol (Part 1) AND call `post_handoff_note` with your current state.

#### 8. Autonomous Execution Within Scope
When operating in a scoped, speced swarm, agents are **trusted to act without human approval**:

- **Run commands freely**: Build, test, lint, and git commands within the workspace are safe to auto-run. Do NOT ask for permission.
- **Edit files freely**: Files within your assigned scope may be created, modified, or deleted without confirmation.
- **Follow CI/CD**: Before marking yourself `✅ Complete`, ensure: build passes, tests pass, changes are committed.
- **Human pause points**: Stop for human input ONLY at phase gates when the supervision level requires it (Level 1 and 2). Within a phase, execute fully without pause.
- **Scope boundaries are hard boundaries**: You may NOT run destructive commands outside your scope or edit files claimed by another agent.

> [!IMPORTANT]
> The `## Autonomous Execution` section in each agent prompt defines the exact command allowlist and CI/CD checkpoint for that role. Always follow your role-specific instructions.

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

### Project Tracking & Docs (Fusebase)

While NotebookLM serves as the "brain," Fusebase serves as the "filing cabinet." 
Every swarm creates a Project Folder in Fusebase containing its Spec, Architecture Plan, Implementation Notes, Test Results, and a Kanban Task Board.

**Standard Tracking Tags:**
- `#swarm`: All pages created by agents
- State: `#active`, `#completed`, `#archived`
- Document Type: `#spec`, `#plan`, `#qa`, `#review`
- Author: `#agent-[role]` (e.g. `#agent-qa`, `#agent-architect`)

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

### Available MCP Tools (32 total)

#### Core Lifecycle
| Tool | Purpose |
|------|---------|
| `create_swarm_manifest` | Initialize a new `swarm-manifest.md` (session-scoped) |
| `complete_swarm` | Finalize swarm: rollup, archive, report, deregister, cleanup |
| `advance_phase` | Atomically validate gate, rollup progress, advance to next phase |

#### Manifest Read/Write
| Tool | Purpose |
|------|---------|
| `read_manifest_section` | Read a specific table/section as JSON |
| `set_manifest_field` | Set a table in a manifest section (e.g. Quota Check, Branches) |

#### Agent Management
| Tool | Purpose |
|------|---------|
| `update_agent_status` | Set an agent's status (e.g. `🔄 Active`, `✅ Complete`) |
| `add_agent_to_manifest` | Add a new agent row to the Agents table |
| `remove_agent_from_manifest` | Remove an agent from the Agents table |
| `update_agent_in_manifest` | Update an agent's Role, Model, or Scope |
| `mark_agent_failed` | Mark failed, release claims, auto-post handoff note |
| `reassign_agent` | Transfer scope and pending work to a replacement agent |
| `get_my_assignment` | Get a specific agent's row from the manifest |
| `get_agent_progress` | Get detailed progress (status, claims, issues, notes) |
| `get_agent_prompt` | Generate a populated prompt for an agent role |

#### File Claims
| Tool | Purpose |
|------|---------|
| `claim_file` | Register a file claim before editing (atomic) |
| `check_file_claim` | Check if a file is already claimed |
| `release_file_claim` | Release a file claim after editing |

#### Communication
| Tool | Purpose |
|------|---------|
| `post_handoff_note` | Post an inter-agent message (visible to all) |
| `get_handoff_notes` | Read all handoff notes (manifest + agent files) |
| `report_issue` | Report a bug, conflict, or design concern |
| `broadcast_event` | Broadcast a structured event (build_broken, api_changed, etc.) |
| `get_events` | Retrieve broadcast events, optionally filtered by type |

#### Monitoring & Gates
| Tool | Purpose |
|------|---------|
| `get_swarm_status` | Full manifest summary: agents, gates, issues, notes |
| `poll_agent_completion` | Check if all agents in a phase have finished |
| `rollup_agent_progress` | Merge agent progress files into the manifest |
| `check_phase_gates` | Check if a specific phase gate is complete |
| `update_phase_gate` | Manually check/uncheck a phase gate checkbox |

#### Scope Management
| Tool | Purpose |
|------|---------|
| `request_scope_expansion` | Request permission to edit a file outside assigned scope |
| `grant_scope_expansion` | Approve a pending scope expansion request |
| `deny_scope_expansion` | Deny a pending scope expansion request |

#### System
| Tool | Purpose |
|------|---------|
| `list_active_swarms` | List all active swarms across all workspaces |
| `check_quota` | Read the current model quota snapshot |

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
