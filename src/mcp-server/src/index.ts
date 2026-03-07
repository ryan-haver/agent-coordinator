/**
 * Agent Coordinator MCP Server — Thin Router
 *
 * All tool logic lives in src/handlers/*.ts
 * All tool schemas live in src/handlers/tool-definitions.ts
 * This file only handles server setup, resource handlers, and tool dispatch.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { initStorage, getStorage } from "./storage/singleton.js";
import { initTelemetry, getTelemetry, summarizeArgs } from "./telemetry/client.js";
import { initMemory } from "./memory/client.js";
import path from "path";
import os from "os";
import fs from "fs";

import { TOOL_DEFINITIONS } from "./handlers/tool-definitions.js";
import { TOOL_HANDLERS } from "./handlers/index.js";
import { resolveWorkspaceRoot, getGlobalConfigPath } from "./handlers/context.js";

// Read version from package.json at startup
const PKG = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '..', '..', 'package.json'), 'utf8'));

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
    const local = path.join(getGlobalConfigPath(), "model_fallback.json");
    if (fs.existsSync(local)) return local;
    return "";
}

// ── Resource Handlers ──────────────────────────────────────────────────

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
            const content = getStorage().readManifest(wsRoot);
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

// ── Tool Handlers ──────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...TOOL_DEFINITIONS] };
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args as Record<string, unknown>) || {};
    const start = Date.now();

    try {
        const handler = TOOL_HANDLERS[name];
        if (!handler) {
            throw new Error(`Unknown tool: ${name}`);
        }
        const result = await handler(safeArgs);
        const duration = Date.now() - start;

        getTelemetry()?.record({
            tool_name: name,
            agent_id: String(safeArgs.agent_id ?? ""),
            phase: String(safeArgs.phase ?? ""),
            workspace: String(safeArgs.workspace_root ?? ""),
            duration_ms: duration,
            success: true,
            args_summary: summarizeArgs(safeArgs)
        });

        // Emit lifecycle event for key operations
        const EVENT_MAP: Record<string, string> = {
            update_agent_status: "status_change",
            mark_agent_failed: "status_change",
            claim_file: "file_claim",
            release_file_claim: "file_release",
            advance_phase: "phase_advance",
            report_issue: "issue_report",
        };
        const eventType = EVENT_MAP[name];
        if (eventType) {
            getTelemetry()?.recordEvent({
                event_type: eventType,
                agent_id: String(safeArgs.agent_id ?? safeArgs.reporter ?? ""),
                phase: String(safeArgs.phase ?? safeArgs.phase_number ?? ""),
                detail: { tool: name, args: safeArgs },
                duration_ms: duration
            });
        }

        return result;
    } catch (error: any) {
        const duration = Date.now() - start;
        getTelemetry()?.record({
            tool_name: name,
            agent_id: String(safeArgs.agent_id ?? ""),
            phase: String(safeArgs.phase ?? ""),
            workspace: String(safeArgs.workspace_root ?? ""),
            duration_ms: duration,
            success: false,
            error_msg: String(error.message ?? "").slice(0, 500),
            args_summary: summarizeArgs(safeArgs)
        });
        return {
            toolResult: `Error executing tool: ${error.message}`,
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true
        };
    }
});

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
    const backend = process.env.STORAGE_BACKEND || "file";
    initStorage(backend);
    console.error(`[agent-coordinator] Storage backend: ${backend}`);

    // Init telemetry (soft dependency — no-ops if TSDB_URL not set)
    const wsRoot = resolveWorkspaceRoot();
    const telemetry = initTelemetry(wsRoot, "");
    console.error(`[agent-coordinator] Telemetry: ${process.env.TSDB_URL ? "enabled" : "local-only"}`);

    // Init semantic memory (soft dependency — no-ops if QDRANT_URL not set)
    await initMemory();
    console.error(`[agent-coordinator] Semantic memory: ${process.env.QDRANT_URL ? "enabled" : "disabled (QDRANT_URL not set)"}`);

    // Graceful shutdown
    process.on("SIGINT", () => { telemetry.shutdown().finally(() => process.exit(0)); });
    process.on("SIGTERM", () => { telemetry.shutdown().finally(() => process.exit(0)); });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Agent Coordinator MCP server running on stdio");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
