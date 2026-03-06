/**
 * MCP Tool Definitions — all 41 tool schemas in one place.
 * Extracted from the monolithic index.ts for maintainability.
 */

export const TOOL_DEFINITIONS = [
    {
        name: "create_swarm_manifest",
        description: "Initialize a new swarm manifest from template",
        inputSchema: {
            type: "object",
            properties: {
                mission: { type: "string", description: "The overarching goal of the swarm" },
                supervision_level: { type: "string", description: "Supervision level (e.g. gates, full, auto)" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["mission"]
        }
    },
    {
        name: "read_manifest_section",
        description: "Read a specific section of the manifest as JSON (agents, file_claims, phase_gates, issues)",
        inputSchema: {
            type: "object",
            properties: {
                section: { type: "string", description: "The section heading (e.g., Agents, File Claims, Issues)" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["section"]
        }
    },
    {
        name: "update_agent_status",
        description: "Update an agent's status in the Agents table",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "The agent id (e.g. α, β)" },
                status: { type: "string", description: "New status like '✅ Complete', '🔄 Active', '⏳ Pending'" },
                detail: { type: "string", description: "Optional progress detail (e.g. '3/7 files done')" },
                phase: { type: "string", description: "Optional phase update" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "status"]
        }
    },
    {
        name: "check_phase_gates",
        description: "Check if all agents in a phase are complete",
        inputSchema: {
            type: "object",
            properties: {
                phase_number: { type: "string", description: "Phase number to check" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["phase_number"]
        }
    },
    {
        name: "claim_file",
        description: "Register a file claim before editing",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                file_path: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "file_path"]
        }
    },
    {
        name: "check_file_claim",
        description: "Check if a file is already claimed",
        inputSchema: {
            type: "object",
            properties: {
                file_path: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["file_path"]
        }
    },
    {
        name: "release_file_claim",
        description: "Release a file claim after editing",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                file_path: { type: "string" },
                status: { type: "string", description: "Status e.g. '✅ Done'" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "file_path", "status"]
        }
    },
    {
        name: "get_agent_prompt",
        description: "Generate a populated prompt for an agent role",
        inputSchema: {
            type: "object",
            properties: {
                role: { type: "string", description: "Agent role file name without .md (e.g. 'developer', 'qa')" },
                mission: { type: "string" },
                scope: { type: "string" },
                agent_id: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["role", "mission", "scope", "agent_id"]
        }
    },
    {
        name: "report_issue",
        description: "Add an issue to the manifest Issues table",
        inputSchema: {
            type: "object",
            properties: {
                severity: { type: "string", description: "e.g. 🔴 BLOCKED, 🟡 BUG" },
                area: { type: "string" },
                description: { type: "string" },
                reporter: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["severity", "description", "reporter"]
        }
    },
    {
        name: "get_swarm_status",
        description: "Return a structured status summary across all agents and phase gates",
        inputSchema: {
            type: "object",
            properties: {
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "poll_agent_completion",
        description: "Check if all agents in a phase have reached terminal status (Complete/Done/Blocked/Failed). Use this to poll for completion.",
        inputSchema: {
            type: "object",
            properties: {
                phase_number: { type: "string", description: "Phase number to check" },
                stale_threshold_minutes: { type: "number", description: "Optional: flag agents inactive for this many minutes as stale" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["phase_number"]
        }
    },
    {
        name: "rollup_agent_progress",
        description: "Merge all per-agent progress files into the main manifest. Call between phases and at the end of the swarm.",
        inputSchema: {
            type: "object",
            properties: {
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "post_handoff_note",
        description: "Post a note visible to all agents for inter-agent communication (e.g., API changed, dependency added, important context)",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "The agent posting the note" },
                note: { type: "string", description: "The note content" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "note"]
        }
    },
    {
        name: "get_handoff_notes",
        description: "Read all handoff notes from the manifest and agent progress files. Use this to see what previous agents communicated.",
        inputSchema: {
            type: "object",
            properties: {
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "add_agent_to_manifest",
        description: "Add an agent row to the Agents table in the manifest",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent ID (e.g. α, β)" },
                role: { type: "string", description: "Agent role (e.g. Developer, QA)" },
                model: { type: "string", description: "Model name" },
                phase: { type: "string", description: "Phase number" },
                scope: { type: "string", description: "File/directory scope" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "role", "model", "phase", "scope"]
        }
    },
    {
        name: "mark_agent_failed",
        description: "Mark an agent as failed, release all its file claims, and post an automatic handoff note",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                reason: { type: "string", description: "Why the agent failed" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "reason"]
        }
    },
    {
        name: "broadcast_event",
        description: "Broadcast a structured event to all agents in the swarm (e.g. build_broken, dependency_added, api_changed, critical_blocker)",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent posting the event" },
                event_type: { type: "string", description: "Event type: build_broken, dependency_added, api_changed, critical_blocker, info" },
                message: { type: "string", description: "Event details" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "event_type", "message"]
        }
    },
    {
        name: "get_events",
        description: "Retrieve broadcast events, optionally filtered by type",
        inputSchema: {
            type: "object",
            properties: {
                event_type: { type: "string", description: "Optional filter by event type" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "list_active_swarms",
        description: "List all active swarms across all workspaces",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "set_manifest_field",
        description: "Set a table in a specific manifest section (e.g. Quota Check, Branches)",
        inputSchema: {
            type: "object",
            properties: {
                section: { type: "string", description: "Section heading (e.g. Quota Check)" },
                rows: { type: "array", description: "Array of row objects with column headers as keys", items: { type: "object" } },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["section", "rows"]
        }
    },
    {
        name: "reassign_agent",
        description: "Transfer scope and uncompleted work from a failed/stale agent to a replacement agent",
        inputSchema: {
            type: "object",
            properties: {
                from_agent_id: { type: "string" },
                to_agent_id: { type: "string" },
                to_role: { type: "string", description: "Role for the replacement agent" },
                to_model: { type: "string", description: "Model for the replacement agent" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["from_agent_id", "to_agent_id"]
        }
    },
    {
        name: "request_scope_expansion",
        description: "Request permission to edit a file outside your assigned scope. Creates a pending request visible in get_swarm_status.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                file_path: { type: "string", description: "File outside current scope" },
                reason: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "file_path", "reason"]
        }
    },
    {
        name: "check_quota",
        description: "Read the current model quota snapshot (runs quota check if stale)",
        inputSchema: {
            type: "object",
            properties: {
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "advance_phase",
        description: "Atomically: validate phase gate, rollup agent progress, check gate checkbox, return next phase agent list",
        inputSchema: {
            type: "object",
            properties: {
                from_phase: { type: "string" },
                to_phase: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["from_phase", "to_phase"]
        }
    },
    {
        name: "complete_swarm",
        description: "Finalize swarm: final rollup, archive manifest, clean up agent files, deregister from swarm registry",
        inputSchema: {
            type: "object",
            properties: {
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "get_my_assignment",
        description: "Get a specific agent's assignment details from the manifest",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id"]
        }
    },
    {
        name: "get_agent_progress",
        description: "Get detailed progress for a specific agent (status, file claims, issues, notes)",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id"]
        }
    },
    {
        name: "update_phase_gate",
        description: "Manually check or uncheck a phase gate checkbox",
        inputSchema: {
            type: "object",
            properties: {
                phase_number: { type: "string" },
                complete: { type: "boolean", description: "true to check, false to uncheck" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["phase_number", "complete"]
        }
    },
    {
        name: "grant_scope_expansion",
        description: "Approve a pending scope expansion request, allowing the agent to claim the requested file",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent whose request to approve" },
                file_path: { type: "string", description: "File path to grant access to" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "file_path"]
        }
    },
    {
        name: "deny_scope_expansion",
        description: "Deny a pending scope expansion request",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent whose request to deny" },
                file_path: { type: "string", description: "File path to deny access to" },
                reason: { type: "string", description: "Why the request was denied" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id", "file_path"]
        }
    },
    {
        name: "remove_agent_from_manifest",
        description: "Remove an agent row from the Agents table (e.g. wrongly added agent)",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id"]
        }
    },
    {
        name: "update_agent_in_manifest",
        description: "Update an existing agent's Model, Scope, or Role in the manifest",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string" },
                role: { type: "string", description: "Optional: new role" },
                model: { type: "string", description: "Optional: new model" },
                scope: { type: "string", description: "Optional: new scope" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["agent_id"]
        }
    },
    {
        name: "log_fusebase_pending",
        description: "Log a failed Fusebase write for later retry. Call this when a Fusebase MCP write fails so the pending write can be retried at phase gates or swarm completion. Use action='resolve' to remove an entry after successful retry.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["log", "resolve"], description: "'log' to add a pending write, 'resolve' to remove one after successful retry" },
                agent_id: { type: "string", description: "Agent that failed the write" },
                local_file: { type: "string", description: "Path to the local file that was written successfully" },
                fusebase_page: { type: "string", description: "Intended Fusebase page name" },
                fusebase_folder_id: { type: "string", description: "Fusebase folder ID for the page" },
                error: { type: "string", description: "Error message from the failed Fusebase write" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["action", "local_file"]
        }
    },
    {
        name: "sync_fusebase_pending",
        description: "Get all pending Fusebase writes that need to be retried. Returns the list of items — the calling agent should retry each one via Fusebase MCP, then call log_fusebase_pending with action='resolve' for each success.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Optional: filter to only this agent's pending writes" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },
    {
        name: "get_fusebase_sync_status",
        description: "Check if there are any pending Fusebase writes that haven't been synced. Returns total count and per-agent breakdown.",
        inputSchema: {
            type: "object",
            properties: {
                workspace_root: { type: "string", description: "Optional workspace root override" }
            }
        }
    },

    // ── Telemetry ──────────────────────────────────────────────────────
    {
        name: "get_my_telemetry",
        description: "Returns your recent tool calls for the current session. Use this to reconstruct what you did, identify slow operations, or review your activity timeline.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Your agent ID" },
                session_id: { type: "string", description: "Optional session ID filter" },
                limit: { type: "number", description: "Max rows to return (default 50, max 200)" }
            },
            required: ["agent_id"]
        }
    },
    {
        name: "get_session_telemetry",
        description: "Returns aggregated telemetry for all agents in a session: call counts, average durations, failure rates. Use for swarm health checks.",
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Session ID to query (omit for all sessions)" }
            }
        }
    },
    {
        name: "get_slow_operations",
        description: "Returns tool calls that exceeded a duration threshold. Use to identify bottlenecks or runaway operations.",
        inputSchema: {
            type: "object",
            properties: {
                threshold_ms: { type: "number", description: "Duration threshold in ms (default 2000)" },
                session_id: { type: "string", description: "Optional session ID filter" },
                limit: { type: "number", description: "Max rows (default 20, max 100)" }
            }
        }
    },
    {
        name: "get_telemetry_summary",
        description: "Returns a high-level swarm telemetry summary: total calls, avg duration, failure rate, top tools. Falls back to local SQLite when TimescaleDB is offline.",
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Optional session ID filter" }
            }
        }
    },
    // ── Semantic Memory (Qdrant) — soft dependency ────────────────────────
    {
        name: "store_memory",
        description: "Store text into semantic memory (Qdrant). Requires QDRANT_URL. No-op if Qdrant unavailable.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text content to embed and store" },
                collection: { type: "string", description: "Collection: agent_notes (default), code_snippets, project_docs, or issues" },
                agent_id: { type: "string", description: "Agent that generated this content" },
                file_path: { type: "string", description: "Source file path (for code_snippets)" },
                phase: { type: "string", description: "Swarm phase when content was generated" },
                workspace_root: { type: "string", description: "Optional workspace root override" }
            },
            required: ["text"]
        }
    },
    {
        name: "semantic_search",
        description: "Search semantic memory by natural language query. Returns top-K similar items across all or one collection.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Natural language search query" },
                collection: { type: "string", description: "Collection to search (agent_notes, code_snippets, project_docs, issues) or 'all' (default)" },
                limit: { type: "number", description: "Max results to return (default: 5, max: 20)" }
            },
            required: ["query"]
        }
    },
    {
        name: "find_similar_code",
        description: "Find semantically similar code snippets by describing what the code does. Searches code_snippets collection.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Description of what the code does (e.g. 'parse JWT token and extract claims')" },
                file_path: { type: "string", description: "Optional: narrow to a specific file or directory prefix" },
                limit: { type: "number", description: "Max results (default: 5)" }
            },
            required: ["query"]
        }
    },
    {
        name: "find_past_solutions",
        description: "Search past issues and agent notes for solutions to similar problems. Searches issues + agent_notes collections.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Description of the problem (e.g. 'database connection timeout on high load')" },
                limit: { type: "number", description: "Max results (default: 5)" }
            },
            required: ["query"]
        }
    },
    {
        name: "get_swarm_history",
        description: "Returns summary of past swarm sessions: total calls, duration, agent count, failure rate. Falls back to SQLite when TimescaleDB is offline.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max sessions to return (default: 10, max: 50)" }
            }
        }
    },
    {
        name: "compare_models",
        description: "Head-to-head model/agent comparison: avg duration, success rate, call count. Compares performance across agents within a session or globally.",
        inputSchema: {
            type: "object",
            properties: {
                session_id: { type: "string", description: "Optional session to narrow comparison" }
            }
        }
    }
];
