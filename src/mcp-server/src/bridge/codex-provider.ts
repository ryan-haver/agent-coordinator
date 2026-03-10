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
    SessionInfo
} from "./provider.js";

export type SpawnFn = typeof spawn;

export interface CodexConfig {
    command?: string;
}

const activeProcessPids = new Set<number>();

let cleanupRegistered = false;
function registerCleanupHook() {
    if (cleanupRegistered) return;
    cleanupRegistered = true;
    
    const cleanup = () => {
        for (const pid of activeProcessPids) {
            try {
                if (os.platform() === "win32") {
                    require("child_process").execSync(`taskkill /PID ${pid} /T /F`);
                } else {
                    process.kill(-pid, "SIGKILL"); // kill process group
                }
            } catch {}
        }
    };
    
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(1); });
    process.on("SIGTERM", () => { cleanup(); process.exit(1); });
}

export class CodexProvider implements AgentProvider {
    readonly name = "codex";
    readonly displayName = "OpenAI Codex (CLI)";
    readonly models = ["o3", "o1", "gpt-4o", "gpt-4.1", "o4-mini"];
    readonly capabilities = ["file-edit", "terminal", "mcp"];

    private sessions = new Map<string, {
        pid: number;
        process: ChildProcess;
        startedAt: number;
        state: "running" | "completed" | "failed" | "stopped" | "unknown";
        workingDirectory?: string;
        stdout: string;
        stderr: string;
    }>();

    private command: string;
    // test injection
    private _spawnFn: SpawnFn;

    constructor(config?: CodexConfig, _spawnFn?: SpawnFn) {
        this.command = config?.command || "codex";
        this._spawnFn = _spawnFn || spawn;
        registerCleanupHook();
    }

    async ping(): Promise<ProviderHealth> {
        const start = Date.now();
        return new Promise<ProviderHealth>((resolve) => {
            const child = this._spawnFn(this.command, ["--version"]);
            let stdout = "";
            let stderr = "";
            
            child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
            child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
            
            child.on("error", (err) => {
                resolve({
                    online: false,
                    latencyMs: Date.now() - start,
                    error: `Failed to execute ${this.command} --version: ${err.message}`
                });
            });
            
            child.on("close", (code) => {
                if (code !== 0) {
                    resolve({
                        online: false,
                        latencyMs: Date.now() - start,
                        error: `CLI error [exit ${code}]: ${stderr}`
                    });
                } else {
                    resolve({
                        online: true,
                        latencyMs: Date.now() - start,
                        version: stdout.trim()
                    });
                }
            });
        });
    }

    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        const conversationId = `codex-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const args = [
            "--approval-mode", "full-auto",
            "--quiet",
            "-p", prompt
        ];

        // We could also pass model or turnLimit if Codex CLI supports it

        try {
            const cwd = opts?.workingDirectory || process.cwd();
            const child = this._spawnFn(this.command, args, {
                cwd,
                env: { ...process.env, ...opts?.env },
                windowsHide: true,
                detached: opts?.background !== false
            });

            if (!child.pid) {
                return {
                    success: false,
                    error: "Process spawned but no PID returned."
                };
            }

            const pid = child.pid;
            activeProcessPids.add(pid);

            const session: {
                pid: number;
                process: ChildProcess;
                startedAt: number;
                state: "running" | "completed" | "failed" | "stopped" | "unknown";
                workingDirectory?: string;
                stdout: string;
                stderr: string;
            } = {
                pid,
                process: child,
                startedAt: Date.now(),
                state: "running",
                workingDirectory: opts?.workingDirectory,
                stdout: "",
                stderr: ""
            };
            this.sessions.set(conversationId, session);

            // Real-time progress tracking to file
            const agentDir = path.join(cwd, ".agent");
            const progressFile = path.join(agentDir, `progress-${conversationId}.md`);
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(progressFile, `# Codex output (PID ${pid})\n\n`);

            const appendLog = (streamName: "stdout"|"stderr", data: unknown) => {
                const text = String(data);
                if (streamName === "stdout") session.stdout += text;
                else session.stderr += text;
                try {
                    fs.appendFileSync(progressFile, text);
                } catch {}
            };

            child.stdout?.on("data", (chunk) => appendLog("stdout", chunk));
            child.stderr?.on("data", (chunk) => appendLog("stderr", chunk));

            child.on("close", (code) => {
                session.state = code === 0 ? "completed" : "failed";
                activeProcessPids.delete(pid);
            });

            child.on("error", (err) => {
                session.state = "failed";
                session.stderr += err.message;
                activeProcessPids.delete(pid);
            });

            if (opts?.background !== false) {
                child.unref(); // allow parent to exit
            }

            return {
                success: true,
                conversationId,
                promptLength: prompt.length,
                metadata: {
                    pid,
                    command: this.command,
                    args
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
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

        // Double check process status if still marked running
        if (session.state === "running") {
            try {
                // cross-platform check if pid is running
                if (os.platform() === 'win32') {
                    // Tasklist or similar could be used, but for now we rely on the exit callback
                } else {
                    process.kill(session.pid, 0); // throws if not running
                }
            } catch (e) {
                // Process is gone, exit callback should have fired, but fallback
                session.state = "stopped";
            }
        }

        return {
            conversationId,
            state: session.state,
            lastActiveAt: Date.now() // placeholder until log tracking implemented
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
        if (!session) return;
        
        try {
            if (os.platform() === 'win32') {
                require("child_process").execSync(`taskkill /pid ${session.pid} /T /F`);
            } else {
                process.kill(-session.pid, "SIGKILL"); // kill process group
            }
            activeProcessPids.delete(session.pid);
        } catch (e) {
            activeProcessPids.delete(session.pid);
        }
        session.state = "stopped";
    }
}
