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
import path from "path";
import os from "os";
import fs from "fs";

// Determine workspace root. Since this server runs in the context of the workspace, CWD is usually correct, or we take a fallback.
const workspaceRoot = process.cwd();
const globalConfigPath = path.join(os.homedir(), ".antigravity-configs");

const server = new Server(
    {
        name: "agent-coordinator",
        version: "1.0.0",
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
        const modeSection = md.match(/Supervision:\s*(\w+)/);
        const supervision = modeSection ? modeSection[1] : "unknown";

        const agentsTable = getTableFromSection(md, "Agents");
        const agents = agentsTable?.rows || [];
        const active = agents.filter(a => a["Status"]?.includes("Active")).length;
        const complete = agents.filter(a => a["Status"]?.includes("Complete")).length;
        const pending = agents.filter(a => a["Status"]?.includes("Pending")).length;

        const statusObj = {
            supervision,
            agents_active: active,
            agents_complete: complete,
            agents_pending: pending,
            last_event: lastEvent,
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(path.join(rootDir, "swarm_status.json"), JSON.stringify(statusObj, null, 2));
    } catch (e) {
        // silently fail status write
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
            const content = readManifest(workspaceRoot);
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
                        supervision_level: { type: "string", description: "Supervision level (e.g. gates, full, auto)" }
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
                        section: { type: "string", description: "The section heading (e.g., Agents, File Claims, Issues)" }
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
                        status: { type: "string", description: "New status like '✅ Complete', '🔄 Active', '⏳ Pending'" }
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
                        phase_number: { type: "string", description: "Phase number to check" }
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
                        file_path: { type: "string" }
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
                        file_path: { type: "string" }
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
                        status: { type: "string", description: "Status e.g. '✅ Done'" }
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
                        reporter: { type: "string" }
                    },
                    required: ["severity", "description", "reporter"]
                }
            },
            {
                name: "get_swarm_status",
                description: "Return a structured status summary across all agents and phase gates",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "create_swarm_manifest") {
            const templatePath = path.join(globalConfigPath, "templates", "swarm-manifest.md");
            if (!fs.existsSync(templatePath)) throw new Error("Template not found");
            let content = fs.readFileSync(templatePath, "utf8");

            const mission = (args as any).mission || "";
            const supervision = (args as any).supervision_level || "Full";

            content = content.replace("$MISSION", mission);
            content = content.replace("## Mode\n\n[Supervision Level]", `## Mode\n\n${supervision}`);

            writeManifest(workspaceRoot, content);
            writeSwarmStatus(workspaceRoot, content, "Swarm initialized");
            return { toolResult: "Manifest created successfully.", content: [{ type: "text", text: "Manifest created successfully." }] };
        }

        if (name === "read_manifest_section") {
            const md = readManifest(workspaceRoot);
            const section = (args as any).section;
            const res = getTableFromSection(md, section);
            if (!res) throw new Error(`Section ${section} not found or no table in it`);
            return { toolResult: JSON.stringify(res, null, 2), content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }

        if (name === "update_agent_status") {
            const { agent_id, status } = args as any;
            let md = readManifest(workspaceRoot);
            const res = getTableFromSection(md, "Agents");
            if (!res) throw new Error("Agents section not found");

            const row = res.rows.find(r => r["ID"] === agent_id);
            if (!row) throw new Error(`Agent ID ${agent_id} not found`);
            row["Status"] = status;

            const newTable = serializeTableToString(res.headers, res.rows);
            md = replaceTableInSection(md, "Agents", newTable)!;
            writeManifest(workspaceRoot, md);
            writeSwarmStatus(workspaceRoot, md, `Agent ${agent_id} status updated to ${status}`);
            return { toolResult: `Agent ${agent_id} status updated to ${status}`, content: [{ type: "text", text: `Agent ${agent_id} status updated to ${status}` }] };
        }

        if (name === "check_phase_gates") {
            const md = readManifest(workspaceRoot);
            const res = getTableFromSection(md, "Agents");
            if (!res) throw new Error("Agents section not found");

            const phaseNum = (args as any).phase_number;
            const phaseAgents = res.rows.filter(r => r["Phase"]?.includes(phaseNum));
            if (phaseAgents.length === 0) return { content: [{ type: "text", text: "No agents in this phase." }] };

            const allDone = phaseAgents.every(r => r["Status"] === "✅ Complete");
            const summary = phaseAgents.map(r => `${r["ID"]}: ${r["Status"]}`).join("\n");

            const resultText = `All agents complete: ${allDone}\nDetails:\n${summary}`;
            return { toolResult: resultText, content: [{ type: "text", text: resultText }] };
        }

        if (name === "claim_file") {
            const { agent_id, file_path } = args as any;
            let md = readManifest(workspaceRoot);
            let res = getTableFromSection(md, "File Claims");
            if (!res) throw new Error("File Claims section not found");

            const existing = res.rows.find(r => r["File"] === file_path && !r["Status"]?.includes("Done") && !r["Status"]?.includes("Abandoned"));
            if (existing) {
                throw new Error(`File ${file_path} is currently claimed by agent ${existing["Agent ID"]} with status ${existing["Status"]}`);
            }

            res.rows.push({
                "Agent ID": agent_id,
                "File": file_path,
                "Status": "🔄 Active"
            });

            md = replaceTableInSection(md, "File Claims", serializeTableToString(res.headers, res.rows))!;
            writeManifest(workspaceRoot, md);
            return { toolResult: `File ${file_path} claimed by ${agent_id}`, content: [{ type: "text", text: `File ${file_path} claimed by ${agent_id}` }] };
        }

        if (name === "check_file_claim") {
            const { file_path } = args as any;
            const md = readManifest(workspaceRoot);
            const res = getTableFromSection(md, "File Claims");
            if (!res) throw new Error("File Claims section not found");

            const existing = res.rows.filter(r => r["File"] === file_path);
            return { content: [{ type: "text", text: JSON.stringify(existing, null, 2) }] };
        }

        if (name === "release_file_claim") {
            const { agent_id, file_path, status } = args as any;
            let md = readManifest(workspaceRoot);
            const res = getTableFromSection(md, "File Claims");
            if (!res) throw new Error("File Claims section not found");

            const row = res.rows.find(r => r["File"] === file_path && r["Agent ID"] === agent_id && !r["Status"]?.includes("Done"));
            if (!row) throw new Error(`Active claim for ${file_path} by ${agent_id} not found`);
            row["Status"] = status;

            md = replaceTableInSection(md, "File Claims", serializeTableToString(res.headers, res.rows))!;
            writeManifest(workspaceRoot, md);
            return { toolResult: `File ${file_path} claim released with status ${status}`, content: [{ type: "text", text: `File ${file_path} claim released with status ${status}` }] };
        }

        if (name === "get_agent_prompt") {
            const { role, mission, scope, agent_id } = args as any;
            const promptPath = path.join(globalConfigPath, "templates", "agent-prompts", `${role}.md`);
            if (!fs.existsSync(promptPath)) throw new Error(`Prompt template for ${role} not found at ${promptPath}`);

            let prompt = fs.readFileSync(promptPath, "utf8");
            prompt = prompt.replace(/\$MISSION/g, mission || "");
            prompt = prompt.replace(/\$SCOPE/g, scope || "");
            prompt = prompt.replace(/\$AGENT_ID/g, agent_id || "");

            return { toolResult: prompt, content: [{ type: "text", text: prompt }] };
        }

        if (name === "report_issue") {
            const { severity, area, description, reporter } = args as any;
            let md = readManifest(workspaceRoot);
            const res = getTableFromSection(md, "Issues");
            if (!res) throw new Error("Issues section not found");

            res.rows.push({
                "Severity": severity,
                "Area/File": area || "",
                "Description": description,
                "Reporter": reporter || ""
            });

            md = replaceTableInSection(md, "Issues", serializeTableToString(res.headers, res.rows))!;
            writeManifest(workspaceRoot, md);
            return { toolResult: `Issue reported: ${description}`, content: [{ type: "text", text: `Issue reported: ${description}` }] };
        }

        if (name === "get_swarm_status") {
            const md = readManifest(workspaceRoot);
            const agents = getTableFromSection(md, "Agents")?.rows || [];
            const gates = getTableFromSection(md, "Phase Gates")?.rows || [];
            const issues = getTableFromSection(md, "Issues")?.rows || [];

            return { content: [{ type: "text", text: JSON.stringify({ agents, gates, issues }, null, 2) }] };
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
