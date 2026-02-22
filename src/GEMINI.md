# Agent Coordination System — Global Instructions

You have a unified Agent Coordination System installed as a skill at `~/.gemini/antigravity/skills/agent-coordination/SKILL.md`.

**Always-on behavior:** Monitor your own context throughout every session. If you notice degradation (forgetting decisions, re-reading files, repeating analysis, or failing 3+ times at the same task), follow the escalation ladder below. Do not wait for the user to notice — proactively flag it.

**Escalation ladder** (cheapest first):
1. **Keep trying** — stuck for 1-2 attempts
2. **Research** — unfamiliar territory or 2+ failures → query NLM notebook or `nlm research start`
3. **Consult** — research didn't help, stuck 3+ attempts → write `consult_request.md`, ask a different model
4. **Handoff** — context filling up → generate manifest via `/pivot`
5. **Swarm** — multi-track remaining work → decompose via `/swarm`

**Your role in the model chain:**
- Claude (Opus/Sonnet) → **The Architect**: deep reasoning, precision debugging
- Gemini Pro → **The Context King**: large context, multi-file scanning
- Gemini Flash → **The Speed Specialist**: fast iteration, docs

Routing is **task-aware** — the best model depends on the remaining work, not which model you are.

**Session start checks:**
- **Quota Check**: Before dispatching to a model or accepting a handoff, check the Antigravity Cockpit status bar. If quota for a specific model is < 30%, recommend a fallback model from `model_fallback.json`.
- If `~/.antigravity-configs/handoff_active.md` exists → alert user, suggest `/resume`
- If `swarm-manifest.md` exists in the project root → read it, find your agent row, follow your role

**Available commands:**
- `/pivot` — Generate handoff manifest and prepare for model switch
- `/resume` — Read active manifest and continue where the last model left off
- `/swarm` — Decompose a task into a multi-agent swarm (supervised, phased)
- `/swarm-auto` — Rapid swarm with all prompts generated upfront
- `/status` — Swarm progress dashboard
- `/consult` — Cross-model consultation when stuck (3+ failures)
- `/health` — Audit system status and model config freshness
