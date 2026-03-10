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
import { spawn, type ChildProcess } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";
import type {
    AgentProvider,
    ProviderHealth,
    SpawnOptions,
    SpawnResult,
    AgentStatus,
    SessionInfo,
} from "./provider.js";

/** Signature for spawn-compatible function */
export type SpawnFn = typeof spawn;

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
    /** Injectable spawn for testing (default: child_process.spawn) */
    _spawn?: SpawnFn;
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

const activeProcessPids = new Set<number>();

let cleanupRegistered = false;
function registerCleanupHook() {
    if (cleanupRegistered) return;
    cleanupRegistered = true;
    
    const cleanup = () => {
        for (const pid of activeProcessPids) {
            try {
                if (os.platform() === "win32") {
                    // Sync exec to ensure it runs before process dies
                    require("child_process").execSync(`taskkill /PID ${pid} /T /F`);
                } else {
                    process.kill(pid, "SIGTERM");
                }
            } catch {}
        }
    };
    
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(1); });
    process.on("SIGTERM", () => { cleanup(); process.exit(1); });
}

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
    private _spawnFn: SpawnFn;

    constructor(config?: Partial<ClaudeCodeConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this._spawnFn = config?._spawn ?? spawn;
        registerCleanupHook();
    }

    /**
     * Check if the claude CLI is available.
     * Runs `claude --version` and measures latency.
     */
    async ping(): Promise<ProviderHealth> {
        const start = Date.now();
        return new Promise<ProviderHealth>((resolve) => {
            const cmd = this.config.command ?? "claude";
            const child = this._spawnFn(cmd, ["--version"], {});
            let stdout = "";
            let stderr = "";
            child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
            child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
            child.on("error", (err) => {
                resolve({
                    online: false,
                    latencyMs: Date.now() - start,
                    error: `CLI not found or failed: ${err.message}`,
                });
            });
            child.on("close", (code) => {
                const latencyMs = Date.now() - start;
                if (code !== 0) {
                    resolve({
                        online: false,
                        latencyMs,
                        error: `CLI error [exit ${code}]: ${stderr}`,
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
                const child = this._spawnFn(cmd, args, { cwd });

                if (!child.pid) {
                    resolve({
                        success: false,
                        error: "Failed to spawn claude CLI process",
                    });
                    return;
                }

                const pid = String(child.pid);
                activeProcessPids.add(child.pid);
                
                // Track the session
                const session: TrackedSession = {
                    pid: child.pid,
                    process: child,
                    startedAt: Date.now(),
                    prompt,
                    model,
                    status: "running",
                    stdout: "",
                    stderr: "",
                };
                this.sessions.set(pid, session);

                // Set up progress recording to shared state protocol
                const agentDir = path.join(cwd, ".agent");
                const progressFile = path.join(agentDir, `progress-${pid}.md`);
                fs.mkdirSync(agentDir, { recursive: true });
                
                // Truncate/create the new progress file
                fs.writeFileSync(progressFile, `# Claude Code Transcript (PID: ${pid})\n\n`);

                const appendLog = (stream: "stdout"|"stderr", data: unknown) => {
                    const text = String(data);
                    if (stream === "stdout") session.stdout += text;
                    else session.stderr += text;
                    
                    try {
                        // Append raw text block
                        fs.appendFileSync(progressFile, text);
                    } catch {}
                };

                child.stdout?.on("data", (chunk) => appendLog("stdout", chunk));
                child.stderr?.on("data", (chunk) => appendLog("stderr", chunk));

                child.on("close", (code) => {
                    session.status = code === 0 ? "completed" : "failed";
                    session.exitCode = code ?? undefined;
                    activeProcessPids.delete(session.pid);
                });

                child.on("error", (err) => {
                    session.status = "failed";
                    session.stderr += err.message;
                    activeProcessPids.delete(session.pid);
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
            activeProcessPids.delete(session.pid);
        } catch {
            // Process may have already exited
            activeProcessPids.delete(session.pid);
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
        const killCmd = process.platform === "win32" ? "taskkill" : "kill";
        const killArgs = process.platform === "win32" ? ["/PID", String(pid), "/T", "/F"] : ["-9", String(pid)];

        // We use actual spawn here rather than injected _spawnFn because we need 
        // to reliably kill the process
        spawn(killCmd, killArgs).on("error", () => {});
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
