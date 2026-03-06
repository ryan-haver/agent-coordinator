# MCP Tool Reference

> **41 tools** across 10 domains. Last updated: 2026-03-06.
>
> Backend indicators: 📁 File | 🗃️ SQLite | 📊 TimescaleDB | 🧠 Qdrant

---

## Summary

| # | Tool | Domain | Backend | Description |
|---|------|--------|---------|-------------|
| 1 | `create_swarm_manifest` | Manifest | 📁 🗃️ | Initialize a new swarm manifest from template |
| 2 | `read_manifest_section` | Manifest | 📁 🗃️ | Read a specific section of the manifest |
| 3 | `set_manifest_field` | Manifest | 📁 🗃️ | Set a table in a specific manifest section |
| 4 | `update_agent_status` | Agents | 📁 🗃️ | Update an agent's status in the Agents table |
| 5 | `add_agent_to_manifest` | Agents | 📁 🗃️ | Add an agent row to the Agents table |
| 6 | `mark_agent_failed` | Agents | 📁 🗃️ | Mark an agent as failed with reason |
| 7 | `reassign_agent` | Agents | 📁 🗃️ | Transfer scope and claims from one agent to another |
| 8 | `get_my_assignment` | Agents | 📁 🗃️ | Read own assignment from the manifest |
| 9 | `get_agent_progress` | Agents | 📁 🗃️ | Get detailed progress (status, claims, issues, notes) |
| 10 | `remove_agent_from_manifest` | Agents | 📁 🗃️ | Remove an agent row from the Agents table |
| 11 | `update_agent_in_manifest` | Agents | 📁 🗃️ | Update an agent's Model, Scope, or Role |
| 12 | `get_agent_prompt` | Agents | 📁 | Generate a populated prompt for an agent role |
| 13 | `claim_file` | Files | 📁 🗃️ | Register a file claim before editing |
| 14 | `check_file_claim` | Files | 📁 🗃️ | Check who owns a file claim |
| 15 | `release_file_claim` | Files | 📁 🗃️ | Release a file claim after completion |
| 16 | `check_phase_gates` | Phases | 📁 🗃️ | Check current phase gate status |
| 17 | `advance_phase` | Phases | 📁 🗃️ | Atomically validate and advance phase gate |
| 18 | `update_phase_gate` | Phases | 📁 🗃️ | Manually set a phase gate checkbox |
| 19 | `poll_agent_completion` | Phases | 📁 🗃️ | Poll all agents for completion + stale detection |
| 20 | `broadcast_event` | Events | 📁 🗃️ | Broadcast a structured event to all agents |
| 21 | `get_events` | Events | 📁 🗃️ | Get recent events for the swarm |
| 22 | `post_handoff_note` | Events | 📁 🗃️ 🧠 | Post a note visible to all agents (auto-indexes to Qdrant) |
| 23 | `get_handoff_notes` | Events | 📁 🗃️ | Get all handoff notes |
| 24 | `report_issue` | Events | 📁 🗃️ | Report an issue with severity |
| 25 | `get_swarm_status` | Swarm | 📁 🗃️ | Structured status summary across all agents |
| 26 | `complete_swarm` | Swarm | 📁 🗃️ | Mark a swarm as complete |
| 27 | `list_active_swarms` | Swarm | 📁 | List all active swarms across workspaces |
| 28 | `rollup_agent_progress` | Swarm | 📁 🗃️ | Aggregate progress for a specific agent |
| 29 | `check_quota` | Quota | 📁 | Check Antigravity model quota |
| 30 | `log_fusebase_pending` | Fusebase | 📁 🗃️ | Log a failed Fusebase write for later retry |
| 31 | `sync_fusebase_pending` | Fusebase | 📁 🗃️ | Get all pending Fusebase writes |
| 32 | `get_fusebase_sync_status` | Fusebase | 📁 🗃️ | Check pending Fusebase write count |
| 33 | `request_scope_expansion` | Scope | 📁 🗃️ | Request permission to edit outside your scope |
| 34 | `grant_scope_expansion` | Scope | 📁 🗃️ | Approve a scope expansion request |
| 35 | `deny_scope_expansion` | Scope | 📁 🗃️ | Deny a scope expansion request |
| 36 | `get_my_telemetry` | Telemetry | 📊 🗃️ | Get your recent tool calls |
| 37 | `get_session_telemetry` | Telemetry | 📊 🗃️ | Aggregated telemetry for all agents in session |
| 38 | `get_slow_operations` | Telemetry | 📊 🗃️ | Tool calls exceeding duration threshold |
| 39 | `get_telemetry_summary` | Telemetry | 📊 🗃️ | High-level swarm telemetry summary |
| 40 | `get_swarm_history` | Telemetry | 📊 🗃️ | Past swarm session summaries |
| 41 | `compare_models` | Telemetry | 📊 🗃️ | Head-to-head agent/model comparison |
| 42 | `store_memory` | Memory | 🧠 | Embed and store text into Qdrant |
| 43 | `semantic_search` | Memory | 🧠 | Search semantic memory by natural language |
| 44 | `find_similar_code` | Memory | 🧠 | Find similar code snippets |
| 45 | `find_past_solutions` | Memory | 🧠 | Search past issues and notes for solutions |

---

## Manifest (3 tools) 📁 🗃️

### `create_swarm_manifest`

Initialize a new swarm manifest from template.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `mission` | string | ✅ | The task description for the swarm |
| `workspace_root` | string | | Override workspace root |

### `read_manifest_section`

Read a specific section of the manifest (e.g., Agents, File Claims, Phase Gates).

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `section` | string | ✅ | Section name (e.g., "Agents", "File Claims") |
| `workspace_root` | string | | Override workspace root |

### `set_manifest_field`

Set a table in a specific manifest section (e.g., Quota Check, Branches).

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `section` | string | ✅ | Section to update |
| `table_markdown` | string | ✅ | Markdown table to set |
| `workspace_root` | string | | Override workspace root |

---

## Agents (9 tools) 📁 🗃️

### `update_agent_status`

Update an agent's status in the Agents table.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent identifier (e.g., α, β) |
| `status` | string | ✅ | New status (⏳ Pending, 🔄 Active, ✅ Complete, ❌ Failed) |
| `detail` | string | | Progress detail text |
| `workspace_root` | string | | Override workspace root |

### `add_agent_to_manifest`

Add an agent row to the Agents table in the manifest.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent identifier |
| `role` | string | ✅ | Agent role (Architect, Developer, QA, etc.) |
| `model` | string | ✅ | Model name |
| `scope` | string | ✅ | Directories/files this agent may edit |
| `phase` | string | ✅ | Phase number |
| `workspace_root` | string | | Override workspace root |

### `mark_agent_failed`

Mark an agent as ❌ Failed with a reason.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to mark as failed |
| `reason` | string | ✅ | Why the agent failed |
| `workspace_root` | string | | Override workspace root |

### `reassign_agent`

Transfer scope and claims from one agent to another.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `from_agent_id` | string | ✅ | Agent to transfer from |
| `to_agent_id` | string | ✅ | Agent to transfer to |
| `workspace_root` | string | | Override workspace root |

### `get_my_assignment`

Read your own assignment from the manifest.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Your agent ID |
| `workspace_root` | string | | Override workspace root |

### `get_agent_progress`

Get detailed progress for a specific agent (status, file claims, issues, notes).

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to query |
| `workspace_root` | string | | Override workspace root |

### `remove_agent_from_manifest`

Remove an agent row from the Agents table.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to remove |
| `workspace_root` | string | | Override workspace root |

### `update_agent_in_manifest`

Update an existing agent's Model, Scope, or Role.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to update |
| `role` | string | | New role |
| `model` | string | | New model |
| `scope` | string | | New scope |
| `workspace_root` | string | | Override workspace root |

### `get_agent_prompt`

Generate a populated prompt for an agent role.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `role` | string | ✅ | Agent role name |
| `workspace_root` | string | | Override workspace root |

---

## File Claims (3 tools) 📁 🗃️

### `claim_file`

Register a file claim before editing. Prevents concurrent edits.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent claiming the file |
| `file_path` | string | ✅ | Path to the file |
| `status` | string | ✅ | Claim status (🔄 Active, ✅ Done) |
| `workspace_root` | string | | Override workspace root |

### `check_file_claim`

Check who owns a file claim.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `file_path` | string | ✅ | Path to check |
| `workspace_root` | string | | Override workspace root |

### `release_file_claim`

Release a file claim after completion.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent releasing the claim |
| `file_path` | string | ✅ | Path to release |
| `status` | string | ✅ | Final status (✅ Done) |
| `workspace_root` | string | | Override workspace root |

---

## Phase Gates (4 tools) 📁 🗃️

### `check_phase_gates`

Check current phase gate status.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `phase_number` | string | ✅ | Phase to check |
| `workspace_root` | string | | Override workspace root |

### `advance_phase`

Atomically: validate phase gate, rollup agent progress, check gate checkbox, return next phase agent list.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `phase_number` | string | ✅ | Phase to advance |
| `workspace_root` | string | | Override workspace root |

### `update_phase_gate`

Manually set a phase gate checkbox.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `phase_number` | string | ✅ | Phase number |
| `complete` | boolean | ✅ | Whether the phase is complete |
| `workspace_root` | string | | Override workspace root |

### `poll_agent_completion`

Poll all agents for completion + stale detection.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent requesting the poll |
| `stale_threshold_minutes` | number | | Minutes before an agent is considered stale |
| `workspace_root` | string | | Override workspace root |

---

## Events & Notes (5 tools) 📁 🗃️

### `broadcast_event`

Broadcast a structured event to all agents (e.g., build_broken, dependency_added, api_changed).

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Broadcasting agent |
| `event_type` | string | ✅ | Event type identifier |
| `message` | string | ✅ | Event message |
| `workspace_root` | string | | Override workspace root |

### `get_events`

Get recent events for the swarm.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `workspace_root` | string | | Override workspace root |

### `post_handoff_note` 🧠

Post a note visible to all agents for inter-agent communication. **Auto-indexes** to Qdrant `agent_notes` collection when QDRANT_URL is set.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent posting the note |
| `note` | string | ✅ | Note content |
| `workspace_root` | string | | Override workspace root |

### `get_handoff_notes`

Get all handoff notes.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `workspace_root` | string | | Override workspace root |

### `report_issue`

Report an issue with severity.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `severity` | string | ✅ | 🔴 CONFLICT, 🟡 BUG, 🟠 DESIGN, 🟠 BLOCKED, 🟢 NITPICK |
| `description` | string | ✅ | Issue description |
| `reporter` | string | ✅ | Agent reporting |
| `workspace_root` | string | | Override workspace root |

---

## Swarm Lifecycle (4 tools) 📁 🗃️

### `get_swarm_status`

Return a structured status summary across all agents and phase gates.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `workspace_root` | string | | Override workspace root |

### `complete_swarm`

Mark a swarm as complete.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `workspace_root` | string | | Override workspace root |

### `list_active_swarms`

List all active swarms across all workspaces.

_No arguments._

### `rollup_agent_progress`

Aggregate progress for a specific agent.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to roll up |
| `workspace_root` | string | | Override workspace root |

---

## Quota (1 tool) 📁

### `check_quota`

Check Antigravity model quota across all tiers.

_No arguments._

---

## Fusebase (3 tools) 📁 🗃️

### `log_fusebase_pending`

Log a failed Fusebase write for later retry. Use `action='resolve'` to clear after successful retry.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `action` | string | ✅ | `log` or `resolve` |
| `local_file` | string | ✅ | Local file that was written |
| `agent_id` | string | | Agent that failed |
| `fusebase_page` | string | | Intended Fusebase page |
| `fusebase_folder_id` | string | | Target folder ID |
| `error` | string | | Error message |
| `workspace_root` | string | | Override workspace root |

### `sync_fusebase_pending`

Get all pending Fusebase writes that need to be retried.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | | Filter to this agent |
| `workspace_root` | string | | Override workspace root |

### `get_fusebase_sync_status`

Check if there are any pending Fusebase writes.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `workspace_root` | string | | Override workspace root |

---

## Scope Negotiation (3 tools) 📁 🗃️

### `request_scope_expansion`

Request permission to edit a file outside your assigned scope.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Requesting agent |
| `file_path` | string | ✅ | File to access |
| `reason` | string | ✅ | Why you need access |
| `workspace_root` | string | | Override workspace root |

### `grant_scope_expansion`

Approve a pending scope expansion request.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to approve |
| `file_path` | string | ✅ | File to grant |
| `workspace_root` | string | | Override workspace root |

### `deny_scope_expansion`

Deny a pending scope expansion request.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Agent to deny |
| `file_path` | string | ✅ | File to deny |
| `reason` | string | | Why denied |
| `workspace_root` | string | | Override workspace root |

---

## Telemetry (6 tools) 📊 🗃️

> **Soft dependency:** Falls back to local SQLite buffer when TimescaleDB is offline.

### `get_my_telemetry`

Returns your recent tool calls for the current session.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `agent_id` | string | ✅ | Your agent ID |
| `session_id` | string | | Filter to this session |
| `limit` | number | | Max rows (default 50, max 200) |

### `get_session_telemetry`

Aggregated telemetry for all agents in a session: call counts, average durations, failure rates.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `session_id` | string | | Session to query (omit for all) |

### `get_slow_operations`

Tool calls that exceeded a duration threshold.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `threshold_ms` | number | | Duration threshold in ms (default 2000) |
| `session_id` | string | | Filter to this session |
| `limit` | number | | Max rows (default 20, max 100) |

### `get_telemetry_summary`

High-level swarm telemetry summary: total calls, avg duration, failure rate, top tools.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `session_id` | string | | Filter to this session |

### `get_swarm_history`

Past swarm session summaries: total calls, duration, agent count, failure rate.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `limit` | number | | Max sessions to return (default: 10, max: 50) |

### `compare_models`

Head-to-head agent/model comparison: avg duration, success rate, call count.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `session_id` | string | | Optional session to narrow comparison |

---

## Semantic Memory (4 tools) 🧠

> **Soft dependency:** Requires `QDRANT_URL`. When not set, all tools return an informational
> "not configured" message with `isError: false` — never an error.
>
> **Embedding model:** `Xenova/all-MiniLM-L6-v2` (384-dim, cosine distance). Lazy-loaded on first use (~1s).

### `store_memory`

Embed and store text into Qdrant semantic memory.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `text` | string | ✅ | Text content to embed and store |
| `collection` | string | | `agent_notes` (default), `code_snippets`, `project_docs`, or `issues` |
| `agent_id` | string | | Agent that generated this content |
| `file_path` | string | | Source file path (for code_snippets) |
| `phase` | string | | Swarm phase when content was generated |
| `workspace_root` | string | | Override workspace root |

### `semantic_search`

Search semantic memory by natural language query. Returns top-K similar items.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `query` | string | ✅ | Natural language search query |
| `collection` | string | | Collection to search, or `all` (default) |
| `limit` | number | | Max results (default: 5, max: 20) |

### `find_similar_code`

Find semantically similar code snippets. Searches `code_snippets` collection.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `query` | string | ✅ | Description of what the code does |
| `file_path` | string | | Narrow to a specific file or directory |
| `limit` | number | | Max results (default: 5) |

### `find_past_solutions`

Search past issues and agent notes for solutions to similar problems. Searches `issues` + `agent_notes`.

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `query` | string | ✅ | Description of the problem |
| `limit` | number | | Max results (default: 5) |
