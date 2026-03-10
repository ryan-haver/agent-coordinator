import type {
    AgentProvider,
    ProviderHealth,
    SpawnOptions,
    SpawnResult,
    AgentStatus,
    SessionInfo
} from "./provider.js";

export interface HeadlessConfig {
    endpoint: string;
    apiKey?: string;
    defaultModel: string;
}

export class HeadlessProvider implements AgentProvider {
    readonly name = "headless";
    readonly displayName = "Headless Server (HTTP)";
    readonly capabilities = ["chat", "planning"]; // restricted for direct inference mode without tool loop

    private sessions = new Map<string, {
        startedAt: number;
        state: "running" | "completed" | "failed" | "stopped" | "unknown";
    }>();

    private _fetch: typeof fetch;

    constructor(private config: HeadlessConfig, _fetchFn?: typeof fetch) {
        this._fetch = _fetchFn || fetch;
    }

    get models() {
        return [this.config.defaultModel];
    }

    async ping(): Promise<ProviderHealth> {
        const start = Date.now();
        try {
            // standard vLLM / Ollama compatible endpoint check
            const res = await this._fetch(`${this.config.endpoint}/models`, {
                headers: this.config.apiKey ? {
                    "Authorization": `Bearer ${this.config.apiKey}`
                } : undefined
            });

            if (res.ok) {
                return {
                    online: true,
                    latencyMs: Date.now() - start
                };
            } else {
                return {
                    online: false,
                    latencyMs: Date.now() - start,
                    error: `Received status code ${res.status}`
                };
            }
        } catch (error: any) {
            return {
                online: false,
                latencyMs: Date.now() - start,
                error: error.message
            };
        }
    }

    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        const conversationId = `headless-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
            // In a headless inference mode, spawning might mean triggering the initial planning completion
            // For now, we'll store the session and pretend it runs since there's no continuous native agent loop.
            // If we wanted real agent loop, we'd need to implement executor loop here.
            
            this.sessions.set(conversationId, {
                startedAt: Date.now(),
                state: "running"
            });

            // Fire off a background completion request to simulate activity
            this._runBackground(conversationId, prompt, opts).catch(() => {});

            return {
                success: true,
                conversationId,
                promptLength: prompt.length,
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    private async _runBackground(conversationId: string, prompt: string, opts?: SpawnOptions) {
        // Implementation of actual completion loop to endpoint can be placed here.
        // For basic integration, we just do one completion.
        const session = this.sessions.get(conversationId);
        if (!session) return;

        try {
            const res = await this._fetch(`${this.config.endpoint}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(this.config.apiKey ? { "Authorization": `Bearer ${this.config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    model: this.config.defaultModel,
                    messages: [{ role: "user", content: prompt }]
                })
            });
            if (res.ok) {
                session.state = "completed";
            } else {
                session.state = "failed";
            }
        } catch (e) {
            session.state = "failed";
        }
    }

    async getAgentStatus(conversationId: string): Promise<AgentStatus> {
        const session = this.sessions.get(conversationId);
        if (!session) {
            return {
                conversationId,
                state: "unknown",
                error: "Session not found."
            };
        }

        return {
            conversationId,
            state: session.state,
            lastActiveAt: Date.now()
        };
    }

    async listSessions(): Promise<SessionInfo[]> {
        const infos: SessionInfo[] = [];
        for (const [id, session] of this.sessions.entries()) {
            infos.push({
                conversationId: id,
                state: session.state,
                startedAt: session.startedAt
            });
        }
        return infos;
    }

    async stop(conversationId: string): Promise<void> {
        const session = this.sessions.get(conversationId);
        if (session) {
            session.state = "stopped";
        }
    }
}
