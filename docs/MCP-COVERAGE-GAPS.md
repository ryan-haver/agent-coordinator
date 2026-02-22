# MCP Server Coverage Gaps

> **Last updated:** 2026-02-22
> **Current coverage:** ~85% of agent lifecycle

This document tracks known gaps in MCP tool coverage — things agents or the coordinator need to do that aren't (yet) served by an MCP tool. These are candidates for future implementation.

---

## Gap 1: No tool to populate the Agents table

**Severity:** 🔴 Critical — blocks bootstrapping
**Who's affected:** Coordinator (swarm.md workflow)

`create_swarm_manifest` creates the manifest with an empty `## Agents` table. The coordinator then needs to add agent rows (ID, Role, Model, Phase, Scope, Status) but **no MCP tool writes rows** to this table. The coordinator must fall back to raw file editing.

**Current workaround:** Coordinator manually edits `swarm-manifest.md` to insert rows.

**Proposed fix:** New `add_agent_to_manifest` tool:
```
add_agent_to_manifest({
  agent_id: "α",
  role: "Developer",
  model: "gemini-2.5-pro",
  phase: "2",
  scope: "src/api/",
  workspace_root: "<path>"
})
```

---

## Gap 2: No tool to advance an agent's phase

**Severity:** 🟡 Medium — only matters for multi-phase agents
**Who's affected:** Coordinator

`update_agent_status` changes `Status` but not `Phase`. If an agent is reassigned from Phase 1 to Phase 2 (e.g., PM carries across phases), the coordinator must manually update the manifest.

**Current workaround:** Agents typically don't change phases. PM scope spans all phases inherently via the prompt.

**Proposed fix:** Extend `update_agent_status` to accept optional `phase` parameter.

---

## Gap 3: No quota / model routing via MCP

**Severity:** 🟡 Medium — manual script required
**Who's affected:** Coordinator (swarm.md Step 1.4)

The workflow instructs the coordinator to run `quota_check.ps1`/`.sh` in the terminal and read `quota_snapshot.json`. This is a shell-script-plus-file-read flow, not an MCP call.

**Current workaround:** Terminal command + file read by the coordinator.

**Proposed fix:** New `check_quota` tool that runs the quota check internally and returns the structured JSON. Alternatively, expose `quota_snapshot.json` as an MCP resource (`config://quota`).

---

## Gap 4: No "read my assignment" convenience tool

**Severity:** 🟢 Low — agents get scope in their prompt
**Who's affected:** Agents (if they need to re-read their scope mid-session)

Agents receive their scope via `$SCOPE` injection in the prompt. If they need to re-read it (e.g., after context compression), they must call `read_manifest_section("Agents")`, parse the JSON, and find their row by ID.

**Current workaround:** Call `read_manifest_section("Agents")` and self-filter.

**Proposed fix:** New `get_my_assignment` tool (or extend `read_manifest_section` with an `agent_id` filter):
```
get_my_assignment({ agent_id: "α", workspace_root: "<path>" })
→ { role: "Developer", scope: "src/api/", phase: "2", status: "🔄 Active" }
```

---

## Gap 5: No per-agent progress visibility

**Severity:** 🟢 Low — aggregate data available
**Who's affected:** Coordinator, PM agent

`get_swarm_status` returns the merged view of all agents but doesn't expose per-agent detail (specific file claims, issue list, handoff notes per agent). If the coordinator needs to see what Developer α specifically did vs Developer β, there's no tool for that.

**Current workaround:** Agent progress files exist on disk (`swarm-agent-*.json`), readable via standard file tools.

**Proposed fix:** New `get_agent_progress` tool:
```
get_agent_progress({ agent_id: "α", workspace_root: "<path>" })
→ { status, file_claims: [...], issues: [...], handoff_notes: "..." }
```

---

## Gap 6: No heartbeat / stale agent detection

**Severity:** 🟡 Medium — coordinator can't detect crashed agents
**Who's affected:** Coordinator (poll_agent_completion)

If an agent crashes or its session dies, its status stays `🔄 Active` forever. `poll_agent_completion` returns `last_updated` timestamps, so the coordinator *can* detect staleness manually, but there's no built-in TTL or timeout mechanism.

**Current workaround:** Coordinator checks `last_updated` in poll results and decides based on elapsed time. No automation.

**Proposed fix:** Add optional `stale_threshold_minutes` parameter to `poll_agent_completion` that auto-flags agents whose `last_updated` exceeds the threshold:
```
poll_agent_completion({ phase_number: "2", stale_threshold_minutes: 30 })
→ { ..., stale_agents: ["α"] }
```

---

## Gap 7: No tool to mark Phase Gates directly

**Severity:** 🟢 Low — rollup auto-checks gates now
**Who's affected:** Coordinator

Phase Gates are checkbox markdown (`- [ ] Phase 1 complete`). `rollup_agent_progress` now auto-checks gates when all agents in a phase are Complete. But there's no direct tool for the coordinator to manually check/uncheck a gate (e.g., to force-advance past a blocked phase).

**Current workaround:** `rollup_agent_progress` handles it automatically. Manual override requires file editing.

**Proposed fix:** New `update_phase_gate` tool:
```
update_phase_gate({ phase_number: "1", complete: true, workspace_root: "<path>" })
```

---

## Coverage Matrix

| Agent Action | MCP Tool | Status |
|-------------|----------|--------|
| Read previous context | `get_handoff_notes` | ✅ |
| Announce start | `update_agent_status` | ✅ |
| Read manifest section | `read_manifest_section` | ✅ |
| Check if file is claimed | `check_file_claim` | ✅ |
| Claim file before editing | `claim_file` | ✅ |
| Release file after editing | `release_file_claim` | ✅ |
| Report bugs/conflicts | `report_issue` | ✅ |
| Post notes | `post_handoff_note` | ✅ |
| Mark work complete | `update_agent_status` | ✅ |
| Read assignment/scope | prompt injection (`$SCOPE`) | ✅ (via prompt) |
| **Add agent to manifest** | — | ❌ Gap 1 |
| **Change agent phase** | — | ❌ Gap 2 |
| **Check model quota** | shell script | ⚠️ Gap 3 |
| **Re-read own assignment** | `read_manifest_section` + filter | ⚠️ Gap 4 |
| **View another agent's detail** | disk file read | ⚠️ Gap 5 |
| **Detect crashed agents** | manual timestamp check | ⚠️ Gap 6 |
| **Force-set phase gate** | — | ⚠️ Gap 7 |

| Coordinator Action | MCP Tool | Status |
|-------------------|----------|--------|
| Create manifest | `create_swarm_manifest` | ✅ |
| Generate agent prompt | `get_agent_prompt` | ✅ |
| Poll phase completion | `poll_agent_completion` | ✅ |
| Check phase gates | `check_phase_gates` | ✅ |
| Rollup agent work | `rollup_agent_progress` | ✅ |
| Full status dashboard | `get_swarm_status` | ✅ |
| Read handoff notes | `get_handoff_notes` | ✅ |
| **Add agents to roster** | — | ❌ Gap 1 |
| **Quota pre-check** | shell script | ⚠️ Gap 3 |
| **Force phase gate** | — | ⚠️ Gap 7 |
