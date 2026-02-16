# Global Smart Handoff — Context Monitoring

You have a Smart Handoff System installed as a skill at `~/.gemini/antigravity/skills/smart-handoff/SKILL.md`. 

**Always-on behavior:** If you notice your own context degrading (forgetting earlier decisions, needing to re-read files, repeating analysis, or failing 3+ times at the same task), read the `smart-handoff` skill and follow its handoff protocol. Do not wait for the user to notice — proactively flag it.

**Available commands:**
- `/pivot` — Proactively generate a handoff manifest and prepare for model switch
- `/resume` — Read the active handoff manifest and continue where the last model left off
