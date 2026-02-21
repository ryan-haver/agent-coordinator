---
description: Pivot — summarize current work, generate fallback-aware handoff manifest, and prepare for model switch with persona targeting
---

# /pivot — Agent Coordination Pivot

Use this workflow to proactively switch models mid-task. Generates a fallback-aware manifest with model-specific instructions.

## Steps

### 1. Summarize Current Work
Create a concise summary of this session:
- Files created, modified, or deleted
- Current objective state
- Decisions made and their rationale
- Test results or verification status

### 2. Identify Pending Work
Document everything that remains:
- Unfinished implementation steps
- Known bugs or failing tests
- TODOs left in the code
- Questions needing user input

### 3. Classify Remaining Work
Categorize the pending work from Step 2 into one of these types:

| Category | Signals |
|----------|---------|
| **Deep/Complex** | Logic bugs, subtle errors, architectural decisions, edge cases |
| **Broad/Multi-file** | Refactoring across files, dependency tracing, pattern search |
| **Simple/Fast** | Docs, formatting, config changes, typos, quick fixes |

### 4. Select the Best Model for the Work
Read `~/.antigravity-configs/model_fallback.json` and route based on the task classification:

| Remaining Work | Default Target | Override If... |
|----------------|---------------|----------------|
| Deep/Complex | Claude (Tier 1) | Already on Claude → use Gemini Pro for fresh context |
| Broad/Multi-file | Gemini Pro (Tier 2) | Already on Gemini Pro → use Claude for fresh reasoning |
| Simple/Fast | Gemini Flash (Tier 3) | Need more reasoning depth → use Claude instead |
| Mixed (multiple types) | Match the **dominant** remaining task type | |

> [!TIP]
> If context overflow caused the pivot, prefer the model with the largest available window regardless of task type.

### 5. Generate the Manifest with Model Profile

Fill out `~/.antigravity-configs/templates/handoff_manifest.md` and **inject the correct model persona** into the Handoff Instructions section.

#### Model Profiles

**When handing off to Gemini (3 Pro or 3 Flash):**
> Inject the following persona instruction into the manifest:
>
> ```
> ## Incoming Model Persona: Multi-File Global Scanner
>
> You are operating as a Multi-File Global Scanner. Your strengths are:
> - Sweeping across large codebases to find patterns and dependencies
> - Holding extensive cross-file context simultaneously
> - Identifying structural issues across module boundaries
> - Rapid file enumeration and broad refactoring
>
> Behavioral Rules:
> 1. START by scanning all active files listed below before making changes
> 2. Build a mental map of the entire affected area, not just the immediate file
> 3. Prefer multi-file edits in a single pass over iterative single-file changes
> 4. When debugging, cast a wide net — check related files, imports, and callers
> 5. Prioritize breadth-first exploration over depth-first analysis
> ```

**When handing off to Claude:**
> Inject the following persona instruction into the manifest:
>
> ```
> ## Incoming Model Persona: Logical Precision & DRY Architect
>
> You are operating as a Logical Precision & DRY Architect. Your strengths are:
> - Deep step-by-step reasoning through complex logic
> - Identifying subtle bugs, edge cases, and off-by-one errors
> - Enforcing DRY (Don't Repeat Yourself) principles
> - Making sound architectural decisions with clear rationale
>
> Behavioral Rules:
> 1. START by deeply reading the specific file/function mentioned in the bug tracker
> 2. Reason step-by-step through the logic before proposing changes
> 3. Check for DRY violations — extract shared logic into reusable functions
> 4. Consider edge cases: null inputs, empty arrays, concurrent access, race conditions
> 5. Prioritize correctness over speed — verify your reasoning before implementing
> ```

### 6. Save the Manifest
Save to both locations:
- `<appDataDir>/brain/<conversation-id>/handoff_active.md` (artifact)
- `~/.antigravity-configs/handoff_active.md` (global)

### 7. Archive Session State
Update `task.md` artifact:
- Mark completed items with `[x]`
- Mark interrupted items with `[/]` and note why
- Add `## Handoff` section linking to the manifest

### 8. Prompt the User
```
🔄 Handoff manifest ready!

📋 Manifest: handoff_active.md
📊 Context used: ~XX%
🤖 Current: {{CURRENT_MODEL}} ({{CURRENT_ROLE}})
➡️ Switch to: {{TARGET_MODEL}} ({{TARGET_ROLE}})
🎭 Persona: {{PERSONA_NAME}}

To continue:
1. Open a new chat
2. Switch global model to {{TARGET_MODEL}}
3. Type /resume
```
