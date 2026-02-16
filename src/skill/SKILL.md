---
name: smart-handoff
description: Global Smart Handoff System — monitors context degradation, generates handoff manifests for model switching, and supports /pivot and /resume workflows. Activate at session start or when context degradation is noticed.
---

# Smart Handoff System

## Overview
This skill manages context-aware model switching via structured handoff manifests. It enables seamless work continuation across model switches by preserving project state, bug context, and model-specific instructions.

## Model Fallback Chain

| Tier | Model | Role | Best For |
|------|-------|------|----------|
| 1 | `claude-opus-latest` | **The Architect** | Deep reasoning, subtle debugging, DRY principles |
| 2 | `gemini-3-pro-high` | **The Context King** | Large context, multi-file scanning, cross-file patterns |
| 3 | `gemini-3-flash` | **The Speed Specialist** | Fast iteration, simple tasks, docs, formatting |

**Policies:**
- `on_context_limit` → handoff and resume
- `on_reasoning_failure` → escalate after 3 failed attempts

## Context Degradation Signals

Watch for these throughout every session:
- Conversation history becoming very long (many exchanges)
- Needing to re-read files you already viewed earlier
- Losing track of decisions made earlier in the conversation
- Repeating analysis you already performed
- 3+ failed attempts at the same task (reasoning loop)

## When Degradation Is Detected

### Step 1: Stop and Alert
```
⚠️ Context degradation detected — recommending handoff.
```

### Step 2: Generate Manifest
Read the template at `~/.antigravity-configs/templates/handoff_manifest.md` and fill in ALL fields with actual session data. Save to:
- Current conversation artifact dir as `handoff_active.md`
- `~/.antigravity-configs/handoff_active.md` (global)

### Step 3: Select Fallback Target

| Current Model | Handoff To | Reason |
|---------------|------------|--------|
| Claude (Tier 1) | Gemini 3 Pro (Tier 2) | Context relief |
| Gemini Pro (Tier 2) | Claude (Tier 1) | Fresh reasoning context |
| Gemini Flash (Tier 3) | Claude (Tier 1) | Task may need deeper reasoning |

For **reasoning loops** (3+ failures): always escalate UP a tier.

### Step 4: Inject Model Persona

**For Gemini targets:**
> Persona: Multi-File Global Scanner
> - Scan ALL active files before making changes
> - Build cross-file dependency maps
> - Prefer breadth-first multi-file edits
> - Cast a wide net when debugging

**For Claude targets:**
> Persona: Logical Precision & DRY Architect  
> - Deep-read specific files from bug tracker first
> - Reason step-by-step before proposing changes
> - Check for DRY violations
> - Consider all edge cases

### Step 5: Prompt the User
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

## Context Compression

When conversation gets long but work is still productive:
1. Identify fully-completed blocks (resolved bugs, finished edits, answered questions)
2. Compress into `context_summary_N.md` in the conversation artifact dir
3. Reference the summary instead of re-reading history
4. Note: `📦 Compressed completed work into context_summary_N.md`

## Reasoning Failure Escalation

When you detect you're looping (3+ failed attempts at same task):
1. Acknowledge it: `🔁 Reasoning loop detected — N failed attempts at: [task]`
2. Document in manifest under `## Reasoning Failure`: what was tried, why each failed
3. Escalate to next tier
4. The incoming model MUST read the failure section and NOT repeat the same approaches

## File Locations
- Template: `~/.antigravity-configs/templates/handoff_manifest.md`
- Active manifest: `~/.antigravity-configs/handoff_active.md`
- Fallback config: `~/.antigravity-configs/model_fallback.json`
- Archived manifests: `~/.antigravity-configs/handoff_[timestamp].md`
