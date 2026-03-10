/**
 * Bridge Client — HTTP client for the Antigravity Agent Bridge extension.
 *
 * Communicates with the Agent Bridge VS Code extension running on localhost.
 * All connections are strictly local; no external network calls.
 */

export interface SpawnOptions {
    newConversation?: boolean;
    background?: boolean;
    agentManager?: boolean;
}

export interface SpawnResult {
    success: boolean;
    conversationId?: string;
    error?: string;
    promptLength?: number;
}

export interface BridgeConversation {
    id: string;
    title?: string;
    status?: string;
    createdAt?: string;
}

export interface BridgeHealth {
    online: boolean;
    version?: string;
    uptime?: number;
    conversations?: number;
}

export class BridgeClient {
    private readonly baseUrl: string;
    private readonly spawnTimeoutMs: number;
    private readonly healthTimeoutMs: number;

    constructor(opts?: { port?: number; spawnTimeoutMs?: number; healthTimeoutMs?: number }) {
        const port = opts?.port ?? parseInt(process.env.AGENT_BRIDGE_PORT ?? "9090", 10);
        this.baseUrl = `http://127.0.0.1:${port}`;
        this.spawnTimeoutMs = opts?.spawnTimeoutMs ?? 10_000;
        this.healthTimeoutMs = opts?.healthTimeoutMs ?? 3_000;
    }

    /**
     * Spawn a new agent with the given prompt text.
     */
    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        const body = {
            prompt,
            newConversation: opts?.newConversation ?? true,
            background: opts?.background ?? true,
            agentManager: opts?.agentManager ?? true,
        };

        try {
            const resp = await this.fetch("/api/agent/spawn", {
                method: "POST",
                body: JSON.stringify(body),
                timeoutMs: this.spawnTimeoutMs,
            });

            if (!resp.ok) {
                const text = await resp.text();
                return { success: false, error: `Bridge returned ${resp.status}: ${text}`, promptLength: prompt.length };
            }

            const data = await resp.json() as Record<string, unknown>;
            return {
                success: true,
                conversationId: (data.conversationId ?? data.conversation_id ?? data.id) as string | undefined,
                promptLength: prompt.length,
            };
        } catch (err) {
            return {
                success: false,
                error: `Bridge connection failed: ${(err as Error).message}`,
                promptLength: prompt.length,
            };
        }
    }

    /**
     * List active conversations from the bridge.
     */
    async getConversations(): Promise<BridgeConversation[]> {
        try {
            const resp = await this.fetch("/api/conversations", {
                method: "GET",
                timeoutMs: this.healthTimeoutMs,
            });
            if (!resp.ok) return [];
            return (await resp.json()) as BridgeConversation[];
        } catch {
            return [];
        }
    }

    /**
     * Get detail for a specific conversation.
     */
    async getConversation(id: string): Promise<Record<string, unknown> | null> {
        try {
            const resp = await this.fetch(`/api/conversations/${encodeURIComponent(id)}`, {
                method: "GET",
                timeoutMs: this.healthTimeoutMs,
            });
            if (!resp.ok) return null;
            return (await resp.json()) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    /**
     * Health check — returns bridge status and metadata.
     */
    async ping(): Promise<BridgeHealth> {
        try {
            const resp = await this.fetch("/api/health", {
                method: "GET",
                timeoutMs: this.healthTimeoutMs,
            });
            if (!resp.ok) return { online: false };
            const data = await resp.json() as Record<string, unknown>;
            return {
                online: true,
                version: data.version as string | undefined,
                uptime: data.uptime as number | undefined,
                conversations: data.conversations as number | undefined,
            };
        } catch {
            return { online: false };
        }
    }

    /**
     * Internal fetch wrapper with timeout support.
     */
    private async fetch(
        path: string,
        opts: { method: string; body?: string; timeoutMs: number }
    ): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

        try {
            const headers: Record<string, string> = {};
            if (opts.body) headers["Content-Type"] = "application/json";

            return await globalThis.fetch(`${this.baseUrl}${path}`, {
                method: opts.method,
                headers,
                body: opts.body,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }
}

/** Singleton bridge client instance */
let _bridgeClient: BridgeClient | undefined;

export function getBridgeClient(): BridgeClient {
    if (!_bridgeClient) {
        _bridgeClient = new BridgeClient();
    }
    return _bridgeClient;
}
