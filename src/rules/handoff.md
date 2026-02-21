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

## Trigger 2: Reasoning Loop Detection (3+ Failures)

Track failed attempts at the same task:
- 3+ consecutive failed attempts at the same operation
- Repeated "let me try a different approach" without progress
- Going back and forth on the same design decision

**When detected:**
1. Acknowledge: `🔁 Reasoning loop detected — {{N}} failed attempts at: {{TASK}}`
2. Follow the **Escalation Ladder** in the `agent-coordination` skill
3. Document failures in the manifest `## Reasoning Failure` section

## Trigger 3: Context Compression (Every ~50K Tokens)

When conversation is long but work is still productive:
1. See the `context_compression` rule for full compression protocol
2. Note: `📦 Compressed completed work into context_summary_N.md`

## Important Notes

- **Never silently degrade** — always alert the user before quality drops
- **Be specific in manifests** — the incoming model has zero prior context
- **Track your own failures** — honestly count failed attempts
- This rule applies to **ALL conversations** regardless of project
