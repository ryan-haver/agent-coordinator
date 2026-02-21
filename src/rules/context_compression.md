---
description: Automatic context compression — summarizes completed conversation blocks every ~50K tokens to preserve context window
alwaysApply: true
---

# Context Compression Rule

## Purpose
Automatically compress completed conversation blocks into summary artifacts to extend the primary model's useful context window. This prevents context eviction of important active-work information.

## When This Rule Activates

Monitor for context accumulation throughout every session. Trigger compression when:

1. **Token Threshold**: Approximately every **50,000 tokens** of conversation history (configurable via `context_compression_interval_tokens` in `model_fallback.json`)
2. **Task Completion**: When a major task or investigation is fully resolved
3. **Mode Transition**: When switching from one major task to another (e.g., debugging → implementation)

## What Qualifies as "Completed"

A conversation block is **safe to compress** when:
- ✅ A debugging investigation has reached a conclusion (fixed or abandoned)
- ✅ A file has been fully edited and verified
- ✅ A research question has been answered
- ✅ A test has been run and results recorded
- ✅ A plan has been written and approved

A conversation block is **NOT safe to compress** when:
- ❌ Work is actively in progress
- ❌ A decision is still pending user input
- ❌ A bug is partially diagnosed but not fixed
- ❌ Test results have not yet been verified

## Compression Format

Create a summary artifact at:
`<appDataDir>/brain/<conversation-id>/context_summary_{{N}}.md`

Where `{{N}}` is an incrementing counter (1, 2, 3...).

### Summary Template

```markdown
# Context Summary #{{N}}

**Compressed at**: {{TIMESTAMP}}
**Estimated tokens compressed**: ~{{TOKEN_COUNT}}
**Blocks covered**: {{BLOCK_DESCRIPTIONS}}

## Key Decisions
- {{DECISION_1}}: {{RATIONALE}}
- {{DECISION_2}}: {{RATIONALE}}

## Files Modified
| File | Changes | Status |
|------|---------|--------|
| `{{PATH}}` | {{WHAT_CHANGED}} | {{VERIFIED/PENDING}} |

## Completed Tasks
- [x] {{TASK_1}} — {{OUTCOME}}
- [x] {{TASK_2}} — {{OUTCOME}}

## Important Context to Preserve
> {{ANYTHING_THE_NEXT_SECTION_NEEDS_TO_KNOW}}

## Discarded Approaches
- {{APPROACH_1}}: Failed because {{WHY}}
```

## Behavioral Rules

1. **Never compress silently** — briefly note when compression happens:
   > 📦 Compressed ~50K tokens of completed work into `context_summary_1.md`

2. **Never lose information** — the summary must capture everything needed to continue

3. **Reference summaries when needed** — if you need older context, read the summary artifact instead of scrolling back through history

4. **Stack summaries** — if you need to compress again, create `context_summary_2.md`, etc.

5. **Update task.md** — note the compression in the task artifact for traceability

6. **Coordinate with handoff** — if a handoff is triggered, include all summary artifact paths in the manifest so the incoming model can read them
