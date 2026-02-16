---
description: Global Smart Handoff — monitors context usage, detects reasoning loops, and triggers automatic fallback-aware model handoffs
alwaysApply: true
---

# Global Smart Handoff Rule (Fallback-Aware)

## Model Fallback Chain
Read the fallback chain from `~/.antigravity-configs/model_fallback.json`:

| Tier | Model | Role |
|------|-------|------|
| 1 | `claude-opus-latest` | **The Architect** — deep reasoning, precision |
| 2 | `gemini-3-pro-high` | **The Context King** — large context, multi-file |
| 3 | `gemini-3-flash` | **The Speed Specialist** — fast iteration |

**Policies:**
- `on_context_limit: "handoff_and_resume"` — automatically generate manifest and handoff
- `on_reasoning_failure: "escalate"` — after 3 failed attempts, escalate to next tier
- `context_warning_threshold: 85%`

---

## Trigger 1: Context Saturation (≥85%)

Monitor for context overflow signals:
- Conversation history exceeding ~85% of estimated context window
- Multiple large files viewed or edited in session
- Repeated need to re-read files due to context eviction
- Loss of earlier context within the same conversation

### Automatic Action (No Manual /pivot Required)

When context saturation is detected:

1. **Stop current implementation immediately**
2. **Generate the handoff manifest** — fill out all fields in `~/.antigravity-configs/templates/handoff_manifest.md`
3. **Save manifest** to:
   - `<appDataDir>/brain/<conversation-id>/handoff_active.md` (artifact)
   - `~/.antigravity-configs/handoff_active.md` (global)
4. **Determine the fallback target** based on current model:

   | Current Model | Handoff To | Reason |
   |---------------|------------|--------|
   | Claude (Tier 1) | **Gemini 3 Pro** (Tier 2) | Context relief — Gemini has bigger window |
   | Gemini 3 Pro (Tier 2) | **Gemini 3 Flash** (Tier 3) | Even Gemini Pro is full — use Flash for fast completion |
   | Gemini 3 Flash (Tier 3) | **Claude** (Tier 1) | Cycle back — task may need deeper reasoning in fresh context |

5. **Alert the user:**
   ```
   ⚠️ AUTOMATIC HANDOFF — Context at ~{{PERCENT}}%

   📋 Manifest generated: handoff_active.md
   🤖 Current: {{CURRENT_MODEL}} ({{CURRENT_ROLE}})
   ➡️ Switch to: {{TARGET_MODEL}} ({{TARGET_ROLE}})

   To continue:
   1. Open a new chat
   2. Switch global model to {{TARGET_MODEL}}
   3. Type /resume
   ```

---

## Trigger 2: Reasoning Loop Detection

Track failed attempts at the same task. A **reasoning loop** is defined as:
- **3 or more consecutive failed attempts** at the same operation
- Repeated "let me try a different approach" without progress
- Generating multiple test scripts for the same bug without resolution
- Going back and forth on the same design decision

### Escalation Action

When a reasoning loop is detected:

1. **Acknowledge the loop explicitly:**
   ```
   🔁 Reasoning loop detected — {{ATTEMPT_COUNT}} failed attempts at: {{TASK_DESCRIPTION}}
   ```

2. **Determine escalation target** based on fallback chain:
   - If current model is **Flash** (Tier 3) → escalate to **Pro** (Tier 2)
   - If current model is **Pro** (Tier 2) → escalate to **Claude** (Tier 1)
   - If current model is **Claude** (Tier 1) → escalate to **Pro** (Tier 2) with explicit context about the reasoning difficulty

3. **Generate the manifest** with a `## Reasoning Failure` section:
   ```markdown
   ## Reasoning Failure
   - **Failed Task**: {{TASK}}
   - **Attempts**: {{COUNT}}
   - **Approaches Tried**: {{LIST}}
   - **Why Each Failed**: {{EXPLANATIONS}}
   - **Recommended Next Approach**: {{SUGGESTION}}
   ```

4. **Alert the user** with the escalation recommendation

---

## Trigger 3: Context Compression (Every ~50K Tokens)

To extend the primary model's useful context window:

1. **Monitor token accumulation** — roughly every 50,000 tokens of conversation
2. **Identify completed blocks** — finished tasks, resolved debugging, closed investigations
3. **Compress completed blocks** into a summary artifact:
   - Save as `<appDataDir>/brain/<conversation-id>/context_summary_{{N}}.md`
   - Include: what was accomplished, key decisions, file changes, remaining work
4. **Reference the summary** instead of re-reading the full history

> [!IMPORTANT]
> Never compress **active** work — only compress blocks that are fully resolved.
> The summary must preserve all information needed to continue the work.

---

## Important Behavioral Notes

- **Never silently degrade** — always alert the user before quality drops
- **Be specific in manifests** — the incoming model has zero prior context
- **Include absolute file paths** — every file that matters
- **Document gotchas** — anything non-obvious about current state
- **Track your own failures** — honestly count failed attempts
- This rule applies to **ALL conversations** regardless of project
