/**
 * Claude Code Provider — spawns agents via the `claude` CLI.
 *
 * Uses `claude --print` mode for non-interactive, structured output.
 * Each agent runs as a detached child process; the PID serves as
 * the conversationId for status tracking and stop operations.
 *
 * Cross-platform: uses child_process.execFile (no shell) and
 * os.platform() for process management.
 */
import { execFile, type ChildProcess } from "child_process";
import os from "os";
import path from "path";
import type {
    AgentProvider,
    ProviderHealth,
    SpawnOptions,
    SpawnResult,
    AgentStatus,
    SessionInfo,
} from "./provider.js";

/** Signature for execFile-compatible function */
export type ExecFileFn = typeof execFile;

/** Configuration for the Claude Code provider */
export interface ClaudeCodeConfig {
    /** Path to the claude CLI binary (default: "claude") */
    command?: string;
    /** Default model to use */
    defaultModel?: string;
    /** Maximum turns per session */
    maxTurns?: number;
    /** Working directory for spawned agents */
    workingDirectory?: string;
    /** Allowed tools pattern (default: "Edit,Write,Bash,mcp__*") */
    allowedTools?: string;
    /** Injectable execFile for testing (default: child_process.execFile) */
    _execFile?: ExecFileFn;
}

/** Tracked session state */
interface TrackedSession {
    pid: number;
    process: ChildProcess;
    agentId?: string;
    startedAt: number;
    prompt: string;
    model: string;
    status: "running" | "completed" | "failed";
    exitCode?: number;
    stdout: string;
    stderr: string;
}

const DEFAULT_CONFIG: ClaudeCodeConfig = {
    command: "claude",
    defaultModel: "claude-sonnet-4-20250514",
    maxTurns: 25,
    allowedTools: "Edit,Write,Bash,mcp__*",
};

/**
 * Claude Code Provider — spawns agents via the `claude` CLI.
 *
 * Implements the AgentProvider interface using `claude --print` mode
 * for non-interactive execution with structured JSON output.
 */
export class ClaudeCodeProvider implements AgentProvider {
    readonly name = "claude-code";
    readonly displayName = "Claude Code (CLI)";
    readonly models = [
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
    ];
    readonly capabilities = ["file-edit", "terminal", "mcp", "git"];

    private config: ClaudeCodeConfig;
    private sessions = new Map<string, TrackedSession>();
    private _exec: ExecFileFn;

    constructor(config?: Partial<ClaudeCodeConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this._exec = config?._execFile ?? execFile;
    }

    /**
     * Check if the claude CLI is available.
     * Runs `claude --version` and measures latency.
     */
    async ping(): Promise<ProviderHealth> {
        const start = Date.now();
        return new Promise<ProviderHealth>((resolve) => {
            const cmd = this.config.command ?? "claude";
            this._exec(cmd, ["--version"], { timeout: 5000 }, (err, stdout) => {
                const latencyMs = Date.now() - start;
                if (err) {
                    resolve({
                        online: false,
                        latencyMs,
                        error: `CLI not found or failed: ${err.message}`,
                    });
                } else {
                    resolve({
                        online: true,
                        latencyMs,
                        version: stdout.trim(),
                    });
                }
            });
        });
    }

    /**
     * Spawn an agent via `claude --print`.
     *
     * CLI args:
     *   claude --print --output-format=json
     *     --max-turns=<N>
     *     --allowedTools="Edit,Write,Bash,mcp__*"
     *     --model=<model>
     *     -p "<prompt>"
     *
     * Returns the PID as conversationId for tracking.
     */
    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        const cmd = this.config.command ?? "claude";
        const model = (opts as Record<string, unknown>)?.model as string
            ?? this.config.defaultModel
            ?? "claude-sonnet-4-20250514";
        const maxTurns = (opts as Record<string, unknown>)?.turnLimit as number
            ?? this.config.maxTurns
            ?? 25;
        const cwd = (opts as Record<string, unknown>)?.workingDirectory as string
            ?? this.config.workingDirectory
            ?? process.cwd();

        const args = [
            "--print",
            "--output-format", "json",
            "--max-turns", String(maxTurns),
            "--model", model,
            "--allowedTools", this.config.allowedTools ?? "Edit,Write,Bash,mcp__*",
            "-p", prompt,
        ];

        return new Promise<SpawnResult>((resolve) => {
            try {
                const child = this._exec(cmd, args, {
                    cwd,
                    maxBuffer: 50 * 1024 * 1024, // 50MB
                    timeout: maxTurns * 60 * 1000, // ~1 min per turn
                }, (err, stdout, stderr) => {
                    // Process completed
                    const pid = String(child.pid ?? "unknown");
                    const session = this.sessions.get(pid);
                    if (session) {
                        session.stdout = stdout;
                        session.stderr = stderr;
                        session.status = err ? "failed" : "completed";
                        session.exitCode = child.exitCode ?? undefined;
                    }
                });

                if (!child.pid) {
                    resolve({
                        success: false,
                        error: "Failed to spawn claude CLI process",
                    });
                    return;
                }

                const pid = String(child.pid);

                // Track the session
                this.sessions.set(pid, {
                    pid: child.pid,
                    process: child,
                    startedAt: Date.now(),
                    prompt,
                    model,
                    status: "running",
                    stdout: "",
                    stderr: "",
                });

                // Detach so the parent doesn't block
                child.unref();

                resolve({
                    success: true,
                    conversationId: pid,
                    promptLength: prompt.length,
                });
            } catch (err) {
                resolve({
                    success: false,
                    error: `Failed to spawn claude: ${(err as Error).message}`,
                });
            }
        });
    }

    /**
     * Get the status of a spawned agent by its PID (conversationId).
     */
    async getAgentStatus(conversationId: string): Promise<AgentStatus> {
        const session = this.sessions.get(conversationId);
        if (!session) {
            return {
                conversationId,
                state: "unknown",
                error: "No session found for this ID",
            };
        }

        // Check if process is still running
        const isRunning = this.isProcessRunning(session.pid);

        if (session.status === "running" && !isRunning) {
            session.status = session.exitCode === 0 ? "completed" : "failed";
        }

        return {
            conversationId,
            state: session.status,
            lastActiveAt: session.startedAt,
            error: session.status === "failed" ? session.stderr || undefined : undefined,
        };
    }

    /**
     * List all tracked sessions.
     */
    async listSessions(): Promise<SessionInfo[]> {
        return Array.from(this.sessions.values()).map((s) => ({
            conversationId: String(s.pid),
            state: s.status,
            startedAt: s.startedAt,
            agentId: s.agentId,
        }));
    }

    /**
     * Stop a running agent by killing its process.
     */
    async stop(conversationId: string): Promise<void> {
        const session = this.sessions.get(conversationId);
        if (!session) return;

        try {
            if (this.isProcessRunning(session.pid)) {
                this.killProcess(session.pid);
            }
            session.status = "failed";
        } catch {
            // Process may have already exited
        }
    }

    /**
     * Check if a process is still running (cross-platform).
     */
    private isProcessRunning(pid: number): boolean {
        try {
            // Signal 0 checks if process exists without killing it
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Kill a process (cross-platform).
     */
    private killProcess(pid: number): void {
        if (os.platform() === "win32") {
            // Windows: use taskkill for process tree
            this._exec("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});
        } else {
            // Unix: send SIGTERM
            try {
                process.kill(pid, "SIGTERM");
            } catch {
                // Process already exited
            }
        }
    }
}

// ── Singleton ──────────────────────────────────────────────────────

let instance: ClaudeCodeProvider | undefined;

export function getClaudeCodeProvider(config?: Partial<ClaudeCodeConfig>): ClaudeCodeProvider {
    if (!instance) {
        instance = new ClaudeCodeProvider(config);
    }
    return instance;
}

/** Reset singleton (testing only) */
export function resetClaudeCodeProvider(): void {
    instance = undefined;
}
