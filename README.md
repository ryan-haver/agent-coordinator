# 🏷️ Model Tag Team

**A structured model-switching system for AI coding agents.**

One model taps out, the next one jumps in — with full context of what happened, what failed, and what to do next.

---

## The Problem

AI coding agents hit context limits. When they do, they degrade silently — forgetting earlier decisions, re-reading files, looping on the same bug. The typical recovery is to start a fresh session and manually re-explain everything. This is slow, lossy, and frustrating.

## The Solution

Model Tag Team creates a **structured handoff protocol** between AI models. When one model's context fills up or it gets stuck in a reasoning loop, it generates a **manifest** — a complete snapshot of project state, pending bugs, failed approaches, and model-specific instructions — then the user switches to a fresh model that picks up exactly where the last one stopped.

---

## Prerequisites

- [Google Antigravity](https://antigravity.dev) (any tier)
- Git (for global gitignore setup)
- At least 2 models available in your Antigravity model selector

## Quickstart

### 1. Install

**Windows (PowerShell):**
```powershell
git clone https://github.com/your-org/model-tag-team.git
cd model-tag-team
.\install.ps1
```

**macOS / Linux:**
```bash
git clone https://github.com/your-org/model-tag-team.git
cd model-tag-team
chmod +x install.sh && ./install.sh
```

### 2. Customize your models

Edit `src/model_fallback.json` to match your available models, then re-run the install script. See [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for full details.

### 3. Verify

In any Antigravity session:
```
You: /health
Agent: 🏥 All 6 components GREEN ✅
```

### 4. Use it

| Command | What It Does |
|---------|-------------|
| `/pivot` | Generate a handoff manifest and prepare to switch models |
| `/resume` | Read the active manifest and continue where the last model stopped |
| `/health` | Audit the system and report Green/Yellow/Red status per component |

```
Session 1 (Claude):
  Working on feature... context filling up...
  You: /pivot
  Agent: 📋 Manifest ready! Switch to Gemini 3 Pro.

Session 2 (Gemini):
  You: /resume
  Agent: ✅ Read manifest. Picking up from: [last action]. Shall I proceed?
```

### 5. Uninstall (if needed)

```powershell
.\uninstall.ps1
```

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: GEMINI.md (Always Loaded)                 │
│  "If you notice context degrading, read the         │
│   smart-handoff skill and follow its protocol."     │
├─────────────────────────────────────────────────────┤
│  Layer 2: smart-handoff SKILL.md (On Demand)        │
│  Full protocol: fallback chain, personas,           │
│  manifest generation, escalation rules              │
├─────────────────────────────────────────────────────┤
│  Layer 3: Workflows (User-Triggered)                │
│  /pivot  — Generate manifest, prepare switch        │
│  /resume — Read manifest, adopt persona, continue   │
│  /health — Audit all components                     │
└─────────────────────────────────────────────────────┘
```

**Why three layers?** Reliability through redundancy:

- **Layer 1** is guaranteed to load in every session (it's `GEMINI.md`). But it's intentionally minimal — just enough to point to the skill.
- **Layer 2** has the full protocol but only loads when relevant. This keeps token budget low in sessions that don't need it.
- **Layer 3** is explicit user commands — the most reliable mechanism because the user triggers it directly.

### Model Fallback Chain

| Tier | Model | Codename | Strengths |
|------|-------|----------|-----------|
| 1 | Claude Opus | **The Architect** | Deep reasoning, subtle debugging, DRY principles |
| 2 | Gemini 3 Pro High | **The Context King** | Large context, multi-file scanning, cross-file patterns |
| 3 | Gemini 3 Flash | **The Speed Specialist** | Fast iteration, simple tasks, docs, formatting |

### Model Personas

When switching models, the manifest includes a **persona** — behavioral instructions tailored to the incoming model's strengths:

**Gemini → Multi-File Global Scanner**
- Scan ALL active files before making changes
- Build cross-file dependency maps
- Prefer breadth-first multi-file edits
- Cast a wide net when debugging

**Claude → Logical Precision & DRY Architect**
- Deep-read specific files from bug tracker first
- Reason step-by-step before proposing changes
- Check for DRY violations
- Consider all edge cases

---

## File Map

### Deployed Locations

```
~/.gemini/
├── GEMINI.md                              ← Layer 1: global instruction (always loaded)
└── antigravity/
    ├── skills/
    │   └── smart-handoff/
    │       └── SKILL.md                   ← Layer 2: full handoff protocol
    └── .agent/
        └── workflows/
            ├── pivot.md                   ← /pivot command
            ├── resume.md                  ← /resume command
            └── health.md                  ← /health command

~/.antigravity-configs/
├── model_fallback.json                    ← Fallback chain config (3 tiers + policies)
├── templates/
│   └── handoff_manifest.md                ← Manifest template (filled during /pivot)
├── rules/
│   ├── handoff.md                         ← Fallback-aware handoff rule
│   └── context_compression.md             ← Auto-compression rule
└── workflows/
    ├── pivot.md                           ← Source copy of pivot workflow
    └── resume.md                          ← Source copy of resume workflow

~/.config/git/
└── ignore                                 ← Global gitignore (protects manifests from commits)
```

### Runtime Files (Generated)

```
~/.antigravity-configs/
├── handoff_active.md                      ← Active manifest (from last /pivot)
└── handoff_20260216_100000.md             ← Archived manifest (timestamped)

<conversation artifacts>/
├── handoff_active.md                      ← Per-conversation manifest copy
└── context_summary_1.md                   ← Compressed context (from long sessions)
```

---

## Design Decisions

### Why behavioral rules instead of programmatic enforcement?

AI models don't have access to their own token count. There's no API to query "how full is my context window?" So we use **heuristic signals** — the model monitors for re-reading files, forgetting decisions, and looping on tasks. This is imperfect but it's the only approach available without runtime instrumentation.

The `/pivot` command exists as the **reliable fallback** — when _you_ notice the model struggling, you can trigger the handoff manually. The self-monitoring is a bonus.

### Why manifests instead of shared memory?

AI sessions are isolated. There's no shared state between sessions unless you write it to disk. The manifest is a structured file that bridges sessions: the outgoing model writes it, the incoming model reads it. This is more reliable than hoping the model "remembers" because there's nothing _to_ remember — it's a cold start.

### Why model-specific personas?

Different models have different strengths. Telling Gemini to "think step by step" wastes its strength (broad context). Telling Claude to "scan all files first" wastes its strength (deep reasoning). The personas channel each model toward what it does best.

### Why three tiers instead of two?

Three tiers cover the full spectrum:
- **Tier 1 (Claude)**: When reasoning quality matters most
- **Tier 2 (Gemini Pro)**: When context size matters most
- **Tier 3 (Gemini Flash)**: When speed matters most (simple tasks, docs)

Most workflows bounce between Tier 1 and Tier 2. Tier 3 is for when you don't need either deep reasoning or huge context — just fast hands.

### Why a global gitignore?

Handoff manifests contain "thought traces" — internal reasoning, failed approaches, project state. These shouldn't leak into public repos. The global gitignore (`~/.config/git/ignore`) catches `handoff_active.md`, `handoff_*.md`, and `context_summary_*.md` across all projects automatically.

---

## Policies

Configured in `model_fallback.json`:

| Policy | Value | Meaning |
|--------|-------|---------|
| `on_context_limit` | `handoff_and_resume` | Auto-generate manifest when context fills |
| `on_reasoning_failure` | `escalate` | After N failures, escalate to next tier |
| `reasoning_failure_threshold` | `3` | Number of failed attempts before escalation |
| `context_warning_threshold_percent` | `85` | Estimated context % that triggers handoff |
| `context_compression_interval_tokens` | `50000` | Compress completed blocks every ~50K tokens |

---

## Manifest Structure

The handoff manifest captures everything the incoming model needs to start cold:

```markdown
## Session Header
Timestamp, outgoing model, incoming model, context usage %

## Project State
Current objective, last successful action, active files, branch/commit

## Bug Tracker
Pending issues, half-finished logic, known gotchas

## Reasoning Failure (if applicable)
Failed task, attempt count, approaches tried, why each failed

## Handoff Instructions
Model-specific persona and briefing

## Recovery Checklist
- [ ] Manifest read
- [ ] Files scanned
- [ ] Bugs acknowledged
- [ ] Ready to resume
```

---

## Limitations

| Limitation | Mitigation |
|------------|------------|
| Models can't read their own token count | Heuristic signals + manual `/pivot` fallback |
| Self-monitoring is imperfect | Layer 1 (GEMINI.md) provides a constant reminder |
| Manifests depend on outgoing model quality | Template enforces structure; critical fields can't be skipped |
| Personas are behavioral suggestions, not constraints | Reinforced through manifest AND skill instructions |

---

## Project Structure

```
model-tag-team/
├── README.md                  ← This file
├── install.ps1                ← Windows installer (PowerShell)
├── install.sh                 ← macOS/Linux installer (Bash)
├── uninstall.ps1              ← Windows uninstaller
├── docs/
│   └── CUSTOMIZATION.md       ← How to change models, personas, thresholds
└── src/                       ← All deployable source files
    ├── GEMINI.md              ← Layer 1: global instruction
    ├── model_fallback.json    ← 3-tier fallback chain config
    ├── gitignore-global       ← Global gitignore for manifest protection
    ├── skill/
    │   └── SKILL.md           ← Layer 2: full handoff protocol
    ├── templates/
    │   └── handoff_manifest.md ← Manifest template
    ├── rules/
    │   ├── handoff.md         ← Context monitoring rule
    │   └── context_compression.md ← Auto-compression rule
    └── workflows/
        ├── pivot.md           ← /pivot command
        ├── resume.md          ← /resume command
        └── health.md          ← /health audit command
```

---

## Further Reading

- [Customization Guide](docs/CUSTOMIZATION.md) — Change models, add personas, adjust thresholds
- [Skill Protocol](src/skill/SKILL.md) — Full handoff protocol with escalation rules
- [Manifest Template](src/templates/handoff_manifest.md) — What gets captured during `/pivot`
- [Fallback Config](src/model_fallback.json) — Tier definitions and policy thresholds

---

## License

MIT — Use it, fork it, adapt it for your own Antigravity setup.

