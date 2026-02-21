---
description: Agent Coordination — monitors context usage, detects reasoning loops, and triggers automatic fallback-aware model handoffs
alwaysApply: true
---

# Agent Coordination — Handoff Rule (Fallback-Aware)

## Model Fallback Chain
Read exact model names from `~/.antigravity-configs/model_fallback.json`:

| Tier | Family | Role |
|------|--------|------|
| 1 | Claude (Opus) | **The Architect** — deep reasoning, precision |
| 2 | Gemini (Pro) | **The Context King** — large context, multi-file |
| 3 | Gemini (Flash) | **The Speed Specialist** — fast iteration |

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
4. **Determine the fallback target** using task-aware routing:

   Read `~/.antigravity-configs/model_fallback.json` for the `task_routing` section.

   **For context overflow (this trigger):**
   | Current Model | Default Handoff | Override If... |
   |---------------|----------------|----------------|
   | Claude (Tier 1) | **Gemini Pro** (Tier 2) | Remaining work is simple → use Flash |
   | Gemini Pro (Tier 2) | **Claude** (Tier 1) | Fresh reasoning in smaller window |
   | Gemini Flash (Tier 3) | **Gemini Pro** (Tier 2) | Need more context headroom |

   **Classify remaining work and adjust:**
   | Remaining Work Type | Best Target |
   |---------------------|-------------|
   | Deep debugging, logic bugs | Claude |
   | Large refactoring, multi-file | Gemini Pro |
   | Docs, formatting, quick fixes | Gemini Flash |

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
   - If current model is **Pro** (Tier 2) → escalate to **Claude** (Tier 1) for deeper reasoning
   - If current model is **Claude** (Tier 1) → hand off to **Pro** (Tier 2) for fresh perspective with larger context window (Claude is already the deepest reasoner — a different model may see the problem differently)

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
