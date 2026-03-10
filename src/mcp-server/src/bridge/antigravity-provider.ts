/**
 * AntigravityProvider — implements AgentProvider for the Antigravity IDE.
 *
 * Wraps the existing BridgeClient (HTTP to :9090) as a provider
 * conforming to the AgentProvider interface. This is the default
 * and currently only provider.
 *
 * Architecture:
 *   AntigravityProvider.spawn()
 *     → BridgeClient.spawn()  (HTTP POST to :9090)
 *       → Agent Bridge extension
 *         → Antigravity Agent Manager
 */
import type {
    AgentProvider,
    ProviderHealth,
    SpawnOptions,
    SpawnResult,
    AgentStatus,
    SessionInfo,
} from "./provider.js";
import { getBridgeClient } from "./client.js";
import { getModelCatalog } from "./model-catalog.js";

export class AntigravityProvider implements AgentProvider {
    readonly name = "antigravity";
    readonly displayName = "Antigravity IDE";

    /** Dynamic model list — reads live from state.vscdb via ModelCatalog */
    get models(): string[] {
        return getModelCatalog().getModelLabels();
    }

    readonly capabilities = ["file-edit", "terminal", "browser", "mcp", "git"];

    async ping(): Promise<ProviderHealth> {
        const client = getBridgeClient();
        const start = Date.now();
        const result = await client.ping();
        // Refresh catalog on ping so models stay fresh
        getModelCatalog().invalidate();
        return {
            online: result.online,
            latencyMs: Date.now() - start,
            version: result.version,
        };
    }

    async spawn(prompt: string, opts: SpawnOptions = {}): Promise<SpawnResult> {
        const client = getBridgeClient();
        const result = await client.spawn(prompt, {
            newConversation: opts.newConversation ?? true,
            background: opts.background ?? true,
            agentManager: opts.agentManager ?? true,
        });
        return {
            success: result.success,
            conversationId: result.conversationId,
            promptLength: result.promptLength,
            error: result.error,
            metadata: { provider: this.name },
        };
    }

    async getAgentStatus(conversationId: string): Promise<AgentStatus> {
        const client = getBridgeClient();
        const conversations = await client.getConversations();
        const conv = conversations.find(
            (c) => c.id === conversationId
        );
        if (!conv) {
            return { conversationId, state: "unknown" };
        }
        // Map bridge status to provider status
        const status = conv.status ?? "unknown";
        const stateMap: Record<string, AgentStatus["state"]> = {
            running: "running",
            active: "running",
            completed: "completed",
            complete: "completed",
            failed: "failed",
            error: "failed",
            stopped: "stopped",
        };
        return {
            conversationId,
            state: stateMap[status] ?? "unknown",
        };
    }

    async listSessions(): Promise<SessionInfo[]> {
        const client = getBridgeClient();
        const conversations = await client.getConversations();
        return conversations.map((c) => ({
            conversationId: c.id,
            state: c.status ?? "unknown",
            startedAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
        }));
    }

    async stop(conversationId: string): Promise<void> {
        // The bridge doesn't have a direct stop endpoint yet.
        // For now this is a no-op at the provider level;
        // the error detector and spawn handler manage lifecycle.
        void conversationId;
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
