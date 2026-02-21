# Model Tag Team — Unified Agent Coordination

> **Multi-agent orchestration for Antigravity** — automatic model switching, supervised swarms, and cross-model consultation.

## The Problem

Coding with AI hits the same walls:
- **Context overflow** — the model forgets what it learned 500 messages ago
- **Reasoning loops** — stuck on the same bug, 5th attempt, same approach
- **Wrong model for the job** — using a heavy reasoner for formatting, or a speed model for architecture
- **Complex tasks need multiple agents** — but coordinating them is manual and error-prone

## The Solution

Model Tag Team is a **3-part coordination system** installed into your Antigravity environment:

| Part | What It Does | When To Use |
|------|-------------|-------------|
| **Handoff** | Context-aware model switching via structured manifests | Context filling up, reasoning loops |
| **Swarm** | Multi-agent decomposition with phased execution | Complex multi-file tasks |
| **Consultation** | Lightweight cross-model Q&A without losing context | Stuck on a specific problem |

### Escalation Ladder

When stuck, agents follow this progression (cheapest first):

```
1. Keep trying     — stuck for 1-2 attempts (free)
2. Consult         — stuck for 3+ attempts → ask a different model (low cost)
3. Handoff         — context filling up → generate manifest, switch model (medium)
4. Swarm           — multi-track work → decompose into parallel agents (high)
```

---

## Prerequisites

- [Antigravity](https://antigravity.dev) installed
- At least 2 models accessible (e.g., Claude Opus + Gemini Pro)

## Quick Start

```powershell
# Clone
git clone https://github.com/ryan-haver/model-tag-team.git
cd model-tag-team

# Install (Windows)
.\install.ps1

# Install (macOS/Linux)
chmod +x install.sh && ./install.sh

# Verify
# Open Antigravity and type: /health
```

## Uninstall

```powershell
# Windows
.\uninstall.ps1

# macOS/Linux
chmod +x uninstall.sh && ./uninstall.sh
```

---

## Architecture

### Three-Layer Loading

| Layer | File | How It Loads | Purpose |
|-------|------|-------------|---------|
| 1 | `GEMINI.md` | Automatically every session | Escalation ladder, session start checks |
| 2 | `SKILL.md` | On demand when triggered | Full protocols (handoff, swarm, consultation) |
| 3 | Workflows | On `/command` invocation | Step-by-step operational procedures |

### Model Fallback Chain

| Tier | Family | Codename | Strengths |
|------|--------|----------|-----------|
| 1 | Claude (Opus) | **The Architect** | Deep reasoning, subtle debugging, DRY principles |
| 2 | Gemini (Pro) | **The Context King** | Large context, multi-file scanning, cross-file patterns |
| 3 | Gemini (Flash) | **The Speed Specialist** | Fast iteration, simple tasks, docs, formatting |

> Exact model names (including versions) are configured in `model_fallback.json` and update as new versions ship.

### Task-Aware Routing

The system doesn't just escalate up/down tiers. It routes based on **what work remains**:

| Remaining Work | Route To | Why |
|----------------|----------|-----|
| Deep debugging, subtle bugs | Claude (Opus) | Step-by-step reasoning |
| Architecture, design decisions | Claude (Opus) | Careful tradeoff analysis |
| Large refactoring, multi-file | Gemini (Pro) | Huge context window |
| Docs, formatting, quick fixes | Gemini (Flash) | Speed over depth |

### Agent Roles (Swarm)

Nine pre-defined roles with model recommendations:

| Role | Default Model | Core Job |
|------|--------------|----------|
| **Project Manager** | Claude Sonnet | Scope, plan, assign, enforce spec |
| **Architect** | Claude Opus | Analyze codebase → write `plan.md` |
| **Developer** | Gemini Pro | Implement plan within scoped directories |
| **Debugger** | Claude Sonnet | Root cause analysis, targeted fixes |
| **QA** | Gemini Flash | Run tests, review diffs, report issues |
| **Code Reviewer** | Claude Sonnet | Review for quality, security, plan alignment |
| **DevOps** | Gemini Flash | Build verification, CI/CD checks |
| **Explorer** | Gemini Pro | Map codebase, discover patterns |
| **Researcher** | Gemini Pro | Web/drive research, source curation |

---

## Commands

| Command | Description |
|---------|------------|
| `/pivot` | Generate a handoff manifest and prepare for model switch |
| `/resume` | Read the active manifest and continue where the last model left off |
| `/swarm` | Decompose a task into a supervised multi-agent swarm |
| `/swarm-auto` | Rapid swarm — all agent prompts generated upfront |
| `/health` | Audit system status, model config freshness |

---

## Key Design Decisions

- **Version-resilient model references** — Protocol files use generic family names (Claude, Gemini Pro, Gemini Flash). Only `model_fallback.json` has version-specific names, making model updates a single-file edit.
- **Merge-safe install** — `GEMINI.md` and global gitignore are appended, never overwritten. Safe to re-run.
- **Task-aware routing** — Selects the best model for the *remaining work*, not just the next tier.
- **Model personas** — Each model gets behavioral instructions tuned to its strengths.
- **File claims** — Swarm agents must claim files before editing, preventing conflicts.
- **Phase gates** — Swarm execution is phased (Plan → Implement → Verify) with user approval at each gate.

---

## Manifest Structure

### Handoff Manifest

```markdown
## Session Header
Timestamp, outgoing model, incoming model, context usage %

## Routing Decision
Trigger type, remaining work classification, rationale

## Project State
Current objective, last successful action, active files, branch/commit, context summaries

## Bug Tracker
Pending issues, half-finished logic, known gotchas

## Reasoning Failure
What was tried, why each approach failed, suggested alternatives

## Handoff Instructions
Model persona, recovery checklist
```

### Swarm Manifest

```markdown
## Mission
Original user request

## Agents
Agent roster with roles, models, scope, status, phase

## File Claims
File-level locks to prevent conflicts

## Phase Gates
Phase completion checkboxes (Planning → Implementation → Verification)

## Issues
Problems found during execution with severity
```

---

## Project Structure

```
model-tag-team/
├── install.ps1                            ← Windows installer
├── install.sh                             ← macOS/Linux installer
├── uninstall.ps1                          ← Windows uninstaller
├── uninstall.sh                           ← macOS/Linux uninstaller
├── README.md                              ← This file
│
├── docs/
│   ├── CUSTOMIZATION.md                   ← Configuration guide
│   └── ROADMAP.md                         ← Unified roadmap (Phases 1A–5)
│
└── src/
    ├── GEMINI.md                          ← Layer 1 — global instructions
    ├── model_fallback.json                ← Model config with discovery info
    ├── gitignore-global                   ← Git protection for manifests
    │
    ├── skill/
    │   └── SKILL.md                       ← Layer 2 — full protocol (handoff + swarm + consultation)
    │
    ├── rules/
    │   ├── handoff.md                     ← Auto-trigger handoff rule
    │   └── context_compression.md         ← Auto-compression rule
    │
    ├── workflows/
    │   ├── pivot.md                       ← /pivot workflow
    │   ├── resume.md                      ← /resume workflow
    │   ├── health.md                      ← /health workflow
    │   ├── swarm.md                       ← /swarm workflow (supervised)
    │   └── swarm-auto.md                  ← /swarm-auto workflow (rapid)
    │
    └── templates/
        ├── handoff_manifest.md            ← Handoff manifest template
        ├── swarm-manifest.md              ← Swarm manifest template
        └── agent-prompts/                 ← 9 agent prompt templates
            ├── project-manager.md
            ├── architect.md
            ├── developer.md
            ├── debugger.md
            ├── qa.md
            ├── code-reviewer.md
            ├── devops.md
            ├── explorer.md
            └── researcher.md
```

---

## Roadmap

See [ROADMAP.md](docs/ROADMAP.md) for the full plan:

| Phase | Name | Status |
|-------|------|--------|
| **1A** | Core Merge (handoff + swarm) | 🔜 In Progress |
| **1B** | Enhanced Operations (supervision levels, presets) | Planned |
| **2A** | NotebookLM Integration (research & knowledge) | Planned |
| **2B** | Fusebase Integration (artifact storage) | Planned |
| **3** | Cockpit Quota Awareness | Planned |
| **4** | Direct Quota API | Future |
| **5** | Advanced Capabilities | Future |
