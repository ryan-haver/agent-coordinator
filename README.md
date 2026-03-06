# Agent Coordinator — Unified Agent Coordination

> **Multi-agent orchestration for Antigravity** — automatic model switching, supervised swarms, and cross-model consultation.

## The Problem

Coding with AI hits the same walls:

- **Context overflow** — the model forgets what it learned 500 messages ago
- **Reasoning loops** — stuck on the same bug, 5th attempt, same approach
- **Wrong model for the job** — using a heavy reasoner for formatting, or a speed model for architecture
- **Complex tasks need multiple agents** — but coordinating them is manual and error-prone

## The Solution

Agent Coordinator is a **6-part coordination system** installed into your Antigravity environment:

| Part | What It Does | When To Use |
|------|-------------|-------------|
| **Handoff** | Context-aware model switching via structured manifests | Context filling up, reasoning loops |
| **Swarm** | Multi-agent decomposition with phased execution | Complex multi-file tasks |
| **Consultation** | Lightweight cross-model Q&A without losing context | Stuck on a specific problem |
| **NotebookLM** | Research brain — query knowledge, initiate deep research | Unfamiliar territory, knowledge gaps |
| **Fusebase** | Persistent artifact storage with dual-write to local | Deliverables, tracking, collaboration |
| **MCP Server** | Programmatic manifest management via 41 MCP tools | Automated coordination |

### Escalation Ladder

When stuck, agents follow this progression (cheapest first):

```
1. Keep trying     — stuck for 1-2 attempts (free)
2. Research        — unfamiliar territory or 2+ failures → query NLM (low)
3. Consult         — research didn't help, 3+ attempts → ask a different model (low)
4. Handoff         — context filling up → generate manifest, switch model (medium)
5. Swarm           — multi-track work → decompose into parallel agents (high)
```

---

## Prerequisites

- [Antigravity](https://antigravity.dev) installed
- At least 2 models accessible (e.g., Claude Opus + Gemini Pro)

## Quick Start

```powershell
# Clone
git clone https://github.com/ryan-haver/agent-coordinator.git
cd agent-coordinator

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

### Data Layer (Phase 5)

The MCP server uses a **three-backend architecture** — each backend is a soft dependency:

| Backend | Role | Port | Required? |
|---------|------|------|-----------|
| **SQLite** | Working memory — manifest, agents, file claims, progress | Embedded | Optional (file-based default) |
| **TimescaleDB** | Telemetry — tool call history, duration, success rates | 5433 | No — buffers to SQLite |
| **Qdrant** | Semantic memory — vector search across notes, code, docs | 6333 | No — tools return "not configured" |

```
MCP Client → Server Router → Telemetry Instrumentation → Handler → StorageAdapter
                                    ↓                                    ↓
                              SQLite Buffer                     File or SQLite backend
                                    ↓
                         TimescaleDB (if connected)
```

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
| `/consult` | Cross-model consultation without full handoff |
| `/status` | Swarm progress dashboard |
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
Model-specific briefings (context-heavy vs reasoning-heavy)

## Incoming Model Persona
Injected by /pivot — behavioral rules for the incoming model

## Recovery Checklist
Post-handoff verification steps
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
agent-coordinator/
├── install.ps1 / install.sh               ← Installers
├── uninstall.ps1 / uninstall.sh           ← Uninstallers
├── README.md                              ← This file
├── docker-compose.telemetry.yml           ← TimescaleDB + Qdrant services
├── .env.example                           ← All environment variables
│
├── docs/
│   ├── ARCHITECTURE.md                    ← System architecture & data flow
│   ├── TOOL-REFERENCE.md                  ← All 41 MCP tools (auto-generated)
│   ├── OPERATIONS.md                      ← Setup, Docker, troubleshooting
│   ├── DEVELOPER-GUIDE.md                 ← Adding tools, testing, patterns
│   ├── CUSTOMIZATION.md                   ← Configuration guide
│   ├── ROADMAP.md                         ← Unified roadmap (Phases 1A–6)
│   ├── manifest-reference.md              ← Swarm manifest sections
│   └── MCP-COVERAGE-GAPS.md               ← Tool coverage tracker
│
├── scripts/
│   └── integration-gate.ps1               ← Mandatory milestone gate
│
└── src/
    ├── GEMINI.md                           ← Layer 1 — global instructions
    ├── model_fallback.json                 ← Model config with discovery info
    ├── skill/ / rules/ / workflows/        ← Layers 2 & 3
    ├── templates/                          ← Manifest + agent prompt templates
    │
    └── mcp-server/                         ← MCP Coordination Server (41 tools)
        ├── package.json / tsconfig.json
        └── src/
            ├── index.ts                    ← Thin router + telemetry instrumentation
            ├── handlers/                   ← 10 domain handler modules + tool-definitions.ts
            │   ├── agents.ts               ← Agent lifecycle (9 tools)
            │   ├── manifest.ts             ← Manifest CRUD (3 tools)
            │   ├── files.ts                ← File claims (3 tools)
            │   ├── phases.ts               ← Phase gates (4 tools)
            │   ├── events.ts               ← Events & handoff notes (5 tools)
            │   ├── swarm.ts                ← Swarm lifecycle (4 tools)
            │   ├── memory.ts               ← Semantic memory (4 tools)
            │   ├── telemetry.ts            ← Telemetry queries (6 tools)
            │   ├── scope.ts                ← Scope negotiation (3 tools)
            │   └── quota.ts / fusebase.ts  ← Quota + Fusebase (4 tools)
            ├── storage/                    ← StorageAdapter + 2 implementations
            │   ├── adapter.ts              ← Interface + domain types
            │   ├── file-adapter.ts          ← File-based backend
            │   └── sqlite-adapter.ts        ← SQLite backend
            ├── telemetry/                  ← Dual-write telemetry pipeline
            │   └── client.ts               ← SQLite buffer + TSDB drain
            └── memory/                     ← Qdrant semantic memory
                ├── client.ts               ← MemoryClient + embeddings
                └── collections.ts          ← 4 collection definitions
```

---

## Roadmap

See [ROADMAP.md](docs/ROADMAP.md) for the full plan:

| Phase | Name | Status |
|-------|------|--------|
| **1A** | Core Merge (handoff + swarm) | ✅ Complete |
| **1B** | MCP Coordination Server | ✅ Complete |
| **1C** | Enhanced Operations (supervision, presets) | ✅ Complete |
| **2A** | NotebookLM Integration (research & knowledge) | ✅ Complete |
| **2B** | Fusebase Integration (artifact storage) | ✅ Complete |
| **3** | Cockpit Quota Awareness | ✅ Complete |
| **4** | Direct Quota API | ✅ Complete |
| **5A** | SQLite Storage Backend | ✅ Complete |
| **5B** | TimescaleDB Telemetry | ✅ Complete |
| **5C** | Qdrant Semantic Memory | ✅ Complete |
| **5D** | Documentation | ✅ Complete |
| **6** | Temporal RAG & CI | ✅ Complete |
