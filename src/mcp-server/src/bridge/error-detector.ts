/**
 * Error Detector — monitors agent health and manages retry logic.
 *
 * Polls the Agent Bridge for conversation status and detects failures.
 * Supports configurable retry policies with escalating context.
 */
import { getBridgeClient } from "./client.js";
import { getRateLimiter } from "./rate-limiter.js";

export interface AgentWatch {
    agentId: string;
    conversationId: string;
    providerName: string;
    startedAt: number;
    lastCheckedAt: number;
    attempt: number;
    maxRetries: number;
    status: "running" | "completed" | "failed" | "retrying";
    lastError?: string;
}

export interface RetryDecision {
    retry: boolean;
    delay: number;
    attempt: number;
    reason: string;
}

/** Patterns indicating agent failure */
const ERROR_PATTERNS = [
    "Agent terminated",
    "Error:",
    "context window exceeded",
    "rate limit",
    "quota exceeded",
    "internal error",
    "connection reset",
    "RESOURCE_EXHAUSTED",
    "DEADLINE_EXCEEDED",
];

export class ErrorDetector {
    private watches = new Map<string, AgentWatch>();
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private readonly pollIntervalMs: number;
    private readonly maxRetries: number;
    private readonly baseRetryDelayMs: number;
    private onAgentFailed?: (watch: AgentWatch) => void;
    private onAgentCompleted?: (watch: AgentWatch) => void;

    constructor(opts?: {
        pollIntervalMs?: number;
        maxRetries?: number;
        baseRetryDelayMs?: number;
        onAgentFailed?: (watch: AgentWatch) => void;
        onAgentCompleted?: (watch: AgentWatch) => void;
    }) {
        this.pollIntervalMs = opts?.pollIntervalMs ?? 30_000;
        this.maxRetries = opts?.maxRetries ?? 2;
        this.baseRetryDelayMs = opts?.baseRetryDelayMs ?? 5_000;
        this.onAgentFailed = opts?.onAgentFailed;
        this.onAgentCompleted = opts?.onAgentCompleted;
    }

    /**
     * Start watching an agent's conversation for failures.
     */
    watchAgent(agentId: string, conversationId: string, providerName: string, attempt = 1): void {
        const now = Date.now();
        this.watches.set(agentId, {
            agentId,
            conversationId,
            providerName,
            startedAt: now,
            lastCheckedAt: now,
            attempt,
            maxRetries: this.maxRetries,
            status: "running",
        });

        // Start polling if not already running
        if (!this.pollTimer && this.watches.size > 0) {
            this.pollTimer = setInterval(() => this.pollAll(), this.pollIntervalMs);
        }
    }

    /**
     * Stop watching an agent.
     */
    unwatchAgent(agentId: string): void {
        this.watches.delete(agentId);
        if (this.watches.size === 0 && this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    /**
     * Determine if an agent should be retried.
     */
    shouldRetry(agentId: string): RetryDecision {
        const watch = this.watches.get(agentId);
        if (!watch) {
            return { retry: false, delay: 0, attempt: 0, reason: "Agent not being watched" };
        }

        if (watch.attempt >= watch.maxRetries) {
            return {
                retry: false,
                delay: 0,
                attempt: watch.attempt,
                reason: `Max retries exhausted (${watch.attempt}/${watch.maxRetries})`,
            };
        }

        const delay = this.baseRetryDelayMs * Math.pow(2, watch.attempt - 1);
        return {
            retry: true,
            delay,
            attempt: watch.attempt + 1,
            reason: `Retry ${watch.attempt + 1}/${watch.maxRetries} after ${Math.ceil(delay / 1000)}s`,
        };
    }

    /**
     * Get all active watches.
     */
    getWatches(): AgentWatch[] {
        return Array.from(this.watches.values());
    }

    /**
     * Get a specific watch.
     */
    getWatch(agentId: string): AgentWatch | undefined {
        return this.watches.get(agentId);
    }

    /**
     * Check if text contains error patterns.
     */
    static containsError(text: string): boolean {
        const lower = text.toLowerCase();
        return ERROR_PATTERNS.some(p => lower.includes(p.toLowerCase()));
    }

    /**
     * Poll all watched agents for status changes.
     */
    async pollAll(): Promise<void> {
        const client = getBridgeClient();
        const { getProviderRegistry } = await import("./registry.js");
        const registry = getProviderRegistry();

        for (const [agentId, watch] of this.watches) {
            if (watch.status !== "running") continue;

            try {
                let statusStr = "";
                let lastMessage = "";

                if (watch.providerName === "antigravity (fallback)") {
                    const conv = await client.getConversation(watch.conversationId);
                    if (!conv) {
                        this.failAgent(watch, "Conversation no longer exists");
                        continue;
                    }
                    statusStr = String(conv.status ?? conv.state ?? "").toLowerCase();
                    lastMessage = String(conv.lastMessage ?? conv.last_message ?? "");
                } else {
                    const provider = registry.getProvider(watch.providerName);
                    if (!provider) {
                        this.failAgent(watch, `Provider ${watch.providerName} not found`);
                        continue;
                    }
                    const status = await provider.getAgentStatus(watch.conversationId);
                    statusStr = status.state.toLowerCase();
                    lastMessage = status.lastMessage ?? "";
                }

                watch.lastCheckedAt = Date.now();

                if (statusStr === "completed" || statusStr === "done") {
                    watch.status = "completed";
                    getRateLimiter().recordCompletion();
                    this.onAgentCompleted?.(watch);
                    continue;
                }

                if (statusStr === "error" || statusStr === "failed" || ErrorDetector.containsError(lastMessage)) {
                    this.failAgent(watch, lastMessage || statusStr);
                    continue;
                }
            } catch {
                // Network error — bridge may be down, don't mark agent as failed yet
            }
        }
    }

    private failAgent(watch: AgentWatch, errorMsg: string) {
        watch.status = "failed";
        watch.lastError = errorMsg;
        getRateLimiter().recordCompletion();
        getRateLimiter().recordError();
        this.onAgentFailed?.(watch);
    }

    /**
     * Stop all polling and clear watches.
     */
    dispose(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.watches.clear();
    }
}

/** Singleton error detector instance */
let _errorDetector: ErrorDetector | undefined;

export function getErrorDetector(): ErrorDetector {
    if (!_errorDetector) {
        _errorDetector = new ErrorDetector();
    }
    return _errorDetector;
}

export function setErrorDetector(detector: ErrorDetector | undefined): void {
    if (_errorDetector) {
        _errorDetector.dispose();
    }
    _errorDetector = detector;
}
