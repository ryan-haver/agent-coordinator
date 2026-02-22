import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString,
    readManifest,
    writeManifest
} from "./utils/manifest.js";
import {
    readAgentProgress,
    writeAgentProgress,
    createAgentProgress,
    readAllAgentProgress,
    cleanupAgentFiles,
    extractSessionId,
    generateSessionId,
    AgentProgress
} from "./utils/agent-progress.js";
import path from "path";
import os from "os";
import fs from "fs";
import {
    registerSwarm,
    updateSwarmRegistry,
    deregisterSwarm,
    listActiveSwarms,
    broadcastEvent,
    getEvents,
    cleanupEvents
} from "./utils/swarm-registry.js";

// Read version from package.json at startup
const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '..', '..', 'package.json'), 'utf8'));

const globalConfigPath = path.join(os.homedir(), ".antigravity-configs");

/**
 * Resolve the workspace root directory using multiple strategies.
 * Called lazily per-request (not at startup) so the CWD at server
 * launch time doesn't lock us into a wrong directory.
 */
function resolveWorkspaceRoot(args?: Record<string, unknown>): string {
    // Strategy 1: Explicit argument override (highest priority)
    if (args?.workspace_root && typeof args.workspace_root === "string") {
        return args.workspace_root;
    }

    // Strategy 2: Environment variable (set by Antigravity extension)
    if (process.env.ANTIGRAVITY_WORKSPACE) {
        return process.env.ANTIGRAVITY_WORKSPACE;
    }

    // Strategy 3: Walk up from CWD looking for swarm-manifest.md
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir !== root) {
        if (fs.existsSync(path.join(dir, 'swarm-manifest.md'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }

    // Strategy 4: Fall back to CWD (original behavior)
    return process.cwd();
}

const server = new Server(
    {
        name: "agent-coordinator",
        version: PKG.version || "1.0.0",
    },
    {
        capabilities: {
            tools: {},
            resources: {}
        }
    }
);

// Helper for finding model_fallback.json
function getModelsConfigPath(): string {
    const local = path.join(globalConfigPath, "model_fallback.json");
    if (fs.existsSync(local)) return local;
    return "";
}

function writeSwarmStatus(rootDir: string, md: string, lastEvent: string) {
    try {
        const modeSection = md.match(/Supervision:\s*(.+)/);
        const supervision = modeSection ? modeSection[1].trim() : "unknown";

        // Extract mission for the task field
        const missionMatch = md.match(/## Mission\s*\n+(.+)/);
        const task = missionMatch ? missionMatch[1].trim() : "";

        // Read agent files for most up-to-date counts (fallback to manifest)
        const sessionId = extractSessionId(md);
        const agentFiles = readAllAgentProgress(rootDir, sessionId);

        let active: number, complete: number, pending: number, phase: string;
        if (agentFiles.length > 0) {
            active = agentFiles.filter(a => a.status?.includes("Active")).length;
            complete = agentFiles.filter(a => a.status?.includes("Complete") || a.status?.includes("Done")).length;
            pending = agentFiles.filter(a => a.status?.includes("Pending")).length;
            const activeAgent = agentFiles.find(a => a.status?.includes("Active"));
            phase = activeAgent?.phase || (complete === agentFiles.length ? "done" : "0");
        } else {
            const agentsTable = getTableFromSection(md, "Agents");
            const agents = agentsTable?.rows || [];
            active = agents.filter(a => a["Status"]?.includes("Active")).length;
            complete = agents.filter(a => a["Status"]?.includes("Complete")).length;
            pending = agents.filter(a => a["Status"]?.includes("Pending")).length;
            const activeAgent = agents.find(a => a["Status"]?.includes("Active"));
            phase = activeAgent?.["Phase"] || (complete === agents.length ? "done" : "0");
        }

        // Determine if user action is needed (check phase gate completion)
        let allPhaseAgentsDone = false;
        if (agentFiles.length > 0) {
            const phaseAgentFiles = agentFiles.filter(a => a.phase === phase);
            allPhaseAgentsDone = phaseAgentFiles.length > 0 && phaseAgentFiles.every(a => a.status?.includes("Complete") || a.status?.includes("Done"));
        } else {
            // Fallback to manifest data for phase gate detection
            const agentsTable2 = getTableFromSection(md, "Agents");
            const phaseManifestAgents = (agentsTable2?.rows || []).filter(a => a["Phase"]?.trim() === phase);
            allPhaseAgentsDone = phaseManifestAgents.length > 0 && phaseManifestAgents.every(a => a["Status"]?.includes("Complete") || a["Status"]?.includes("Done"));
        }
        const needsAction = (supervision.toLowerCase().includes("gate") || supervision === "2") && allPhaseAgentsDone && phase !== "done";

        const statusObj = {
            task,
            phase,
            supervision,
            agents_active: active,
            agents_complete: complete,
            agents_pending: pending,
            last_event: lastEvent,
            needs_user_action: needsAction,
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(path.join(rootDir, "swarm_status.json"), JSON.stringify(statusObj, null, 2));
    } catch (e) {
        console.error("[agent-coordinator] Failed to write swarm_status.json:", e);
    }
}

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: "manifest://current",
                name: "Current Swarm Manifest",
                description: "The currently active swarm-manifest.md for the workspace",
                mimeType: "text/markdown"
            },
            {
                uri: "config://models",
                name: "Model Fallback Configuration",
                description: "Global model routing and fallback rules",
                mimeType: "application/json"
            }
        ]
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "manifest://current") {
        try {
            const wsRoot = resolveWorkspaceRoot();
            const content = readManifest(wsRoot);
            return {
                contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: content }]
            };
        } catch (e: any) {
            throw new Error(`Failed to read manifest: ${e.message}`);
        }
    } else if (request.params.uri === "config://models") {
        try {
            const p = getModelsConfigPath();
            if (!p) throw new Error("model_fallback.json not found");
            const content = fs.readFileSync(p, "utf8");
            return {
                contents: [{ uri: request.params.uri, mimeType: "application/json", text: content }]
            };
        } catch (e: any) {
            throw new Error(`Failed to read models config: ${e.message}`);
        }
    }
    throw new Error(`Resource ${request.params.uri} not found`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
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
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "create_swarm_manifest") {
            const mission = (args as any)?.mission;
            if (!mission || typeof mission !== "string") throw new Error("Missing required argument: mission");
            const supervision = (args as any)?.supervision_level || "Full";

            const templatePath = path.join(globalConfigPath, "templates", "swarm-manifest.md");
            if (!fs.existsSync(templatePath)) throw new Error("Template not found");
            let content = fs.readFileSync(templatePath, "utf8");

            // Replace placeholders (use split+join to avoid regex special char issues in mission text)
            content = content.split("$MISSION").join(mission);
            content = content.split("$TIMESTAMP").join(new Date().toISOString());
            content = content.replace(/Supervision:\s*\w+/, `Supervision: ${supervision}`);

            const wsRoot = resolveWorkspaceRoot(args as any);

            // Generate session ID and embed in manifest
            const sessionId = generateSessionId();
            content = `<!-- session: ${sessionId} -->\n` + content;

            // Clean up agent files from previous swarms
            const cleaned = cleanupAgentFiles(wsRoot);

            writeManifest(wsRoot, content);
            writeSwarmStatus(wsRoot, content, "Swarm initialized");

            // Register in global swarm registry
            try {
                registerSwarm({
                    workspace: wsRoot,
                    session_id: sessionId,
                    mission: mission.substring(0, 200),
                    phase: "0",
                    agents_active: 0,
                    agents_total: 0,
                    supervision,
                    started_at: new Date().toISOString(),
                    last_updated: new Date().toISOString(),
                    status: "active"
                });
            } catch { /* registry write is non-fatal */ }

            return { toolResult: "Manifest created successfully.", content: [{ type: "text", text: `Manifest created (session: ${sessionId}). Cleaned ${cleaned} old agent files.` }] };
        }

        if (name === "read_manifest_section") {
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const section = (args as any)?.section;
            if (!section || typeof section !== "string") throw new Error("Missing required argument: section");
            const res = getTableFromSection(md, section);
            if (!res) throw new Error(`Section ${section} not found or no table in it`);
            return { toolResult: JSON.stringify(res, null, 2), content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }

        if (name === "update_agent_status") {
            const agent_id = (args as any)?.agent_id;
            const status = (args as any)?.status;
            if (!agent_id || !status) throw new Error("Missing required arguments: agent_id, status");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Write to per-agent progress file (concurrency-safe)
            let progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) {
                // Agent file doesn't exist yet — read role/phase/session from manifest
                const md = readManifest(wsRoot);
                const sessionId = extractSessionId(md);
                const res = getTableFromSection(md, "Agents");
                const row = res?.rows.find(r => r["ID"] === agent_id);
                progress = createAgentProgress(agent_id, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
            }
            progress.status = status;
            const detail = (args as any)?.detail;
            if (detail) progress.detail = detail;
            const phase = (args as any)?.phase;
            if (phase) progress.phase = phase;
            writeAgentProgress(wsRoot, progress);

            return { toolResult: `Agent ${agent_id} status updated to ${status}`, content: [{ type: "text", text: `Agent ${agent_id} status updated to ${status}${detail ? ` (${detail})` : ''} (written to agent progress file)` }] };
        }

        if (name === "check_phase_gates") {
            const phaseNum = (args as any)?.phase_number;
            if (!phaseNum) throw new Error("Missing required argument: phase_number");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Read from agent progress files first (most current), manifest as fallback
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);
            const agentFiles = readAllAgentProgress(wsRoot, sessionId);
            const phaseFromFiles = agentFiles.filter(a => a.phase === String(phaseNum).trim());

            let phaseAgents: Array<{ id: string; status: string }>;
            if (phaseFromFiles.length > 0) {
                phaseAgents = phaseFromFiles.map(a => ({ id: a.agent_id, status: a.status }));
            } else {
                // Fallback to manifest
                const res = getTableFromSection(md, "Agents");
                if (!res) throw new Error("Agents section not found");
                const rows = res.rows.filter(r => r["Phase"]?.trim() === String(phaseNum).trim());
                phaseAgents = rows.map(r => ({ id: r["ID"], status: r["Status"] }));
            }

            if (phaseAgents.length === 0) return { content: [{ type: "text", text: "No agents in this phase." }] };

            const terminal = ["Complete", "Done", "Blocked", "Failed"];
            const allDone = phaseAgents.every(a => terminal.some(t => a.status?.includes(t)));
            const summary = phaseAgents.map(a => `${a.id}: ${a.status}`).join("\n");

            const resultText = `All agents complete: ${allDone}\nDetails:\n${summary}`;
            return { toolResult: resultText, content: [{ type: "text", text: resultText }] };
        }

        if (name === "claim_file") {
            const agent_id = (args as any)?.agent_id;
            const file_path = (args as any)?.file_path;
            if (!agent_id || !file_path) throw new Error("Missing required arguments: agent_id, file_path");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Atomic claim: use lock file to prevent TOCTOU race
            const lockFileName = `.claim-lock-${file_path.replace(/[\/\\:]/g, '_')}`;
            const lockFilePath = path.join(wsRoot, lockFileName);
            try {
                fs.writeFileSync(lockFilePath, agent_id, { flag: 'wx' });
            } catch {
                throw new Error(`File ${file_path} is being claimed by another agent (lock exists)`);
            }

            try {
                // Check all agent files for existing active claims (session-scoped)
                const md = readManifest(wsRoot);
                const sessionIdForClaims = extractSessionId(md);
                const allProgress = readAllAgentProgress(wsRoot, sessionIdForClaims);
                for (const ap of allProgress) {
                    const activeClaim = ap.file_claims.find(c => c.file === file_path && !c.status.includes("Done") && !c.status.includes("Abandoned"));
                    if (activeClaim) {
                        throw new Error(`File ${file_path} is currently claimed by agent ${ap.agent_id} with status ${activeClaim.status}`);
                    }
                }

                // Write claim to agent's own progress file
                let progress = readAgentProgress(wsRoot, agent_id);
                if (!progress) {
                    const sessionId = extractSessionId(md);
                    const res = getTableFromSection(md, "Agents");
                    const row = res?.rows.find(r => r["ID"] === agent_id);
                    progress = createAgentProgress(agent_id, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
                }
                progress.file_claims.push({ file: file_path, status: "🔄 Active" });
                writeAgentProgress(wsRoot, progress);

                return { toolResult: `File ${file_path} claimed by ${agent_id}`, content: [{ type: "text", text: `File ${file_path} claimed by ${agent_id} (written to agent progress file)` }] };
            } finally {
                try { fs.unlinkSync(lockFilePath); } catch { /* lock already removed */ }
            }
        }

        if (name === "check_file_claim") {
            const file_path = (args as any)?.file_path;
            if (!file_path) throw new Error("Missing required argument: file_path");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Check both manifest AND agent progress files for claims
            const claims: Array<{ agent_id: string; file: string; status: string; source: string }> = [];

            // 1. Check agent progress files (most up-to-date, session-scoped)
            const mdForCheck = readManifest(wsRoot);
            const sessionIdForCheck = extractSessionId(mdForCheck);
            const allProgress = readAllAgentProgress(wsRoot, sessionIdForCheck);
            for (const ap of allProgress) {
                for (const c of ap.file_claims) {
                    if (c.file === file_path) {
                        claims.push({ agent_id: ap.agent_id, file: c.file, status: c.status, source: "agent_file" });
                    }
                }
            }

            // 2. Fallback: check manifest (for pre-P2 data)
            try {
                const md = readManifest(wsRoot);
                const res = getTableFromSection(md, "File Claims");
                if (res) {
                    const manifestClaims = res.rows.filter(r => r["File"] === file_path);
                    for (const mc of manifestClaims) {
                        // Only add if not already found in agent files
                        if (!claims.some(c => c.agent_id === mc["Claimed By"])) {
                            claims.push({ agent_id: mc["Claimed By"], file: mc["File"], status: mc["Status"], source: "manifest" });
                        }
                    }
                }
            } catch { /* manifest may not exist yet */ }

            return { toolResult: JSON.stringify(claims), content: [{ type: "text", text: JSON.stringify(claims, null, 2) }] };
        }

        if (name === "release_file_claim") {
            const agent_id = (args as any)?.agent_id;
            const file_path = (args as any)?.file_path;
            const status = (args as any)?.status;
            if (!agent_id || !file_path || !status) throw new Error("Missing required arguments: agent_id, file_path, status");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Update claim in agent's own progress file
            let progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) throw new Error(`Agent progress file for ${agent_id} not found`);

            const claim = progress.file_claims.find(c => c.file === file_path && !c.status.includes("Done"));
            if (!claim) throw new Error(`Active claim for ${file_path} by ${agent_id} not found`);
            claim.status = status;
            writeAgentProgress(wsRoot, progress);

            return { toolResult: `File ${file_path} claim released with status ${status}`, content: [{ type: "text", text: `File ${file_path} claim released with status ${status} (written to agent progress file)` }] };
        }

        if (name === "get_agent_prompt") {
            const role = (args as any)?.role;
            const mission = (args as any)?.mission;
            const scope = (args as any)?.scope;
            const agent_id = (args as any)?.agent_id;
            if (!role || !mission || !scope || !agent_id) throw new Error("Missing required arguments: role, mission, scope, agent_id");

            // Guard against path traversal: role must be alphanumeric + hyphens only
            if (!/^[a-z0-9-]+$/i.test(role)) throw new Error(`Invalid role name: ${role}`);

            const promptPath = path.join(globalConfigPath, "templates", "agent-prompts", `${role}.md`);
            if (!fs.existsSync(promptPath)) throw new Error(`Prompt template for ${role} not found`);

            let prompt = fs.readFileSync(promptPath, "utf8");
            // Use split+join to avoid regex special char issues in user-provided text
            prompt = prompt.split("$MISSION").join(mission);
            prompt = prompt.split("$SCOPE").join(scope);
            prompt = prompt.split("$AGENT_ID").join(agent_id);
            prompt = prompt.split("$WORKSPACE_ROOT").join(resolveWorkspaceRoot(args as any));

            return { toolResult: prompt, content: [{ type: "text", text: prompt }] };
        }

        if (name === "report_issue") {
            const severity = (args as any)?.severity;
            const description = (args as any)?.description;
            const reporter = (args as any)?.reporter;
            if (!severity || !description || !reporter) throw new Error("Missing required arguments: severity, description, reporter");
            const area = (args as any)?.area || "";
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Write issue to reporter's agent progress file
            let progress = readAgentProgress(wsRoot, reporter);
            if (!progress) {
                const md = readManifest(wsRoot);
                const sessionId = extractSessionId(md);
                const res = getTableFromSection(md, "Agents");
                const row = res?.rows.find(r => r["ID"] === reporter);
                progress = createAgentProgress(reporter, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
            }
            progress.issues.push({ severity, area, description });
            writeAgentProgress(wsRoot, progress);

            return { toolResult: `Issue reported: ${description}`, content: [{ type: "text", text: `Issue reported: ${description} (written to agent progress file)` }] };
        }

        if (name === "post_handoff_note") {
            const agent_id = (args as any)?.agent_id;
            const note = (args as any)?.note;
            if (!agent_id || !note) throw new Error("Missing required arguments: agent_id, note");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Write to agent's own progress file
            let progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) {
                const md = readManifest(wsRoot);
                const sessionId = extractSessionId(md);
                const res = getTableFromSection(md, "Agents");
                const row = res?.rows.find(r => r["ID"] === agent_id);
                progress = createAgentProgress(agent_id, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
            }
            const timestamp = new Date().toISOString().slice(0, 19);
            const formattedNote = `[${timestamp}] ${agent_id}: ${note}`;
            progress.handoff_notes = progress.handoff_notes
                ? progress.handoff_notes + '\n' + formattedNote
                : formattedNote;
            writeAgentProgress(wsRoot, progress);

            // Also append to manifest ## Handoff Notes section
            try {
                let md = readManifest(wsRoot);
                // Robust: find the section heading and insert after it (+ any HTML comment)
                const handoffIdx = md.indexOf('## Handoff Notes');
                if (handoffIdx !== -1) {
                    // Find end of heading line
                    let insertIdx = md.indexOf('\n', handoffIdx);
                    if (insertIdx === -1) insertIdx = md.length;
                    else insertIdx++; // after the newline
                    // Skip optional HTML comment line
                    const rest = md.slice(insertIdx);
                    const commentMatch = rest.match(/^<!--[\s\S]*?-->\s*\n/);
                    if (commentMatch) insertIdx += commentMatch[0].length;
                    md = md.slice(0, insertIdx) + formattedNote + '\n' + md.slice(insertIdx);
                    writeManifest(wsRoot, md);
                }
            } catch { /* manifest write failure is non-fatal */ }

            return { toolResult: `Note posted by ${agent_id}`, content: [{ type: "text", text: `Note posted: ${formattedNote}` }] };
        }

        if (name === "get_handoff_notes") {
            const wsRoot = resolveWorkspaceRoot(args as any);
            const notes: string[] = [];

            // 1. Read from manifest ## Handoff Notes section
            try {
                const md = readManifest(wsRoot);
                const notesMatch = md.match(/## Handoff Notes\s*\n(?:<!-- .*?-->\s*\n)?([\s\S]*?)(?:\n## |$)/);
                if (notesMatch && notesMatch[1].trim()) {
                    notes.push(...notesMatch[1].trim().split('\n').filter(l => l.trim()));
                }
            } catch { /* manifest may not exist */ }

            // 2. Read from agent progress files
            try {
                const md = readManifest(wsRoot);
                const sessionId = extractSessionId(md);
                const allProgress = readAllAgentProgress(wsRoot, sessionId);
                for (const ap of allProgress) {
                    if (ap.handoff_notes?.trim()) {
                        const agentNotes = ap.handoff_notes.split('\n').filter(l => l.trim());
                        for (const n of agentNotes) {
                            if (!notes.includes(n)) notes.push(n);
                        }
                    }
                }
            } catch { /* agent files may not exist */ }

            const result = notes.length > 0 ? notes.join('\n') : '(No handoff notes found)';
            return { toolResult: result, content: [{ type: "text", text: result }] };
        }

        if (name === "get_swarm_status") {
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const agents = getTableFromSection(md, "Agents")?.rows || [];
            const manifestIssues = getTableFromSection(md, "Issues")?.rows || [];

            // Merge per-agent progress files for up-to-date status
            const sessionId = extractSessionId(md);
            const agentFiles = readAllAgentProgress(wsRoot, sessionId);
            for (const ap of agentFiles) {
                const row = agents.find(a => a["ID"] === ap.agent_id);
                if (row) {
                    row["Status"] = ap.status;
                    if (ap.phase) row["Phase"] = ap.phase;
                }
            }

            // Merge issues from agent files
            const agentIssues = agentFiles.flatMap(ap =>
                ap.issues.map(i => ({ "Severity": i.severity, "File/Area": i.area, "Description": i.description, "Reported By": ap.agent_id }))
            );
            const issues = [...manifestIssues, ...agentIssues.filter(ai =>
                !manifestIssues.some(mi => mi["Description"] === ai["Description"] && mi["Reported By"] === ai["Reported By"])
            )];

            // Phase Gates uses checkbox list, not a markdown table — parse manually
            const gatesMatch = md.match(/## Phase Gates\s*\n+([\s\S]*?)(?:\n##\s|$)/);
            const gates: { phase: string; complete: boolean }[] = [];
            if (gatesMatch) {
                const gateLines = gatesMatch[1].split('\n');
                for (const line of gateLines) {
                    const m = line.match(/^\s*-\s*\[(x| )\]\s*(.+)/);
                    if (m) {
                        gates.push({ phase: m[2].trim(), complete: m[1] === 'x' });
                    }
                }
            }

            // Collect handoff notes from agent files for get_swarm_status
            const handoffNotes: string[] = [];
            for (const ap of agentFiles) {
                if (ap.handoff_notes?.trim()) {
                    handoffNotes.push(...ap.handoff_notes.split('\n').filter((l: string) => l.trim()));
                }
            }

            return { toolResult: JSON.stringify({ agents, gates, issues, handoff_notes: handoffNotes }), content: [{ type: "text", text: JSON.stringify({ agents, gates, issues, handoff_notes: handoffNotes }, null, 2) }] };
        }

        if (name === "poll_agent_completion") {
            const phaseNum = (args as any)?.phase_number;
            if (!phaseNum) throw new Error("Missing required argument: phase_number");
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);
            const allProgress = readAllAgentProgress(wsRoot, sessionId);
            const phaseAgents = allProgress.filter(a => a.phase === String(phaseNum).trim());

            // Cross-reference manifest to know how many agents are expected
            const agentsTable = getTableFromSection(md, "Agents");
            const expectedInPhase = (agentsTable?.rows || [])
                .filter(r => r["Phase"]?.trim() === String(phaseNum).trim());
            const agentsNotStarted = expectedInPhase
                .filter(e => !phaseAgents.some(a => a.agent_id === e["ID"]))
                .map(e => e["ID"]);

            const terminal = ["Complete", "Done", "Blocked", "Failed"];
            const allDone = expectedInPhase.length > 0 &&
                agentsNotStarted.length === 0 &&
                phaseAgents.every(a => terminal.some(t => a.status?.includes(t)));

            const result = {
                all_complete: allDone,
                total_agents: phaseAgents.length,
                expected_agents: expectedInPhase.length,
                agents_not_started: agentsNotStarted,
                agents: phaseAgents.map(a => ({
                    id: a.agent_id,
                    role: a.role,
                    status: a.status,
                    last_updated: a.last_updated
                }))
            };
            return { toolResult: JSON.stringify(result), content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        if (name === "rollup_agent_progress") {
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);

            // Read all per-agent progress files (session-scoped)
            const sessionId = extractSessionId(md);
            const allProgress = readAllAgentProgress(wsRoot, sessionId);
            if (allProgress.length === 0) {
                return { content: [{ type: "text", text: "No agent progress files found." }] };
            }

            // 1. Update Agents table with statuses from progress files
            const agentsTable = getTableFromSection(md, "Agents");
            if (agentsTable) {
                for (const ap of allProgress) {
                    const row = agentsTable.rows.find(r => r["ID"] === ap.agent_id);
                    if (row) {
                        row["Status"] = ap.status;
                    }
                }
                const updatedAgents = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
                if (updatedAgents) md = updatedAgents;
            }

            // 2. Merge file claims from all agents into File Claims table
            const claimsTable = getTableFromSection(md, "File Claims");
            if (claimsTable) {
                // Start fresh with claims from agent files
                const mergedClaims: Array<{ File: string; "Claimed By": string; Status: string }> = [];
                for (const ap of allProgress) {
                    for (const c of ap.file_claims) {
                        mergedClaims.push({ "File": c.file, "Claimed By": ap.agent_id, "Status": c.status });
                    }
                }
                claimsTable.rows = mergedClaims.map(c => ({ "File": c.File, "Claimed By": c["Claimed By"], "Status": c.Status }));
                const updatedClaims = replaceTableInSection(md, "File Claims", serializeTableToString(claimsTable.headers, claimsTable.rows));
                if (updatedClaims) md = updatedClaims;
            }

            // 3. Merge issues from all agents into Issues table
            const issuesTable = getTableFromSection(md, "Issues");
            if (issuesTable) {
                const mergedIssues: Array<Record<string, string>> = [];
                for (const ap of allProgress) {
                    for (const issue of ap.issues) {
                        mergedIssues.push({
                            "Severity": issue.severity,
                            "File/Area": issue.area,
                            "Description": issue.description,
                            "Reported By": ap.agent_id
                        });
                    }
                }
                // Merge: keep existing manifest issues that aren't duplicated by agent files
                const existingIssues = issuesTable.rows.filter(existing =>
                    !mergedIssues.some(mi => mi["Description"] === existing["Description"] && mi["Reported By"] === existing["Reported By"])
                );
                issuesTable.rows = [...existingIssues, ...mergedIssues];
                const updatedIssues = replaceTableInSection(md, "Issues", serializeTableToString(issuesTable.headers, issuesTable.rows));
                if (updatedIssues) md = updatedIssues;
            }

            // 4. Merge handoff notes from agent files into manifest
            for (const ap of allProgress) {
                if (ap.handoff_notes?.trim()) {
                    const notes = ap.handoff_notes.split('\n').filter(l => l.trim());
                    for (const note of notes) {
                        // Only append if not already in manifest
                        if (!md.includes(note)) {
                            const handoffIdx = md.indexOf('## Handoff Notes');
                            if (handoffIdx !== -1) {
                                let insertIdx = md.indexOf('\n', handoffIdx);
                                if (insertIdx === -1) insertIdx = md.length;
                                else insertIdx++;
                                const rest = md.slice(insertIdx);
                                const commentMatch = rest.match(/^<!--[\s\S]*?-->\s*\n/);
                                if (commentMatch) insertIdx += commentMatch[0].length;
                                md = md.slice(0, insertIdx) + note + '\n' + md.slice(insertIdx);
                            }
                        }
                    }
                }
            }

            // 5. Auto-check phase gates if all agents in a phase are complete
            const agentsTableForGates = getTableFromSection(md, "Agents") || agentsTable;
            if (agentsTableForGates) {
                const terminal = ["Complete", "Done"];
                const phaseNumbers = [...new Set(agentsTableForGates.rows.map(r => r["Phase"]?.trim()).filter(Boolean))];
                for (const ph of phaseNumbers) {
                    const phaseRows = agentsTableForGates.rows.filter(r => r["Phase"]?.trim() === ph);
                    // Check agent files for most current status
                    const allPhaseComplete = phaseRows.every(r => {
                        const ap = allProgress.find(a => a.agent_id === r["ID"]);
                        const status = ap ? ap.status : r["Status"];
                        return terminal.some(t => status?.includes(t));
                    });
                    if (allPhaseComplete) {
                        // Auto-check the matching phase gate checkbox
                        const gateRegex = new RegExp(`(- \\[)( )(\\]\\s*Phase ${ph}\\b)`, 'i');
                        md = md.replace(gateRegex, '$1x$3');
                    }
                }
            }

            // 6. Write the consolidated manifest and update swarm status
            writeManifest(wsRoot, md);
            writeSwarmStatus(wsRoot, md, `Rolled up progress from ${allProgress.length} agents`);

            const summary = allProgress.map(ap => `${ap.agent_id} (${ap.role}): ${ap.status}`).join(", ");
            return { toolResult: `Rollup complete: ${summary}`, content: [{ type: "text", text: `Rollup complete for ${allProgress.length} agents: ${summary}` }] };
        }

        // === GAP 1: add_agent_to_manifest ===
        if (name === "add_agent_to_manifest") {
            const { agent_id, role, model, phase, scope } = args as any;
            if (!agent_id || !role || !model || !phase || !scope) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);

            const agentsTable = getTableFromSection(md, "Agents");
            if (!agentsTable) throw new Error("No ## Agents table found in manifest");

            // Check for duplicate agent ID
            if (agentsTable.rows.some(r => r["ID"] === agent_id)) {
                throw new Error(`Agent ${agent_id} already exists in the manifest`);
            }

            agentsTable.rows.push({ "ID": agent_id, "Role": role, "Model": model, "Phase": phase, "Scope": scope, "Status": "⏳ Pending" });
            const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
            if (updated) {
                writeManifest(wsRoot, updated);
                // Update registry with agent count
                try { updateSwarmRegistry(wsRoot, { agents_total: agentsTable.rows.length }); } catch { /* non-fatal */ }
            }

            return { toolResult: `Agent ${agent_id} added`, content: [{ type: "text", text: `Added agent ${agent_id} (${role}) to Phase ${phase}` }] };
        }

        // === GAP 7: mark_agent_failed ===
        if (name === "mark_agent_failed") {
            const { agent_id, reason } = args as any;
            if (!agent_id || !reason) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);

            // 1. Update agent status to Failed
            let progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) {
                progress = createAgentProgress(agent_id, "unknown", "0", sessionId);
            }
            progress.status = "❌ Failed";
            progress.detail = reason;

            // 2. Release all active file claims
            const releasedFiles: string[] = [];
            for (const claim of progress.file_claims) {
                if (claim.status !== "✅ Done") {
                    claim.status = "⚠️ Abandoned";
                    releasedFiles.push(claim.file);
                }
            }

            // 3. Auto-post handoff note
            const timestamp = new Date().toISOString().slice(0, 19);
            const failNote = `[${timestamp}] [SYSTEM] Agent ${agent_id} failed: ${reason}. Released files: ${releasedFiles.join(", ") || "none"}`;
            progress.handoff_notes = progress.handoff_notes ? progress.handoff_notes + '\n' + failNote : failNote;
            writeAgentProgress(wsRoot, progress);

            // 4. Update manifest agent status
            try {
                let mdUpdated = readManifest(wsRoot);
                const agentsTable = getTableFromSection(mdUpdated, "Agents");
                if (agentsTable) {
                    const row = agentsTable.rows.find(r => r["ID"] === agent_id);
                    if (row) row["Status"] = "❌ Failed";
                    const t = replaceTableInSection(mdUpdated, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
                    if (t) writeManifest(wsRoot, t);
                }
            } catch { /* non-fatal */ }

            // 5. Clean up any lock files for this agent
            try {
                const lockFiles = fs.readdirSync(wsRoot).filter(f => f.startsWith('.claim-lock-'));
                for (const lf of lockFiles) {
                    const content = fs.readFileSync(path.join(wsRoot, lf), 'utf8');
                    if (content.trim() === agent_id) {
                        fs.unlinkSync(path.join(wsRoot, lf));
                    }
                }
            } catch { /* non-fatal */ }

            return { toolResult: `Agent ${agent_id} marked as failed`, content: [{ type: "text", text: `Agent ${agent_id} marked ❌ Failed. Released ${releasedFiles.length} file claims. Reason: ${reason}` }] };
        }

        // === GAP 10: broadcast_event ===
        if (name === "broadcast_event") {
            const { agent_id, event_type, message } = args as any;
            if (!agent_id || !event_type || !message) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);

            broadcastEvent({
                timestamp: new Date().toISOString(),
                agent_id,
                event_type,
                message,
                workspace: wsRoot,
                session_id: sessionId
            });

            // Also post as handoff note for persistence
            const timestamp = new Date().toISOString().slice(0, 19);
            const noteText = `[${timestamp}] [EVENT:${event_type.toUpperCase()}] ${agent_id}: ${message}`;
            let progress = readAgentProgress(wsRoot, agent_id);
            if (progress) {
                progress.handoff_notes = progress.handoff_notes ? progress.handoff_notes + '\n' + noteText : noteText;
                writeAgentProgress(wsRoot, progress);
            }

            return { toolResult: `Event broadcast: ${event_type}`, content: [{ type: "text", text: `Event [${event_type}] broadcast by ${agent_id}: ${message}` }] };
        }

        // === GAP 10: get_events ===
        if (name === "get_events") {
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);
            const eventType = (args as any)?.event_type;
            const events = getEvents(wsRoot, sessionId, eventType);
            return { toolResult: JSON.stringify(events), content: [{ type: "text", text: events.length > 0 ? JSON.stringify(events, null, 2) : "(No events found)" }] };
        }

        // === GAP 12: list_active_swarms ===
        if (name === "list_active_swarms") {
            const swarms = listActiveSwarms();
            return { toolResult: JSON.stringify(swarms), content: [{ type: "text", text: swarms.length > 0 ? JSON.stringify(swarms, null, 2) : "(No active swarms)" }] };
        }

        // === GAP 2: set_manifest_field ===
        if (name === "set_manifest_field") {
            const { section, rows } = args as any;
            if (!section || !rows) throw new Error("Missing required arguments: section, rows");
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);

            const table = getTableFromSection(md, section);
            if (table) {
                // Replace existing table
                table.rows = rows;
                const updated = replaceTableInSection(md, section, serializeTableToString(table.headers, rows));
                if (updated) {
                    writeManifest(wsRoot, updated);
                    return { toolResult: `Section ${section} updated`, content: [{ type: "text", text: `Updated ${section} with ${rows.length} rows` }] };
                }
            }

            // If no table exists yet, try to create one after the section heading
            const sectionIdx = md.indexOf(`## ${section}`);
            if (sectionIdx === -1) throw new Error(`Section "## ${section}" not found in manifest`);

            // Build table from rows
            if (rows.length === 0) throw new Error("Rows array is empty");
            const headers = Object.keys(rows[0]);
            const tableStr = serializeTableToString(headers, rows);
            let insertIdx = md.indexOf('\n', sectionIdx);
            if (insertIdx === -1) insertIdx = md.length;
            else insertIdx++;
            md = md.slice(0, insertIdx) + '\n' + tableStr + '\n' + md.slice(insertIdx);
            writeManifest(wsRoot, md);
            return { toolResult: `Section ${section} created`, content: [{ type: "text", text: `Created ${section} table with ${rows.length} rows` }] };
        }

        // === GAP 9: reassign_agent ===
        if (name === "reassign_agent") {
            const { from_agent_id, to_agent_id, to_role, to_model } = args as any;
            if (!from_agent_id || !to_agent_id) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);

            // 1. Read source agent's progress
            const fromProgress = readAgentProgress(wsRoot, from_agent_id);
            const agentsTable = getTableFromSection(md, "Agents");
            if (!agentsTable) throw new Error("No Agents table in manifest");
            const fromRow = agentsTable.rows.find(r => r["ID"] === from_agent_id);
            if (!fromRow) throw new Error(`Agent ${from_agent_id} not found in manifest`);

            // 2. Get uncompleted file claims
            const pendingClaims = fromProgress?.file_claims.filter(c => c.status !== "✅ Done") || [];

            // 3. Create new agent row
            const newRow = {
                "ID": to_agent_id,
                "Role": to_role || fromRow["Role"],
                "Model": to_model || fromRow["Model"],
                "Phase": fromRow["Phase"],
                "Scope": fromRow["Scope"],
                "Status": "⏳ Pending"
            };
            agentsTable.rows.push(newRow);

            // 4. Mark old agent as reassigned
            fromRow["Status"] = "🔄 Reassigned → " + to_agent_id;
            const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
            if (updated) writeManifest(wsRoot, updated);

            // 5. Create initial progress for new agent with transferred claims
            const newProgress = createAgentProgress(to_agent_id, newRow["Role"], newRow["Phase"], sessionId);
            newProgress.detail = `Reassigned from ${from_agent_id}`;
            for (const claim of pendingClaims) {
                newProgress.file_claims.push({ file: claim.file, status: "📋 Transferred" });
            }
            const transferNote = `Reassigned from ${from_agent_id}. Pending files: ${pendingClaims.map(c => c.file).join(", ") || "none"}`;
            newProgress.handoff_notes = transferNote;
            writeAgentProgress(wsRoot, newProgress);

            // 6. Post handoff note
            if (fromProgress) {
                const ts = new Date().toISOString().slice(0, 19);
                fromProgress.handoff_notes = (fromProgress.handoff_notes || '') + `\n[${ts}] [SYSTEM] ${from_agent_id} reassigned to ${to_agent_id}`;
                writeAgentProgress(wsRoot, fromProgress);
            }

            return { toolResult: `Reassigned ${from_agent_id} → ${to_agent_id}`, content: [{ type: "text", text: `Reassigned ${from_agent_id} → ${to_agent_id}. Transferred ${pendingClaims.length} pending file claims.` }] };
        }

        // === GAP 11: request_scope_expansion ===
        if (name === "request_scope_expansion") {
            const { agent_id, file_path, reason } = args as any;
            if (!agent_id || !file_path || !reason) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);

            // Store as an issue with special type
            let progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) {
                progress = createAgentProgress(agent_id, "unknown", "0", sessionId);
            }
            progress.issues.push({
                severity: "🟠 SCOPE_REQUEST",
                area: file_path,
                description: `Scope expansion requested: ${reason}`
            });
            const ts = new Date().toISOString().slice(0, 19);
            progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_REQUEST] ${agent_id} requests access to ${file_path}: ${reason}`;
            writeAgentProgress(wsRoot, progress);

            return { toolResult: `Scope expansion requested`, content: [{ type: "text", text: `${agent_id} requested scope expansion for ${file_path}. PM/Coordinator will see this in get_swarm_status.` }] };
        }

        // === GAP 15: check_quota ===
        if (name === "check_quota") {
            const quotaPath = path.join(os.homedir(), '.antigravity-configs', 'quota_snapshot.json');
            try {
                if (fs.existsSync(quotaPath)) {
                    const quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
                    return { toolResult: JSON.stringify(quota), content: [{ type: "text", text: JSON.stringify(quota, null, 2) }] };
                }
                return { toolResult: "(No quota snapshot found)", content: [{ type: "text", text: "No quota_snapshot.json found. Run quota_check.ps1 or .sh first." }] };
            } catch (e: any) {
                return { toolResult: `Quota check failed: ${e.message}`, content: [{ type: "text", text: `Error reading quota: ${e.message}` }] };
            }
        }

        // === GAP 16: advance_phase ===
        if (name === "advance_phase") {
            const { from_phase, to_phase } = args as any;
            if (!from_phase || !to_phase) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);

            // 1. Validate from_phase gate
            const allProgress = readAllAgentProgress(wsRoot, sessionId);
            const agentsTable = getTableFromSection(md, "Agents");
            const fromPhaseAgents = (agentsTable?.rows || []).filter(r => r["Phase"]?.trim() === from_phase);
            const terminal = ["Complete", "Done", "Failed"];
            const allDone = fromPhaseAgents.every(r => {
                const ap = allProgress.find(a => a.agent_id === r["ID"]);
                const status = ap ? ap.status : r["Status"];
                return terminal.some(t => status?.includes(t));
            });

            if (!allDone) {
                const pending = fromPhaseAgents.filter(r => {
                    const ap = allProgress.find(a => a.agent_id === r["ID"]);
                    const status = ap ? ap.status : r["Status"];
                    return !terminal.some(t => status?.includes(t));
                }).map(r => r["ID"]);
                throw new Error(`Phase ${from_phase} not complete. Pending agents: ${pending.join(", ")}`);
            }

            // 2. Rollup progress
            if (agentsTable) {
                for (const ap of allProgress) {
                    const row = agentsTable.rows.find(r => r["ID"] === ap.agent_id);
                    if (row) row["Status"] = ap.status;
                }
                const u = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
                if (u) md = u;
            }

            // 3. Auto-check phase gate
            const gateRegex = new RegExp(`(- \\[)( )(\\]\\s*Phase ${from_phase}\\b)`, 'i');
            md = md.replace(gateRegex, '$1x$3');
            writeManifest(wsRoot, md);

            // 4. Update registry
            try { updateSwarmRegistry(wsRoot, { phase: to_phase }); } catch { /* non-fatal */ }

            // 5. Return Phase 2 agents
            const nextPhaseAgents = (agentsTable?.rows || []).filter(r => r["Phase"]?.trim() === to_phase);
            writeSwarmStatus(wsRoot, md, `Phase ${from_phase} → ${to_phase}`);

            return { toolResult: `Advanced to phase ${to_phase}`, content: [{ type: "text", text: `Phase ${from_phase} complete ✅. Advanced to Phase ${to_phase}. Next agents: ${nextPhaseAgents.map(a => `${a["ID"]} (${a["Role"]})`).join(", ") || "none"}` }] };
        }

        // === GAP 17: complete_swarm ===
        if (name === "complete_swarm") {
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);

            // 1. Final rollup
            const allProgress = readAllAgentProgress(wsRoot, sessionId);
            const agentsTable = getTableFromSection(md, "Agents");
            if (agentsTable) {
                for (const ap of allProgress) {
                    const row = agentsTable.rows.find(r => r["ID"] === ap.agent_id);
                    if (row) row["Status"] = ap.status;
                }
                const u = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
                if (u) md = u;
            }
            writeManifest(wsRoot, md);

            // 2. Archive manifest
            const archiveDir = path.join(wsRoot, '.swarm-archives');
            if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
            const archiveName = `swarm-manifest-${sessionId.replace(/[:.]/g, '-')}.md`;
            fs.copyFileSync(path.join(wsRoot, 'swarm-manifest.md'), path.join(archiveDir, archiveName));

            // 3. Clean up agent files
            const cleaned = cleanupAgentFiles(wsRoot);

            // 4. Clean up events
            try { cleanupEvents(wsRoot, sessionId); } catch { /* non-fatal */ }

            // 5. Deregister from swarm registry
            try { deregisterSwarm(wsRoot); } catch { /* non-fatal */ }

            // 6. Write final status
            writeSwarmStatus(wsRoot, md, "Swarm completed");

            const totalAgents = agentsTable?.rows.length || 0;
            const completedAgents = allProgress.filter(a => a.status?.includes("Complete") || a.status?.includes("Done")).length;
            const failedAgents = allProgress.filter(a => a.status?.includes("Failed")).length;

            return { toolResult: "Swarm completed", content: [{ type: "text", text: `Swarm completed. ${completedAgents}/${totalAgents} agents succeeded, ${failedAgents} failed. Archived to ${archiveName}. Cleaned ${cleaned} agent files.` }] };
        }

        // === GAP 4: get_my_assignment ===
        if (name === "get_my_assignment") {
            const { agent_id } = args as any;
            if (!agent_id) throw new Error("Missing required argument: agent_id");
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);

            const agentsTable = getTableFromSection(md, "Agents");
            if (!agentsTable) throw new Error("No Agents table in manifest");
            const row = agentsTable.rows.find(r => r["ID"] === agent_id);
            if (!row) throw new Error(`Agent ${agent_id} not found in manifest`);

            return { toolResult: JSON.stringify(row), content: [{ type: "text", text: JSON.stringify(row, null, 2) }] };
        }

        // === GAP 6: get_agent_progress ===
        if (name === "get_agent_progress") {
            const { agent_id } = args as any;
            if (!agent_id) throw new Error("Missing required argument: agent_id");
            const wsRoot = resolveWorkspaceRoot(args as any);

            const progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) throw new Error(`No progress file found for agent ${agent_id}`);

            return { toolResult: JSON.stringify(progress), content: [{ type: "text", text: JSON.stringify(progress, null, 2) }] };
        }

        // === GAP 18: update_phase_gate ===
        if (name === "update_phase_gate") {
            const { phase_number, complete } = args as any;
            if (phase_number === undefined || complete === undefined) throw new Error("Missing required arguments");
            const wsRoot = resolveWorkspaceRoot(args as any);
            let md = readManifest(wsRoot);

            const checkChar = complete ? 'x' : ' ';
            const uncheckedRegex = new RegExp(`(- \\[)[ x](\\]\\s*Phase ${phase_number}\\b)`, 'i');
            const newMd = md.replace(uncheckedRegex, `$1${checkChar}$2`);

            if (newMd === md) throw new Error(`Phase gate ${phase_number} not found in manifest`);
            writeManifest(wsRoot, newMd);
            writeSwarmStatus(wsRoot, newMd, `Phase gate ${phase_number} ${complete ? 'checked' : 'unchecked'}`);

            return { toolResult: `Phase gate ${phase_number} updated`, content: [{ type: "text", text: `Phase gate ${phase_number} ${complete ? '✅ checked' : '⬜ unchecked'}` }] };
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (error: any) {
        return {
            toolResult: `Error executing tool: ${error.message}`,
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true
        };
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Agent Coordinator MCP server running on stdio");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
