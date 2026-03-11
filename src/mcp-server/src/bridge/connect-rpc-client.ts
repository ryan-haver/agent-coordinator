/**
 * ConnectRPC Client — Direct headless spawning to the Gemini Language Server.
 *
 * Bypasses the IDE GUI by finding the actual Language Server process via OS
 * process tools, extracting its CSRF token and dynamically assigned HTTP REST port,
 * and performing the `StartCascade` and `SendUserCascadeMessage` JSON-RPC handshake.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { platform } from "os";

const execAsync = promisify(exec);

export interface LanguageServerConnection {
    port: number;
    csrfToken: string;
    pid: number;
}

export interface SpawnOptions {
    workingDirectory?: string;
    prompt: string;
    agenticMode?: boolean;
    autoExecutionPolicy?: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER" | "CASCADE_COMMANDS_AUTO_EXECUTION_ASK_FIRST";
    artifactReviewMode?: "ARTIFACT_REVIEW_MODE_TURBO" | "ARTIFACT_REVIEW_MODE_ASK_FIRST";
}

export interface SpawnResult {
    success: boolean;
    conversationId?: string;
    error?: string;
    promptLength?: number;
}

/** Map platform to the expected language server binary name */
function getLanguageServerBinaryName(): string {
    switch (platform()) {
        case "win32": return "language_server_windows_x64.exe";
        case "darwin": return "language_server_macos_x64";
        case "linux": return "language_server_linux_x64";
        default: return "language_server";
    }
}

export class ConnectRpcClient {
    private connection: LanguageServerConnection | null = null;
    private readonly timeoutMs: number;

    constructor(opts?: { timeoutMs?: number }) {
        this.timeoutMs = opts?.timeoutMs ?? 15_000;
    }

    /**
     * Discover and connect to the Language Server via platform-aware process scraping.
     */
    async connect(): Promise<LanguageServerConnection> {
        if (this.connection) return this.connection;

        const os = platform();
        const binaryName = getLanguageServerBinaryName();

        // Step 1: Find the language server process and its command line
        let procOutput: string;
        try {
            if (os === "win32") {
                const { stdout } = await execAsync(
                    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='${binaryName}'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation"`,
                    { timeout: 10_000 },
                );
                procOutput = stdout;
            } else {
                const { stdout } = await execAsync(
                    `ps aux | grep "${binaryName}" | grep -v grep`,
                    { timeout: 10_000 },
                );
                procOutput = stdout;
            }
        } catch (err) {
            throw new Error(`Language Server process not found (${binaryName}): ${(err as Error).message}`);
        }

        if (!procOutput.trim()) {
            throw new Error(`Language Server process not found: no process matching ${binaryName}`);
        }

        // Step 2: Extract CSRF token
        const csrfMatch = procOutput.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
        if (!csrfMatch) {
            throw new Error("CSRF token not found in Language Server command line");
        }
        const csrfToken = csrfMatch[1];

        // Step 3: Extract PID
        let pid: number;
        if (os === "win32") {
            const lines = procOutput.split("\n").map(l => l.trim()).filter(l => l.includes(binaryName));
            if (lines.length === 0) throw new Error("Could not parse PID from powershell output");
            // CSV format: "ProcessId","CommandLine"
            const firstLine = lines[0] ?? "";
            const match = firstLine.match(/^"(\d+)"/);
            if (!match) throw new Error("Could not extract PID from CSV: " + firstLine);
            pid = parseInt(match[1], 10);
        } else {
            const cols = procOutput.trim().split(/\s+/);
            pid = parseInt(cols[1], 10);
        }

        if (isNaN(pid)) throw new Error("Could not determine Language Server PID");

        // Step 4: Find listening port
        let portOutput: string;
        try {
            if (os === "win32") {
                const { stdout } = await execAsync(
                    `netstat -ano | findstr "LISTENING" | findstr "${pid}"`,
                    { timeout: 10_000 },
                );
                portOutput = stdout;
            } else if (os === "darwin") {
                const { stdout } = await execAsync(
                    `lsof -iTCP -sTCP:LISTEN -P -n -p ${pid}`,
                    { timeout: 10_000 },
                );
                portOutput = stdout;
            } else {
                const { stdout } = await execAsync(
                    `ss -tlnp | grep "pid=${pid}"`,
                    { timeout: 10_000 },
                );
                portOutput = stdout;
            }
        } catch (err) {
            throw new Error(`Could not find listening port for PID ${pid}: ${(err as Error).message}`);
        }

        let port: number | undefined;
        if (os === "win32") {
            const portMatch = portOutput.match(/:(\d+)\s+.*LISTENING/i);
            if (portMatch) port = parseInt(portMatch[1], 10);
        } else if (os === "darwin") {
            const portMatch = portOutput.match(/TCP\s+\*:(\d+)\s+\(LISTEN\)/);
            if (portMatch) port = parseInt(portMatch[1], 10);
        } else {
            const portMatch = portOutput.match(/:(\d+)\s/);
            if (portMatch) port = parseInt(portMatch[1], 10);
        }

        if (!port || isNaN(port)) {
            throw new Error(`Could not parse listening port from output`);
        }

        this.connection = { pid, csrfToken, port };
        return this.connection;
    }

    /**
     * Invalidate the cached connection so the next call re-discovers the Language Server.
     */
    disconnect(): void {
        this.connection = null;
    }

    /**
     * Issue a JSON-RPC request to the ConnectRPC HTTP interface.
     */
    async rpc<TResponse = unknown>(method: string, payload: Record<string, unknown>): Promise<TResponse> {
        const conn = await this.connect();
        const url = `https://127.0.0.1:${conn.port}/exa.language_server_pb.LanguageServerService/${method}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        // Temporarily disable TLS validation for the self-signed Language Server cert
        const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

        try {
            // Include metadata required by the server payload structure
            const enhancedPayload = {
                ...payload,
                metadata: {
                    ideName: "antigravity",
                    locale: "en",
                    ideVersion: "1.20.5",
                    extensionName: "antigravity"
                }
            };

            const resp = await globalThis.fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Codeium-Csrf-Token": conn.csrfToken,
                    "Connect-Protocol-Version": "1",
                },
                body: JSON.stringify(enhancedPayload),
                signal: controller.signal,
            });

            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`RPC ${method} failed (${resp.status}): ${text}`);
            }

            return (await resp.json()) as TResponse;
        } catch (err) {
            // On connection failure, invalidate cache and retry once
            const errMsg = (err as Error).message ?? "";
            if (errMsg.includes("ECONNREFUSED") || errMsg.includes("ECONNRESET") || errMsg.includes("fetch failed")) {
                this.disconnect();
            }
            throw err;
        } finally {
            clearTimeout(timer);
            // Restore TLS setting
            if (prevTls === undefined) {
                delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
            } else {
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
            }
        }
    }

    /**
     * Start a true headless agent spawn bypassing the IDE entirely.
     */
    async spawn(prompt: string, opts?: Partial<SpawnOptions>): Promise<SpawnResult> {
        try {
            // Ensure we have a valid URI string for the workspace
            let uriStr = "file:///";
            if (opts?.workingDirectory) {
                uriStr = "file:///" + opts.workingDirectory.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, "$1%3A");
            }

            // 1. Initialize the Cascade state
            const startResp = await this.rpc<{ response?: { cascadeId?: string } }>("StartCascade", {
                source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
                workspaceUris: [uriStr]
            });

            const cascadeId = startResp?.response?.cascadeId;
            if (!cascadeId) {
                throw new Error("Failed to receive cascadeId from StartCascade");
            }

            // 2. Transmit the agent instruction with execution policies
            await this.rpc("SendUserCascadeMessage", {
                cascadeId,
                items: [{ text: prompt }],
                cascadeConfig: {
                    plannerConfig: {
                        conversational: {
                            plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
                            agenticMode: opts?.agenticMode ?? true
                        },
                        toolConfig: {
                            runCommand: {
                                autoCommandConfig: {
                                    autoExecutionPolicy: opts?.autoExecutionPolicy ?? "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
                                }
                            },
                            notifyUser: {
                                artifactReviewMode: opts?.artifactReviewMode ?? "ARTIFACT_REVIEW_MODE_TURBO"
                            }
                        },
                        requestedModel: {
                            // Empty model string tells the backend to select the default
                            model: ""
                        }
                    }
                }
            });

            return {
                success: true,
                conversationId: cascadeId,
                promptLength: prompt.length
            };
        } catch (err) {
            return {
                success: false,
                error: `ConnectRPC spawn failed: ${(err as Error).message}`,
                promptLength: prompt.length
            };
        }
    }
}
