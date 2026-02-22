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

// Read version from package.json at startup
const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..', 'package.json'), 'utf8'));

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

        const agentsTable = getTableFromSection(md, "Agents");
        const agents = agentsTable?.rows || [];
        const active = agents.filter(a => a["Status"]?.includes("Active")).length;
        const complete = agents.filter(a => a["Status"]?.includes("Complete")).length;
        const pending = agents.filter(a => a["Status"]?.includes("Pending")).length;

        // Determine current phase from agent statuses
        const activeAgent = agents.find(a => a["Status"]?.includes("Active"));
        const phase = activeAgent?.["Phase"] || (complete === agents.length ? "done" : "0");

        // Determine if user action is needed (supervision=gates + all phase agents done)
        const phaseAgents = agents.filter(a => a["Phase"]?.trim() === phase);
        const allPhaseAgentsDone = phaseAgents.length > 0 && phaseAgents.every(a => a["Status"]?.includes("Complete"));
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
                        agent_id: { type: "string" }
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
            writeAgentProgress(wsRoot, progress);

            return { toolResult: `Agent ${agent_id} status updated to ${status}`, content: [{ type: "text", text: `Agent ${agent_id} status updated to ${status} (written to agent progress file)` }] };
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

            // Check all agent files for existing active claims
            const allProgress = readAllAgentProgress(wsRoot);
            for (const ap of allProgress) {
                const activeClaim = ap.file_claims.find(c => c.file === file_path && !c.status.includes("Done") && !c.status.includes("Abandoned"));
                if (activeClaim) {
                    throw new Error(`File ${file_path} is currently claimed by agent ${ap.agent_id} with status ${activeClaim.status}`);
                }
            }

            // Write claim to agent's own progress file
            let progress = readAgentProgress(wsRoot, agent_id);
            if (!progress) {
                const md = readManifest(wsRoot);
                const sessionId = extractSessionId(md);
                const res = getTableFromSection(md, "Agents");
                const row = res?.rows.find(r => r["ID"] === agent_id);
                progress = createAgentProgress(agent_id, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
            }
            progress.file_claims.push({ file: file_path, status: "🔄 Active" });
            writeAgentProgress(wsRoot, progress);

            return { toolResult: `File ${file_path} claimed by ${agent_id}`, content: [{ type: "text", text: `File ${file_path} claimed by ${agent_id} (written to agent progress file)` }] };
        }

        if (name === "check_file_claim") {
            const file_path = (args as any)?.file_path;
            if (!file_path) throw new Error("Missing required argument: file_path");
            const wsRoot = resolveWorkspaceRoot(args as any);

            // Check both manifest AND agent progress files for claims
            const claims: Array<{ agent_id: string; file: string; status: string; source: string }> = [];

            // 1. Check agent progress files (most up-to-date)
            const allProgress = readAllAgentProgress(wsRoot);
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

            return { content: [{ type: "text", text: JSON.stringify(claims, null, 2) }] };
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
                if (row) row["Status"] = ap.status;
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

            return { content: [{ type: "text", text: JSON.stringify({ agents, gates, issues }, null, 2) }] };
        }

        if (name === "poll_agent_completion") {
            const phaseNum = (args as any)?.phase_number;
            if (!phaseNum) throw new Error("Missing required argument: phase_number");
            const wsRoot = resolveWorkspaceRoot(args as any);
            const md = readManifest(wsRoot);
            const sessionId = extractSessionId(md);
            const allProgress = readAllAgentProgress(wsRoot, sessionId);
            const phaseAgents = allProgress.filter(a => a.phase === String(phaseNum).trim());

            const terminal = ["Complete", "Done", "Blocked", "Failed"];
            const allDone = phaseAgents.length > 0 &&
                phaseAgents.every(a => terminal.some(t => a.status?.includes(t)));

            const result = {
                all_complete: allDone,
                total_agents: phaseAgents.length,
                agents: phaseAgents.map(a => ({
                    id: a.agent_id,
                    role: a.role,
                    status: a.status,
                    last_updated: a.last_updated
                }))
            };
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
                issuesTable.rows = mergedIssues;
                const updatedIssues = replaceTableInSection(md, "Issues", serializeTableToString(issuesTable.headers, issuesTable.rows));
                if (updatedIssues) md = updatedIssues;
            }

            // 4. Write the consolidated manifest and update swarm status
            writeManifest(wsRoot, md);
            writeSwarmStatus(wsRoot, md, `Rolled up progress from ${allProgress.length} agents`);

            const summary = allProgress.map(ap => `${ap.agent_id} (${ap.role}): ${ap.status}`).join(", ");
            return { toolResult: `Rollup complete: ${summary}`, content: [{ type: "text", text: `Rollup complete for ${allProgress.length} agents: ${summary}` }] };
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
