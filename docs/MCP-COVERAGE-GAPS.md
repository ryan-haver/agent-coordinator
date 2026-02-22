# MCP Server Coverage Gaps

> **Last updated:** 2026-02-22
> **Current coverage:** ~85% of agent lifecycle
> **Total gaps:** 19 (4 P0, 6 P1, 5 P2, 4 P3)

This document tracks all known gaps in MCP tool coverage — things agents or the coordinator need to do that aren't served by an MCP tool. Organized by category with implementation priority.

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Blocks core functionality — must fix before production swarms |
| **P1** | Causes failures in common scenarios |
| **P2** | Workaround exists but is fragile or manual |
| **P3** | Nice to have, improves agent quality of life |

---

## Category 1: Manifest Bootstrapping

### Gap 1: No tool to populate the Agents table — P0

**Who's affected:** Coordinator
**Scenario:** After `create_swarm_manifest`, the coordinator needs to add agent rows (ID, Role, Model, Phase, Scope, Status) but no MCP tool writes rows to the Agents table. The coordinator must fall back to raw file editing.

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

### Gap 2: No tool to set manifest metadata fields — P2

**Who's affected:** Coordinator
**Scenario:** After creating the manifest, the coordinator needs to populate `## Quota Check` table, `## Branches` section, and potentially change supervision level. No tool writes to these sections.

**Current workaround:** Manual markdown editing.

**Proposed fix:** New `set_manifest_field` tool for generic section updates:
```
set_manifest_field({
  section: "Quota Check",
  data: [{ "Model": "gemini-2.5-pro", "Usage": "45%", "Status": "✅" }],
  workspace_root: "<path>"
})
```

---

## Category 2: Agent Work Lifecycle

### Gap 3: No tool to advance an agent's phase — P2

**Who's affected:** Coordinator
**Scenario:** `update_agent_status` changes `Status` but not `Phase`. If an agent is reassigned from Phase 1 to Phase 2, the coordinator must manually update the manifest.

**Current workaround:** Agents typically don't change phases. PM scope spans all phases via the prompt.

**Proposed fix:** Extend `update_agent_status` to accept optional `phase` parameter.

### Gap 4: No "read my assignment" convenience tool — P3

**Who's affected:** Agents (if they need to re-read their scope mid-session)
**Scenario:** Agents receive scope via `$SCOPE` injection. If they need to re-read (e.g., after context compression), they must parse `read_manifest_section("Agents")` and self-filter.

**Current workaround:** Call `read_manifest_section("Agents")` and find own row by ID.

**Proposed fix:** New `get_my_assignment` tool:
```
get_my_assignment({ agent_id: "α", workspace_root: "<path>" })
→ { role: "Developer", scope: "src/api/", phase: "2", status: "🔄 Active" }
```

### Gap 5: No progress granularity — P1

**Who's affected:** Coordinator, PM agent, user
**Scenario:** Agents can only say "Active" or "Complete". No way to report subtask progress ("3/7 files done"), time estimates, or partial completion ("done with API layer, starting tests").

**Current workaround:** Agents can use `post_handoff_note` for freeform progress, but it's not structured or queryable.

**Proposed fix:** Extend `update_agent_status` with an optional `detail` field:
```
update_agent_status({
  agent_id: "α",
  status: "🔄 Active",
  detail: "3/7 files complete — finishing auth middleware",
  workspace_root: "<path>"
})
```
The `detail` field would be stored in the agent progress file and surfaced in `get_swarm_status` and `poll_agent_completion`.

### Gap 6: No per-agent progress visibility — P3

**Who's affected:** Coordinator, PM agent
**Scenario:** `get_swarm_status` returns the merged view but doesn't expose per-agent detail (specific file claims, issue list, notes). If the coordinator needs to see what Developer α specifically did vs Developer β, there's no tool.

**Current workaround:** Agent progress files on disk (`swarm-agent-*.json`) readable via standard file tools.

**Proposed fix:** New `get_agent_progress` tool:
```
get_agent_progress({ agent_id: "α", workspace_root: "<path>" })
→ { status, detail, file_claims: [...], issues: [...], handoff_notes: "..." }
```

---

## Category 3: Error Recovery

### Gap 7: No tool to handle agent failure — P0

**Who's affected:** Coordinator
**Scenario:** If an agent crashes, hangs, or produces bad output, its status stays `🔄 Active` and all its file claims remain locked. No way to atomically release everything and mark the agent as failed.

**Current workaround:** Manual file editing or waiting for the next `create_swarm_manifest` to clean up.

**Proposed fix:** New `mark_agent_failed` tool:
```
mark_agent_failed({
  agent_id: "α",
  reason: "Agent session crashed",
  workspace_root: "<path>"
})
```
This would:
1. Set agent status to `❌ Failed`
2. Release all active file claims (set to `⚠️ Abandoned`)
3. Write failure reason to agent progress file
4. Post automatic handoff note: `"[SYSTEM] Agent α failed: <reason>"`

### Gap 8: No stale agent detection — P1

**Who's affected:** Coordinator
**Scenario:** If an agent's session dies silently, `poll_agent_completion` will never return `all_complete: true`. `last_updated` timestamps exist in poll results, but there's no automated staleness threshold.

**Current workaround:** Coordinator manually checks `last_updated` and decides.

**Proposed fix:** Add optional `stale_threshold_minutes` to `poll_agent_completion`:
```
poll_agent_completion({
  phase_number: "2",
  stale_threshold_minutes: 30,
  workspace_root: "<path>"
})
→ { ..., stale_agents: [{ id: "α", last_updated: "...", minutes_stale: 45 }] }
```

### Gap 9: No agent reassignment — P2

**Who's affected:** Coordinator
**Scenario:** When an agent fails or is blocked, there's no way to reassign its remaining work to another agent without manually editing the manifest and re-dispatching.

**Current workaround:** Coordinator manually edits manifest, creates new agent row, re-dispatches.

**Proposed fix:** New `reassign_agent` tool:
```
reassign_agent({
  from_agent_id: "α",
  to_agent_id: "δ",
  workspace_root: "<path>"
})
```
Transfers scope, uncompleted file claims, and context from the failed agent to the replacement.

---

## Category 4: Inter-Agent Communication

### Gap 10: No structured event broadcasting — P1

**Who's affected:** All agents
**Scenario:** When DevOps discovers the build is broken, or Developer α adds a new dependency, other agents need to know immediately. `post_handoff_note` is freeform text — not structured, not queryable, not filterable by event type.

**Current workaround:** `post_handoff_note` with descriptive text. Agents must parse natural language to determine relevance.

**Proposed fix:** New `broadcast_event` tool:
```
broadcast_event({
  agent_id: "γ",
  event_type: "build_broken" | "dependency_added" | "api_changed" | "critical_blocker",
  message: "npm test failing — auth module has type errors",
  workspace_root: "<path>"
})
```
And a corresponding `get_events` tool to filter:
```
get_events({ event_type: "build_broken", workspace_root: "<path>" })
```

### Gap 11: No scope negotiation — P2

**Who's affected:** Developers, PM
**Scenario:** Developer α discovers they need to edit a file in Developer β's scope. `claim_file` will fail because it's outside their assigned scope (per prompt instructions). No escalation path through MCP.

**Current workaround:** Agent calls `report_issue` with `🟠 BLOCKED` and waits for manual intervention.

**Proposed fix:** New `request_scope_expansion` tool:
```
request_scope_expansion({
  agent_id: "α",
  file_path: "src/shared/utils.ts",
  reason: "Need to update shared types used by my module",
  workspace_root: "<path>"
})
```
PM agent would see these requests in `get_swarm_status` and approve/deny via `grant_scope_expansion`.

---

## Category 5: Multi-Workspace / Multi-Swarm

### Gap 12: No swarm registry — P1

**Who's affected:** Coordinator, user
**Scenario:** User runs `/swarm` on Project A and `/swarm` on Project B simultaneously. Each has its own manifest and session ID, but there's no global view. The coordinator on Project B doesn't know Project A is consuming quota.

**Current workaround:** Each workspace is fully isolated. User must mentally track active swarms.

**Proposed fix:** New `list_active_swarms` tool that scans a registry:
```
list_active_swarms()
→ [
    { workspace: "c:/projects/api", session: "2026-02-22T...", phase: "2", agents_active: 3 },
    { workspace: "c:/projects/frontend", session: "2026-02-22T...", phase: "1", agents_active: 2 }
  ]
```
Registry stored in `~/.antigravity-configs/swarm_registry.json`, updated by `create_swarm_manifest` and `complete_swarm`.

### Gap 13: No global agent registry — P1

**Who's affected:** Coordinator
**Scenario:** Nothing prevents assigning agent ID `α` on Project A and `α` on Project B simultaneously. If any cross-workspace tool is added later, these IDs will collide.

**Current workaround:** Session scoping prevents data leakage, but no global uniqueness.

**Proposed fix:** Either:
- Prefix agent IDs with workspace slug: `api-α`, `frontend-β`
- Or maintain a global agent registry in `~/.antigravity-configs/agent_registry.json`

### Gap 14: No cross-workspace quota awareness — P1

**Who's affected:** Coordinator
**Scenario:** Two swarms run simultaneously. Each runs `quota_check.ps1` independently. Neither knows the other is consuming quota. One swarm may exhaust quota that the other was counting on.

**Current workaround:** `quota_check.ps1` reads live status, so it reflects actual usage. But the coordinator can't _plan_ around future consumption by other swarms.

**Proposed fix:** Extend swarm registry with quota reservation. When a swarm starts, it reserves estimated quota. Other swarms see the reservation and route accordingly.

---

## Category 6: Swarm Lifecycle

### Gap 15: No quota / model routing via MCP — P2

**Who's affected:** Coordinator
**Scenario:** The workflow instructs the coordinator to run `quota_check.ps1`/`.sh` and read `quota_snapshot.json`. This is a terminal + file flow, not an MCP call.

**Current workaround:** Terminal command + file read.

**Proposed fix:** New `check_quota` tool or expose as MCP resource (`config://quota`).

### Gap 16: No atomic phase advancement — P2

**Who's affected:** Coordinator
**Scenario:** When all Phase 1 agents finish, the coordinator must: check gate → rollup → notify Phase 2 agents. This multi-step sequence has no atomicity — if rollup fails, the gate may be checked but data not merged.

**Current workaround:** Coordinator executes steps sequentially and handles errors.

**Proposed fix:** New `advance_phase` tool:
```
advance_phase({
  from_phase: "1",
  to_phase: "2",
  workspace_root: "<path>"
})
```
Atomically: validates gate, rolls up, checks gate checkbox, returns Phase 2 agent list.

### Gap 17: No swarm completion / archival — P2

**Who's affected:** Coordinator, user
**Scenario:** When the swarm finishes, there's no tool to: write final report, archive the manifest, clean up agent files, restore auto-mode settings, deregister from swarm registry.

**Current workaround:** Coordinator does cleanup manually. `swarm.md` Step 3 generates a report but doesn't archive.

**Proposed fix:** New `complete_swarm` tool:
```
complete_swarm({ workspace_root: "<path>" })
```
Performs: final rollup → writes `swarm-report.md` → archives manifest → cleans up agent files → restores settings → deregisters from swarm registry.

### Gap 18: No tool to update Phase Gates directly — P3

**Who's affected:** Coordinator
**Scenario:** `rollup_agent_progress` auto-checks gates when all agents complete. But there's no direct tool to manually check/uncheck a gate (e.g., to force-advance past a blocked phase).

**Current workaround:** `rollup_agent_progress` handles it automatically. Manual override requires file editing.

**Proposed fix:** New `update_phase_gate` tool:
```
update_phase_gate({ phase_number: "1", complete: true, workspace_root: "<path>" })
```

---

## Category 7: Git / Version Control

### Gap 19: No git integration — P3

**Who's affected:** Developers working in parallel
**Scenario:** Without branch isolation, two developers editing different files on the same branch will stomp each other's uncommitted changes. Agents have access to git via terminal, but no MCP-level coordination.

**Current workaround:** Agents use terminal git commands. Branch strategy was removed from prompts because agents weren't following it.

**Proposed fix considerations:**
- `create_agent_branch` — creates `swarm/<session>/<agent-id>` branch
- `merge_agent_branch` — merges agent branch back, detects conflicts
- `check_branch_conflicts` — compares branches for file-level conflicts

> **Note:** This may be out of scope for the MCP server. Agents have full git CLI access. The gap is coordination (knowing which branches exist), not execution.

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
| Read assignment/scope | prompt injection (`$SCOPE`) | ✅ via prompt |
| Report subtask progress | — | ❌ Gap 5 |
| Broadcast structured events | — | ❌ Gap 10 |
| Request scope expansion | — | ❌ Gap 11 |
| Re-read own assignment | `read_manifest_section` + filter | ⚠️ Gap 4 |
| Git branch operations | terminal git | ⚠️ Gap 19 |

### Coordinator Actions

| Action | MCP Tool | Status |
|--------|----------|--------|
| Create manifest | `create_swarm_manifest` | ✅ |
| Generate agent prompt | `get_agent_prompt` | ✅ |
| Poll phase completion | `poll_agent_completion` | ✅ |
| Check phase gates | `check_phase_gates` | ✅ |
| Rollup agent work | `rollup_agent_progress` | ✅ |
| Full status dashboard | `get_swarm_status` | ✅ |
| Read handoff notes | `get_handoff_notes` | ✅ |
| **Add agents to roster** | — | ❌ Gap 1 |
| **Handle agent failure** | — | ❌ Gap 7 |
| **Detect stale agents** | manual timestamp check | ❌ Gap 8 |
| **List active swarms** | — | ❌ Gap 12 |
| **Cross-workspace quota** | — | ❌ Gap 14 |
| Set manifest metadata | — | ⚠️ Gap 2 |
| Advance phase | manual multi-step | ⚠️ Gap 16 |
| Complete/archive swarm | manual | ⚠️ Gap 17 |
| Reassign agent | manual | ⚠️ Gap 9 |
| Quota pre-check | shell script | ⚠️ Gap 15 |
| Force phase gate | — | ⚠️ Gap 18 |

---

## Implementation Roadmap

### Phase A: Core (P0) — Must-have for production swarms
1. `add_agent_to_manifest` — Gap 1
2. `mark_agent_failed` + auto-release claims — Gap 7

### Phase B: Reliability (P1) — Common failure scenarios
3. `update_agent_status` extended with `detail` — Gap 5
4. `broadcast_event` + `get_events` — Gap 10
5. `poll_agent_completion` extended with `stale_threshold_minutes` — Gap 8
6. `list_active_swarms` + swarm registry — Gap 12
7. Global agent ID uniqueness — Gap 13
8. Cross-workspace quota reservation — Gap 14

### Phase C: Workflow (P2) — Reduces manual steps
9. `set_manifest_field` — Gap 2
10. `update_agent_status` extended with `phase` — Gap 3
11. `reassign_agent` — Gap 9
12. `request_scope_expansion` — Gap 11
13. `check_quota` MCP tool — Gap 15
14. `advance_phase` atomic — Gap 16
15. `complete_swarm` — Gap 17

### Phase D: Polish (P3) — Quality of life
16. `get_my_assignment` — Gap 4
17. `get_agent_progress` — Gap 6
18. `update_phase_gate` — Gap 18
19. Git branch coordination — Gap 19
