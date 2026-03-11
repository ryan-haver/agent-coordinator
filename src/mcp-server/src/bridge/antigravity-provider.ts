/**
 * AntigravityProvider — implements AgentProvider for the Antigravity IDE.
 *
 * Wraps the ConnectRpcClient to issue headless agent spawns directly to the
 * Gemini Language Server via native ConnectRPC, bypassing the IDE GUI.
 *
 * Architecture:
 *   AntigravityProvider.spawn()
 *     → ConnectRpcClient.spawn()
 *       → Language Server (StartCascade + SendUserCascadeMessage)
 */
import type {
    AgentProvider,
    ProviderHealth,
    SpawnOptions,
    SpawnResult,
    AgentStatus,
    SessionInfo,
} from "./provider.js";
import { ConnectRpcClient } from "./connect-rpc-client.js";
import { getModelCatalog } from "./model-catalog.js";

export class AntigravityProvider implements AgentProvider {
    readonly name = "antigravity";
    readonly displayName = "Antigravity IDE";
    private readonly rpcClient: ConnectRpcClient;

    constructor() {
        this.rpcClient = new ConnectRpcClient();
    }

    /** Dynamic model list — reads live from state.vscdb via ModelCatalog */
    get models(): string[] {
        return getModelCatalog().getModelLabels();
    }

    readonly capabilities = ["file-edit", "terminal", "browser", "mcp", "git"];

    async ping(): Promise<ProviderHealth> {
        const start = Date.now();
        try {
            await this.rpcClient.connect();
            // Refresh catalog on ping so models stay fresh
            getModelCatalog().invalidate();
            return {
                online: true,
                latencyMs: Date.now() - start,
                version: "native-rpc-v1",
            };
        } catch {
            return {
                online: false,
                latencyMs: Date.now() - start,
            };
        }
    }

    async spawn(prompt: string, opts: SpawnOptions = {}): Promise<SpawnResult> {
        const result = await this.rpcClient.spawn(prompt, {
            workingDirectory: opts.workingDirectory,
            agenticMode: true,
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
            artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO",
        });
        return {
            success: result.success,
            conversationId: result.conversationId,
            promptLength: result.promptLength,
            error: result.error,
            metadata: { provider: this.name },
        };
    }

    /**
     * Agent status tracking is not available via ConnectRPC.
     * The Language Server does not expose session state queries.
     * Use the ErrorDetector watch mechanism for lifecycle tracking instead.
     */
    async getAgentStatus(conversationId: string): Promise<AgentStatus> {
        return { conversationId, state: "unknown" };
    }

    /**
     * Session listing is not available via ConnectRPC.
     * The Language Server does not expose an active session list endpoint.
     */
    async listSessions(): Promise<SessionInfo[]> {
        return [];
    }

    async stop(conversationId: string): Promise<void> {
        // Attempt to cancel the cascade via ConnectRPC.
        // CancelCascade may not be implemented — degrade gracefully.
        try {
            await this.rpcClient.rpc("CancelCascade", { cascadeId: conversationId });
        } catch {
            // RPC not supported or cascade already finished — no-op
        }
    }
}

// ── Factory ────────────────────────────────────────────────────────

let instance: AntigravityProvider | undefined;

export function getAntigravityProvider(): AntigravityProvider {
    if (!instance) {
        instance = new AntigravityProvider();
    }
    return instance;
}
