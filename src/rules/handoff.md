---
description: Agent Coordination — monitors context usage, detects reasoning loops, and triggers automatic fallback-aware model handoffs
alwaysApply: true
---

# Agent Coordination — Handoff Rule (Auto-Trigger)

> This rule watches for degradation signals and fires automatically. For the full handoff protocol, escalation ladder, and model routing, see the `agent-coordination` skill (`SKILL.md`).

## Trigger 1: Context Saturation (≥85%)

Monitor for context overflow signals:
- Conversation history exceeding ~85% of estimated context window
- Multiple large files viewed or edited in session
- Repeated need to re-read files due to context eviction
- Loss of earlier context within the same conversation

**When detected:**
1. Stop current implementation immediately
2. Follow the **Handoff Protocol** in the `agent-coordination` skill (Part 1)
3. Alert:
   ```
   ⚠️ AUTOMATIC HANDOFF — Context at ~{{PERCENT}}%
   📋 Manifest: handoff_active.md
   🤖 Current: {{CURRENT_MODEL}} ({{CURRENT_ROLE}})
   ➡️ Switch to: {{TARGET_MODEL}} ({{TARGET_ROLE}})
   ```

## Trigger 2: Error Recovery Protocol (3+ Failures)

Track failed attempts at the same task:
- 3+ consecutive failed attempts at the same operation
- Repeated "let me try a different approach" without progress
- Going back and forth on the same design decision

**When detected, strictly follow this 4-step recovery protocol:**
1. **Auto-Retry**: Retry the operation once with a fresh perspective, explicitly noting why the previous attempts failed.
2. **Consult**: If the retry fails, use `/consult` to generate a `consult_request.md` and ask a different model (e.g. Claude for logic, Gemini Pro for context) for advice. Apply the response.
3. **Replace/Handoff**: If the consultation fails to resolve the issue, execute a full handoff to a different model using the `handoff_active.md` manifest.
4. **Escalate**: If you are in autonomous mode (`--auto`), or if the replacement model also gets stuck, flag the task as `🔴 BLOCKED` in the manifest and stop for user intervention.

## Trigger 3: Context Compression (Every ~50K Tokens)

When conversation is long but work is still productive:
1. See the `context_compression` rule for full compression protocol
2. Note: `📦 Compressed completed work into context_summary_N.md`

## Important Notes

- **Never silently degrade** — always alert the user before quality drops
- **Be specific in manifests** — the incoming model has zero prior context
- **Track your own failures** — honestly count failed attempts
- This rule applies to **ALL conversations** regardless of project
