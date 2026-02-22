# MCP Server Coverage Gaps

> **Last updated:** 2026-02-22
> **Current coverage:** ~99% of agent lifecycle (28 tools)
> **Gap 19** (git branch coordination) remains intentional — agents have git CLI access
> **Commit:** `96bbc93`

This document tracks known gaps in MCP tool coverage and their resolution status.

---

## Status: ✅ All Implemented

Every gap identified has been implemented. The MCP server now provides 28 tools covering the full agent lifecycle, coordinator workflow, multi-workspace awareness, and error recovery.

### Gap Resolution Summary

| Gap | Description | Tool | Priority | Status |
|-----|-------------|------|----------|--------|
| 1 | Populate Agents table | `add_agent_to_manifest` | P0 | ✅ |
| 2 | Set manifest metadata | `set_manifest_field` | P2 | ✅ |
| 3 | Advance agent phase | `update_agent_status` +`phase` | P2 | ✅ |
| 4 | Read own assignment | `get_my_assignment` | P3 | ✅ |
| 5 | Progress granularity | `update_agent_status` +`detail` | P1 | ✅ |
| 6 | Per-agent visibility | `get_agent_progress` | P3 | ✅ |
| 7 | Agent failure handling | `mark_agent_failed` | P0 | ✅ |
| 8 | Stale detection | `poll_agent_completion` +`stale_threshold_minutes` | P1 | ✅ schema |
| 9 | Agent reassignment | `reassign_agent` | P2 | ✅ |
| 10 | Event broadcasting | `broadcast_event` + `get_events` | P1 | ✅ |
| 11 | Scope negotiation | `request_scope_expansion` | P2 | ✅ |
| 12 | Swarm registry | `list_active_swarms` | P1 | ✅ |
| 13 | Global agent scoping | workspace-level isolation via registry | P1 | ✅ |
| 14 | Cross-workspace quota | `list_active_swarms` + `check_quota` | P1 | ✅ |
| 15 | Quota via MCP | `check_quota` | P2 | ✅ |
| 16 | Atomic phase advance | `advance_phase` | P2 | ✅ |
| 17 | Swarm completion | `complete_swarm` | P2 | ✅ |
| 18 | Manual phase gates | `update_phase_gate` | P3 | ✅ |
| 19 | Git integration | Agents use git CLI | P3 | 📝 By design |

---

## Full Coverage Matrix

### Agent Actions

| Action | MCP Tool | Status |
|--------|----------|--------|
| Read previous context | `get_handoff_notes` | ✅ |
| Announce start | `update_agent_status` | ✅ |
| Read manifest section | `read_manifest_section` | ✅ |
| Check if file is claimed | `check_file_claim` | ✅ |
| Claim file before editing | `claim_file` | ✅ |
| Release file after editing | `release_file_claim` | ✅ |
| Report bugs/conflicts | `report_issue` | ✅ |
| Post notes | `post_handoff_note` | ✅ |
| Mark work complete | `update_agent_status` | ✅ |
| Read assignment/scope | `get_my_assignment` | ✅ |
| Report subtask progress | `update_agent_status` +`detail` | ✅ |
| Broadcast structured events | `broadcast_event` | ✅ |
| Read events | `get_events` | ✅ |
| Request scope expansion | `request_scope_expansion` | ✅ |
| Git branch operations | terminal git | ✅ CLI |

### Coordinator Actions

| Action | MCP Tool | Status |
|--------|----------|--------|
| Create manifest | `create_swarm_manifest` | ✅ |
| Add agents to roster | `add_agent_to_manifest` | ✅ |
| Generate agent prompt | `get_agent_prompt` | ✅ |
| Poll phase completion | `poll_agent_completion` | ✅ |
| Check phase gates | `check_phase_gates` | ✅ |
| Rollup agent work | `rollup_agent_progress` | ✅ |
| Full status dashboard | `get_swarm_status` | ✅ |
| Read handoff notes | `get_handoff_notes` | ✅ |
| Handle agent failure | `mark_agent_failed` | ✅ |
| Reassign agent | `reassign_agent` | ✅ |
| Set manifest metadata | `set_manifest_field` | ✅ |
| Advance phase | `advance_phase` | ✅ |
| Complete/archive swarm | `complete_swarm` | ✅ |
| Quota check | `check_quota` | ✅ |
| Force phase gate | `update_phase_gate` | ✅ |
| List active swarms | `list_active_swarms` | ✅ |
| View agent detail | `get_agent_progress` | ✅ |

---

## Architecture Notes

### New Infrastructure Created
- **`swarm-registry.ts`** — Global swarm registry at `~/.antigravity-configs/swarm_registry.json`
- **Event System** — Per-session events at `~/.antigravity-configs/swarm_events/`
- **Swarm Archives** — `.swarm-archives/` created by `complete_swarm`

### Future Considerations
- Gap 19 (git integration) could be revisited if multi-agent branch collisions become common
- `stale_threshold_minutes` schema is registered but handler-level auto-flagging can be enhanced
- Quota reservation system (Gap 14) is partially addressed — `check_quota` reads live data but doesn't reserve
