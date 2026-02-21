# Customization Guide

Model Tag Team ships with defaults tuned for a Claude + Gemini setup. Here's how to adapt it to your environment.

---

## Changing the Model Tiers

Edit `src/model_fallback.json` to match your available models.

### Example: Two-tier setup (Claude + Gemini only)

```json
{
  "model_fallback_chain": {
    "tiers": [
      {
        "tier": 1,
        "role": "The Architect",
        "model": "your-org/claude-sonnet-4",
        "strengths": ["Deep reasoning", "Debugging"],
        "use_when": "Complex logic, code review"
      },
      {
        "tier": 2,
        "role": "The Context King",
        "model": "your-org/gemini-2.5-pro",
        "strengths": ["Large context", "Multi-file scanning"],
        "use_when": "Context overflow, large refactoring"
      }
    ],
    "policies": {
      "on_context_limit": "handoff_and_resume",
      "on_reasoning_failure": "escalate",
      "reasoning_failure_threshold": 3,
      "context_compression_interval_tokens": 50000,
      "context_warning_threshold_percent": 85
    }
  }
}
```

### Example: Adding a fourth tier

```json
{
  "tier": 4,
  "role": "The Specialist",
  "model": "your-org/deepseek-coder-v3",
  "strengths": ["Code generation", "Language-specific expertise"],
  "use_when": "Highly specialized coding tasks"
}
```

After editing `model_fallback.json`, also update the fallback table in `src/skill/SKILL.md` to match.

---

## Adding Custom Personas

Personas live in two places:
1. `src/skill/SKILL.md` — the full protocol (Step 4)
2. `src/workflows/pivot.md` — the Model Profiles section

To add a new persona:

```markdown
**For [Your Model] targets:**
> Persona: [Persona Name]
> - [Behavioral rule 1]
> - [Behavioral rule 2]
> - [Behavioral rule 3]
> - [Behavioral rule 4]
```

Good personas play to the model's strengths. Examples:

| Model Strength | Persona Style |
|----------------|---------------|
| Large context | Scan broadly, multi-file edits, dependency mapping |
| Deep reasoning | Step-by-step analysis, edge cases, formal verification |
| Fast iteration | Quick fixes, parallel exploration, rapid prototyping |
| Code generation | Template expansion, boilerplate, schema-driven output |

---

## Adjusting Thresholds

In `model_fallback.json`:

| Setting | Default | Adjust When... |
|---------|---------|----------------|
| `reasoning_failure_threshold` | `3` | Lower to 2 if model loops quickly; raise to 5 if task is genuinely hard |
| `context_warning_threshold_percent` | `85` | Lower if you work with very large files; raise if sessions are usually short |
| `context_compression_interval_tokens` | `50000` | Lower for smaller context models; raise for Gemini Pro |

---

## GEMINI.md Customization

The global instruction in `src/GEMINI.md` is intentionally minimal. It contains just enough to:
1. Alert the model that the handoff system exists
2. Tell it to self-monitor for context degradation
3. Point to the skill for full details

If you want to add other global instructions, **append to GEMINI.md** rather than replacing it. The handoff pointer should always be present.

---

## MEMORY Rule (Automatic)

The install script deploys `GEMINI.md` to `~/.gemini/GEMINI.md`. Antigravity automatically loads this file as `MEMORY[GEMINI.md]` in every session — **no manual setup required**.

This gives every model, every session:
- Identity awareness (which tier/role it plays)
- Active manifest detection (checks for pending handoffs)
- Command knowledge (`/pivot`, `/resume`)

If you need to verify the MEMORY rule is active, check for `MEMORY[GEMINI.md]` in your Antigravity session's context.

---

## Task Routing Customization

The `task_routing` section in `model_fallback.json` maps work categories to models. You can customize these mappings to match your workflow:

```json
"task_routing": {
  "routes": {
    "deep_debugging": "claude-4-opus",
    "architecture_design": "claude-4-opus",
    "large_refactoring": "gemini-3-pro-image",
    "multi_file_scanning": "gemini-3-pro-image",
    "docs_formatting": "gemini-3-flash-image",
    "quick_fixes": "gemini-3-flash-image"
  }
}
```

Add new categories or reassign models as needed. The agent reads this file during `/pivot` to determine the best handoff target.

---

## Cross-Platform Notes

| Feature | Windows | macOS/Linux |
|---------|---------|-------------|
| Install script | `.\install.ps1` | `./install.sh` |
| Uninstall | `.\uninstall.ps1` | `./uninstall.sh` |
| Rules link | Junction (`mklink /J`) | Symlink (`ln -s`) |
| Home dir | `%USERPROFILE%` | `$HOME` |
| Config path | `~\.antigravity-configs\` | `~/.antigravity-configs/` |
| Path separators | `\` | `/` |

The skill, workflows, and configs use `~/` notation which both platforms resolve correctly at the AI agent level.
