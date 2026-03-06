/**
 * Telemetry Client — dual-write to SQLite buffer + TimescaleDB.
 *
 * Architecture:
 *   record(event)     → sync write to SQLite telemetry_buffer
 *                     → async fire-and-forget to TSDB (if connected)
 *   healthCheck()     → every 30s: try TSDB connection
 *   drainBuffer()     → on reconnect: push unsynced SQLite rows to TSDB
 *
 * Soft dependency: TSDB writes are skipped silently if:
 *   - TELEMETRY_ENABLED=false
 *   - TSDB_URL is not set
 *   - TSDB connection fails
 */
import { Pool, PoolClient } from "pg";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyWorkspaceMigrations } from "../storage/migrations.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface TelemetryEvent {
    tool_name: string;
    agent_id?: string;
    session_id?: string;
    workspace?: string;
    phase?: string;
    duration_ms: number;
    success: boolean;
    error_msg?: string;
    args_summary?: string;
}

export interface AgentEvent {
    event_type: string;  // status_change, file_claim, file_release, phase_advance, issue_report
    agent_id: string;
    session_id?: string;
    workspace?: string;
    phase?: string;
    model?: string;
    detail?: Record<string, unknown>;
    duration_ms?: number;
}

interface TelemetryBufferRow {
    id: number;
    ts: string;
    session_id: string;
    workspace: string;
    agent_id: string;
    tool_name: string;
    phase: string;
    duration_ms: number;
    success: number;
    error_msg: string;
    args_summary: string;
}

// ── Arg sanitization ──────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
    "token", "password", "api_key", "apikey", "secret", "key",
    "auth", "authorization", "credential", "credentials"
]);

export function summarizeArgs(args: Record<string, unknown>): string {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
        sanitized[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : v;
    }
    const str = JSON.stringify(sanitized);
    return str.length > 200 ? str.slice(0, 197) + "..." : str;
}

// ── TSDB DDL ──────────────────────────────────────────────────────────

const TSDB_SCHEMA_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "tsdb-schema.sql"
);

async function applyTsdbSchema(client: PoolClient): Promise<void> {
    try {
        const sql = fs.readFileSync(TSDB_SCHEMA_PATH, "utf8");
        // Execute each statement separately to handle the SELECT create_hypertable call
        const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            await client.query(stmt);
        }
    } catch (e) {
        // Non-fatal: table may already exist
    }
}

// ── Client ────────────────────────────────────────────────────────────

export class TelemetryClient {
    private db: Database.Database;
    private pool: Pool | null = null;
    private connected = false;
    private healthTimer: ReturnType<typeof setInterval> | null = null;
    private wsRoot: string;
    private defaultSessionId: string;
    private defaultWorkspace: string;
    private enabled: boolean;

    constructor(wsRoot: string, sessionId: string) {
        this.wsRoot = wsRoot;
        this.defaultSessionId = sessionId;
        this.defaultWorkspace = wsRoot;
        this.enabled = process.env.TELEMETRY_ENABLED !== "false";

        // Open local SQLite buffer DB
        const dbDir = path.join(wsRoot, ".swarm");
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        const dbPath = path.join(dbDir, "coordinator.db");
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        applyWorkspaceMigrations(this.db);

        // Prepare insert statement
        this._insertStmt = this.db.prepare(`
            INSERT INTO telemetry_buffer
                (ts, session_id, workspace, agent_id, tool_name, phase, duration_ms, success, error_msg, args_summary, synced)
            VALUES
                (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `);
    }

    private _insertStmt: Database.Statement;

    /**
     * Close the local SQLite connection.
     * Call during test teardown or before process exit.
     */
    close(): void {
        try { this.db.close(); } catch { /* non-fatal */ }
    }

    /**
     * Record a telemetry event.
     * Synchronous SQLite write (<1ms), async TSDB write (fire-and-forget).
     */
    record(event: TelemetryEvent): void {
        if (!this.enabled) return;

        // Write to SQLite buffer immediately
        try {
            this._insertStmt.run(
                event.session_id ?? this.defaultSessionId,
                event.workspace ?? this.defaultWorkspace,
                event.agent_id ?? "",
                event.tool_name,
                event.phase ?? "",
                event.duration_ms,
                event.success ? 1 : 0,
                event.error_msg ?? "",
                event.args_summary ?? ""
            );
        } catch (e) {
            // Non-fatal
        }

        // Fire-and-forget TSDB write if connected
        if (this.connected && this.pool) {
            this._writeTsdb(event).catch(() => { /* non-fatal */ });
        }
    }

    /**
     * Record a lifecycle event (status change, file claim, phase advance, etc.)
     * Fire-and-forget to TSDB agent_events table.
     */
    recordEvent(event: AgentEvent): void {
        if (!this.enabled) return;
        if (!this.connected || !this.pool) return;

        this.pool.query(
            `INSERT INTO agent_events (session_id, workspace, agent_id, event_type, phase, model, detail, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                event.session_id ?? this.defaultSessionId,
                event.workspace ?? this.defaultWorkspace,
                event.agent_id,
                event.event_type,
                event.phase ?? "",
                event.model ?? "",
                JSON.stringify(event.detail ?? {}),
                event.duration_ms ?? 0
            ]
        ).catch(() => { /* non-fatal */ });
    }

    private async _writeTsdb(event: TelemetryEvent): Promise<void> {
        if (!this.pool) return;
        try {
            await this.pool.query(
                `INSERT INTO tool_calls (ts, session_id, workspace, agent_id, tool_name, phase, duration_ms, success, error_msg, args_summary)
                 VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    event.session_id ?? this.defaultSessionId,
                    event.workspace ?? this.defaultWorkspace,
                    event.agent_id ?? "",
                    event.tool_name,
                    event.phase ?? "",
                    event.duration_ms,
                    event.success,
                    event.error_msg ?? "",
                    event.args_summary ?? ""
                ]
            );
        } catch {
            // Non-fatal — mark as not connected so next health check re-establishes
            this.connected = false;
        }
    }

    /**
     * Drain unsynced SQLite buffer rows to TimescaleDB.
     * Called on reconnect.
     */
    async drainBuffer(): Promise<number> {
        if (!this.pool || !this.enabled) return 0;

        const rows = this.db.prepare(
            "SELECT * FROM telemetry_buffer WHERE synced = 0 ORDER BY id LIMIT 500"
        ).all() as TelemetryBufferRow[];

        if (rows.length === 0) return 0;

        let drained = 0;
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            for (const row of rows) {
                await client.query(
                    `INSERT INTO tool_calls (ts, session_id, workspace, agent_id, tool_name, phase, duration_ms, success, error_msg, args_summary)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                     ON CONFLICT DO NOTHING`,
                    [
                        row.ts, row.session_id, row.workspace, row.agent_id,
                        row.tool_name, row.phase, row.duration_ms,
                        row.success === 1, row.error_msg, row.args_summary
                    ]
                );
                drained++;
            }
            await client.query("COMMIT");

            // Mark synced
            const ids = rows.map(r => r.id);
            this.db.prepare(
                `UPDATE telemetry_buffer SET synced = 1 WHERE id IN (${ids.map(() => "?").join(",")})`
            ).run(...ids);

            // Cleanup old synced rows beyond TTL (default 24h)
            const ttlHours = parseInt(process.env.TELEMETRY_BUFFER_TTL_HOURS ?? "24", 10);
            const deleted = this.db.prepare(
                `DELETE FROM telemetry_buffer WHERE synced = 1 AND ts < datetime('now', '-${ttlHours} hours')`
            ).run();

            console.error(`[telemetry] Drained ${drained} buffered events to TimescaleDB (cleaned up ${deleted.changes} old rows)`);
        } catch (e) {
            await client.query("ROLLBACK");
            this.connected = false;
        } finally {
            client.release();
        }
        return drained;
    }

    /**
     * Try to connect to TimescaleDB and apply schema.
     */
    private async _connect(): Promise<boolean> {
        const url = process.env.TSDB_URL;
        if (!url || !this.enabled) return false;

        try {
            if (!this.pool) {
                this.pool = new Pool({
                    connectionString: url,
                    max: 5,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 3000
                });
            }
            const client = await this.pool.connect();
            await applyTsdbSchema(client);
            client.release();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Start 30s health check loop.
     */
    startHealthCheck(): void {
        if (!this.enabled || !process.env.TSDB_URL) return;

        const check = async () => {
            const wasConnected = this.connected;
            this.connected = await this._connect();

            if (!wasConnected && this.connected) {
                // Just reconnected — drain buffer
                console.error("[telemetry] TimescaleDB connection established");
                await this.drainBuffer();
            } else if (wasConnected && !this.connected) {
                console.error("[telemetry] TimescaleDB connection lost — buffering to SQLite");
            }
        };

        // Try immediately, then every 30s
        check().catch(() => { /* non-fatal */ });
        this.healthTimer = setInterval(() => {
            check().catch(() => { /* non-fatal */ });
        }, 30_000);
    }

    /**
     * Stop health check and close TSDB pool.
     */
    async shutdown(): Promise<void> {
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
        if (this.pool) {
            await this.pool.end().catch(() => { /* non-fatal */ });
            this.pool = null;
        }
        this.connected = false;
    }

    /**
     * Query telemetry from SQLite (offline fallback) or TSDB.
     */
    queryLocal(sql: string, params: any[] = []): any[] {
        try {
            return this.db.prepare(sql).all(...params);
        } catch {
            return [];
        }
    }

    get isConnected(): boolean { return this.connected; }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _client: TelemetryClient | null = null;

export function initTelemetry(wsRoot: string, sessionId: string): TelemetryClient {
    _client = new TelemetryClient(wsRoot, sessionId);
    _client.startHealthCheck();
    return _client;
}

export function getTelemetry(): TelemetryClient | null {
    return _client;
}

export function resetTelemetry(): void {
    _client = null;
}
