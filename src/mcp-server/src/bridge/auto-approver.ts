/**
 * Auto-Approver — Programmatic approval of Agent Manager interactions.
 *
 * Phase 7G: When agents hit file-write or command-execution dialogs,
 * this module automatically sends approval via the Language Server RPC.
 *
 * Architecture:
 *   1. LanguageServerClient — connects to the Language Server via HTTPS+CSRF
 *   2. AutoApprover — polls for pending interactions and approves them
 *
 * The Language Server connection uses the same pattern as quota_check.ps1:
 *   - Find language_server_windows_x64.exe via WMI
 *   - Extract CSRF token from command line args
 *   - Find listening port via Get-NetTCPConnection
 *   - POST to https://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/{METHOD}
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface LanguageServerConnection {
    port: number;
    csrfToken: string;
    pid: number;
}

export interface InteractionApproval {
    cascadeId: string;
    trajectoryId: string;
    stepIndex: number;
    type: "filePermission" | "runCommand";
    target: string;  // file path or command line
}

export interface ApprovalResult {
    success: boolean;
    cascadeId: string;
    type: string;
    target: string;
    error?: string;
}

export interface AutoApproverConfig {
    /** Poll interval in milliseconds (default: 2000) */
    pollIntervalMs: number;
    /** Whether to approve file writes (default: true) */
    approveFileWrites: boolean;
    /** Whether to approve command execution (default: true) */
    approveCommands: boolean;
    /** Scope for file permissions: per-conversation or global */
    filePermissionScope: "PERMISSION_SCOPE_CONVERSATION" | "PERMISSION_SCOPE_GLOBAL";
    /** Maximum cascades to track simultaneously */
    maxCascades: number;
}

const DEFAULT_CONFIG: AutoApproverConfig = {
    pollIntervalMs: 2000,
    approveFileWrites: true,
    approveCommands: true,
    filePermissionScope: "PERMISSION_SCOPE_CONVERSATION",
    maxCascades: 20,
};

// ────────────────────────────────────────────────────────────────────────
// LanguageServerClient — direct HTTPS+CSRF connection
// ────────────────────────────────────────────────────────────────────────

export class LanguageServerClient {
    private connection: LanguageServerConnection | null = null;

    /**
     * Discover and connect to the Language Server.
     * Extracts CSRF token and port from the running process.
     */
    async connect(): Promise<LanguageServerConnection> {
        if (this.connection) return this.connection;

        // Use PowerShell to find the language server process (same as quota_check.ps1)
        const script = `
            $proc = Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'" | 
                Where-Object { $_.CommandLine -match '--csrf_token' -and $_.CommandLine -match '--app_data_dir\\s+antigravity' } |
                Select-Object -First 1
            if (-not $proc) { throw "Language server not found" }
            $cmd = $proc.CommandLine
            if ($cmd -match '--csrf_token[=\\s]+([a-f0-9-]+)') { $csrf = $matches[1] } else { throw "CSRF not found" }
            $ports = Get-NetTCPConnection -State Listen -OwningProcess $proc.ProcessId -ErrorAction SilentlyContinue | 
                Select-Object -ExpandProperty LocalPort | Sort-Object -Unique
            if (-not $ports) { throw "No ports found" }
            $port = if ($ports -is [System.Array]) { $ports[0] } else { $ports }
            Write-Output "$($proc.ProcessId)|$csrf|$port"
        `;

        try {
            const { stdout } = await execAsync(
                `powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
                { timeout: 10_000 },
            );

            const parts = stdout.trim().split("|");
            if (parts.length < 3) throw new Error(`Unexpected output: ${stdout}`);

            this.connection = {
                pid: parseInt(parts[0], 10),
                csrfToken: parts[1],
                port: parseInt(parts[2], 10),
            };

            return this.connection;
        } catch (err) {
            throw new Error(`Failed to connect to Language Server: ${(err as Error).message}`);
        }
    }

    /**
     * Send an RPC call to the Language Server.
     */
    async rpc<T>(method: string, payload: Record<string, unknown>): Promise<T> {
        const conn = await this.connect();
        const url = `https://127.0.0.1:${conn.port}/exa.language_server_pb.LanguageServerService/${method}`;

        // Using Node's fetch with TLS bypass for self-signed cert
        const resp = await globalThis.fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Codeium-Csrf-Token": conn.csrfToken,
                "Connect-Protocol-Version": "1",
            },
            body: JSON.stringify(payload),
            // @ts-expect-error — Node.js-specific TLS option
            dispatcher: undefined, // Will need agent with rejectUnauthorized: false
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`RPC ${method} failed (${resp.status}): ${text}`);
        }

        return (await resp.json()) as T;
    }

    /**
     * Send a HandleCascadeUserInteraction to approve a file permission.
     */
    async approveFilePermission(
        cascadeId: string,
        trajectoryId: string,
        stepIndex: number,
        absolutePathUri: string,
        scope: string = "PERMISSION_SCOPE_CONVERSATION",
    ): Promise<unknown> {
        return this.rpc("HandleCascadeUserInteraction", {
            cascadeId,
            interaction: {
                trajectoryId,
                stepIndex,
                filePermission: {
                    allow: true,
                    scope,
                    absolutePathUri,
                },
            },
        });
    }

    /**
     * Send a HandleCascadeUserInteraction to approve a command execution.
     */
    async approveCommand(
        cascadeId: string,
        trajectoryId: string,
        stepIndex: number,
        commandLine: string,
    ): Promise<unknown> {
        return this.rpc("HandleCascadeUserInteraction", {
            cascadeId,
            interaction: {
                trajectoryId,
                stepIndex,
                runCommand: {
                    confirm: true,
                    proposedCommandLine: commandLine,
                    submittedCommandLine: commandLine,
                },
            },
        });
    }

    /**
     * Get connection info (for diagnostics).
     */
    getConnection(): LanguageServerConnection | null {
        return this.connection;
    }

    /**
     * Reset connection (forces re-discovery on next call).
     */
    disconnect(): void {
        this.connection = null;
    }
}

// ────────────────────────────────────────────────────────────────────────
// AutoApprover — background poller
// ────────────────────────────────────────────────────────────────────────

export class AutoApprover {
    private config: AutoApproverConfig;
    private client: LanguageServerClient;
    private running: boolean = false;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private trackedCascades: Set<string> = new Set();
    private approvalLog: ApprovalResult[] = [];

    constructor(client?: LanguageServerClient, config?: Partial<AutoApproverConfig>) {
        this.client = client ?? new LanguageServerClient();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Start auto-approving interactions for tracked cascades.
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        // Poll timer will be started when cascades are tracked
        this.startPolling();
    }

    /**
     * Stop the auto-approver.
     */
    stop(): void {
        this.running = false;
        this.stopPolling();
        this.trackedCascades.clear();
    }

    /**
     * Track a cascade ID for auto-approval.
     */
    trackCascade(cascadeId: string): void {
        if (this.trackedCascades.size >= this.config.maxCascades) {
            // Remove oldest
            const oldest = this.trackedCascades.values().next().value;
            if (oldest) this.trackedCascades.delete(oldest);
        }
        this.trackedCascades.add(cascadeId);
    }

    /**
     * Stop tracking a cascade.
     */
    untrackCascade(cascadeId: string): void {
        this.trackedCascades.delete(cascadeId);
    }

    /**
     * Manually approve an interaction.
     */
    async approve(interaction: InteractionApproval): Promise<ApprovalResult> {
        try {
            if (interaction.type === "filePermission" && this.config.approveFileWrites) {
                await this.client.approveFilePermission(
                    interaction.cascadeId,
                    interaction.trajectoryId,
                    interaction.stepIndex,
                    interaction.target,
                    this.config.filePermissionScope,
                );
            } else if (interaction.type === "runCommand" && this.config.approveCommands) {
                await this.client.approveCommand(
                    interaction.cascadeId,
                    interaction.trajectoryId,
                    interaction.stepIndex,
                    interaction.target,
                );
            } else {
                return {
                    success: false,
                    cascadeId: interaction.cascadeId,
                    type: interaction.type,
                    target: interaction.target,
                    error: `Approval for ${interaction.type} is disabled`,
                };
            }

            const result: ApprovalResult = {
                success: true,
                cascadeId: interaction.cascadeId,
                type: interaction.type,
                target: interaction.target,
            };
            this.approvalLog.push(result);
            return result;
        } catch (err) {
            const result: ApprovalResult = {
                success: false,
                cascadeId: interaction.cascadeId,
                type: interaction.type,
                target: interaction.target,
                error: (err as Error).message,
            };
            this.approvalLog.push(result);
            return result;
        }
    }

    /**
     * Get approval history.
     */
    getLog(): ApprovalResult[] {
        return [...this.approvalLog];
    }

    /**
     * Get current status.
     */
    getStatus(): {
        running: boolean;
        trackedCascades: number;
        totalApprovals: number;
        failedApprovals: number;
        config: AutoApproverConfig;
    } {
        return {
            running: this.running,
            trackedCascades: this.trackedCascades.size,
            totalApprovals: this.approvalLog.length,
            failedApprovals: this.approvalLog.filter(r => !r.success).length,
            config: { ...this.config },
        };
    }

    /**
     * Update config.
     */
    updateConfig(partial: Partial<AutoApproverConfig>): void {
        this.config = { ...this.config, ...partial };
    }

    /**
     * Check if a cascade is tracked.
     */
    isTracked(cascadeId: string): boolean {
        return this.trackedCascades.has(cascadeId);
    }

    // ── Internal ──────────────────────────────────────────────────────

    private startPolling(): void {
        if (this.pollTimer) return;
        // Note: The actual polling logic for StreamAgentStateUpdates
        // requires a persistent gRPC connection. For the initial
        // implementation, we rely on the bridge extension to forward
        // pending interactions, or on manual approve() calls from
        // the orchestrator. The poll timer is a heartbeat that checks
        // connection health.
        this.pollTimer = setInterval(() => {
            if (!this.running) {
                this.stopPolling();
                return;
            }
            // Future: poll StreamAgentStateUpdates for pending interactions
        }, this.config.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
}

// ────────────────────────────────────────────────────────────────────────
// Singletons
// ────────────────────────────────────────────────────────────────────────

let _lsClient: LanguageServerClient | undefined;
let _autoApprover: AutoApprover | undefined;

export function getLanguageServerClient(): LanguageServerClient {
    if (!_lsClient) {
        _lsClient = new LanguageServerClient();
    }
    return _lsClient;
}

export function getAutoApprover(): AutoApprover {
    if (!_autoApprover) {
        _autoApprover = new AutoApprover(getLanguageServerClient());
    }
    return _autoApprover;
}
