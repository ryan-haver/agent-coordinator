/**
 * Integration test server harness.
 *
 * Creates a real MCP Server + Client pair using InMemoryTransport.
 * No stdio, no subprocess — runs entirely in-process at test speed.
 *
 * Usage:
 *   const { callTool, close } = await createTestServer(tmpDir, { backend: "file" });
 *   const result = await callTool("create_swarm_manifest", { mission: "test" });
 *   await close();
 */
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { TOOL_DEFINITIONS } from "../../../src/handlers/tool-definitions.js";
import { TOOL_HANDLERS } from "../../../src/handlers/index.js";
import { initStorage, resetStorage } from "../../../src/storage/singleton.js";
import { initTelemetry, resetTelemetry, getTelemetry } from "../../../src/telemetry/client.js";
import { resolveWorkspaceRoot } from "../../../src/handlers/context.js";
import { summarizeArgs } from "../../../src/telemetry/client.js";

export interface TestServerOptions {
    /** Storage backend: "file" (default) | "sqlite" */
    backend?: string;
    /** Suppress telemetry (default: true — disabled in tests) */
    disableTelemetry?: boolean;
    /** Override WORKSPACE_ROOT env var */
    workspaceRoot?: string;
}

export interface TestServer {
    /** Call an MCP tool and return the text content of the response. */
    callTool(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
    /** List all registered tools. */
    listTools(): Promise<string[]>;
    /** Tear down server + client, reset singletons. */
    close(): Promise<void>;
    /** Access the raw MCP Client for advanced assertions. */
    client: Client;
}

/**
 * Spin up a full MCP server + client pair in-process.
 */
export async function createTestServer(
    tmpDir: string,
    options: TestServerOptions = {}
): Promise<TestServer> {
    const backend = options.backend ?? "file";
    const disableTelemetry = options.disableTelemetry ?? true;

    // Set required env vars
    process.env.WORKSPACE_ROOT = options.workspaceRoot ?? tmpDir;
    // Point handlers to test fixture's config dir (has provisioned templates)
    const configDir = path.join(tmpDir, ".config");
    process.env.ANTIGRAVITY_CONFIG_DIR = configDir;
    if (disableTelemetry) process.env.TELEMETRY_ENABLED = "false";
    process.env.STORAGE_BACKEND = backend;

    // Init storage singleton
    initStorage(backend);

    // Init telemetry (no-op when TELEMETRY_ENABLED=false)
    const telemetry = initTelemetry(tmpDir, "integration-test");

    // Build server
    const server = new Server(
        { name: "agent-coordinator-test", version: "0.0.0" },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [...TOOL_DEFINITIONS]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
        const { name, arguments: args } = request.params;
        const safeArgs = (args as Record<string, unknown>) || {};
        const start = Date.now();

        try {
            const handler = TOOL_HANDLERS[name];
            if (!handler) throw new Error(`Unknown tool: ${name}`);

            const result = await handler(safeArgs);
            const duration = Date.now() - start;

            if (!disableTelemetry) {
                getTelemetry()?.record({
                    tool_name: name,
                    agent_id: String(safeArgs.agent_id ?? ""),
                    phase: String(safeArgs.phase ?? ""),
                    workspace: String(safeArgs.workspace_root ?? tmpDir),
                    duration_ms: duration,
                    success: true,
                    args_summary: summarizeArgs(safeArgs)
                });
            }
            return result;
        } catch (error: any) {
            const duration = Date.now() - start;
            if (!disableTelemetry) {
                getTelemetry()?.record({
                    tool_name: name,
                    agent_id: String(safeArgs.agent_id ?? ""),
                    phase: String(safeArgs.phase ?? ""),
                    workspace: String(safeArgs.workspace_root ?? tmpDir),
                    duration_ms: duration,
                    success: false,
                    error_msg: String(error.message ?? "").slice(0, 500),
                    args_summary: summarizeArgs(safeArgs)
                });
            }
            return {
                toolResult: `Error: ${error.message}`,
                content: [{ type: "text" as const, text: `Error: ${error.message}` }],
                isError: true
            };
        }
    });

    // Wire InMemoryTransport
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
        { name: "test-client", version: "0.0.0" },
        { capabilities: {} }
    );
    await client.connect(clientTransport);

    return {
        client,

        async callTool(name: string, args: Record<string, unknown> = {}) {
            const result = await client.callTool({ name, arguments: args });
            const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
            const text = content.map(c => c.text ?? "").join("\n");
            const isError = !!(result as any).isError;
            return { text, isError };
        },

        async listTools() {
            const result = await client.listTools();
            return result.tools.map(t => t.name);
        },

        async close() {
            await client.close().catch(() => { });
            await server.close?.().catch(() => { });
            telemetry.close();
            resetTelemetry();
            resetStorage();
            delete process.env.WORKSPACE_ROOT;
            delete process.env.STORAGE_BACKEND;
            delete process.env.TELEMETRY_ENABLED;
            delete process.env.ANTIGRAVITY_CONFIG_DIR;
        }
    };
}
