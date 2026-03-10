/**
 * AgentProvider interface — the contract every backend must implement.
 *
 * Providers are runtime plugins that know how to spawn and manage
 * agent sessions on a specific backend (Antigravity, Claude Code, Codex, etc.).
 * The MCP server orchestrates through this interface without caring
 * about the underlying mechanism.
 */

/** Health status returned by provider.ping() */
export interface ProviderHealth {
    online: boolean;
    latencyMs: number;
    version?: string;
    error?: string;
}

/** Options passed to provider.spawn() */
export interface SpawnOptions {
    /** Start a new conversation (default: true) */
    newConversation?: boolean;
    /** Run in background (default: true) */
    background?: boolean;
    /** Use agent manager mode if supported */
    agentManager?: boolean;
    /** Working directory for the agent */
    workingDirectory?: string;
    /** Environment variables to inject */
    env?: Record<string, string>;
    /** Maximum turns before auto-stop */
    turnLimit?: number;
}

/** Result of a spawn operation */
export interface SpawnResult {
    success: boolean;
    conversationId?: string;
    promptLength?: number;
    error?: string;
    /** Provider-specific metadata */
    metadata?: Record<string, unknown>;
}

/** Status of a running agent */
export interface AgentStatus {
    conversationId: string;
    state: "running" | "completed" | "failed" | "stopped" | "unknown";
    /** Number of turns completed */
    turns?: number;
    /** Last activity timestamp */
    lastActiveAt?: number;
    /** Error message if state is "failed" */
    error?: string;
    /** The last message from the agent */
    lastMessage?: string;
}

/** Brief info about an active session */
export interface SessionInfo {
    conversationId: string;
    state: string;
    startedAt: number;
    agentId?: string;
}

/**
 * AgentProvider — the contract every spawn backend implements.
 *
 * Examples:
 *   - AntigravityProvider: HTTP to Bridge extension on :9090
 *   - ClaudeCodeProvider: CLI subprocess via `claude --print`
 *   - CodexProvider: CLI subprocess via `codex --approval-mode full-auto`
 *   - HeadlessProvider: Raw HTTP API to vLLM/Ollama
 */
export interface AgentProvider {
    /** Unique identifier (e.g. "antigravity", "claude-code") */
    readonly name: string;

    /** Display name for UIs */
    readonly displayName: string;

    /** Models this provider can serve */
    readonly models: string[];

    /** Capabilities: "file-edit", "terminal", "browser", "mcp", "git" */
    readonly capabilities: string[];

    /** Check if the provider is available */
    ping(): Promise<ProviderHealth>;

    /** Spawn a new agent with the given prompt */
    spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult>;

    /** Get status of a running agent */
    getAgentStatus(conversationId: string): Promise<AgentStatus>;

    /** List active sessions managed by this provider */
    listSessions(): Promise<SessionInfo[]>;

    /** Stop an agent */
    stop(conversationId: string): Promise<void>;
}

/** Provider registration metadata */
export interface ProviderConfig {
    /** Whether the provider is enabled */
    enabled: boolean;
    /** Priority for routing (lower = higher priority) */
    priority: number;
    /** Max concurrent agents for this provider */
    maxConcurrent: number;
    /** Provider-specific settings */
    settings?: Record<string, unknown>;
}
