/**
 * Telemetry query handlers — 4 tools for agents to inspect their own telemetry.
 *
 * All tools fall back to SQLite when TimescaleDB is offline.
 * TSDB queries use pg pool; SQLite fallback uses queryLocal().
 */
import type { ToolHandler } from "./context.js";
import { getTelemetry } from "../telemetry/client.js";
import { resolveWorkspaceRoot } from "./context.js";

// ── Shared helpers ────────────────────────────────────────────────────

function getSessionId(args: Record<string, unknown>): string {
    return String(args.session_id ?? args.workspace_root ?? "");
}

function limitRows(rows: any[], limit: number): any[] {
    return rows.slice(0, limit);
}

// ── Tool: get_my_telemetry ────────────────────────────────────────────

/**
 * Returns the calling agent's tool calls for the current session.
 * Agents use this to reconstruct what they did without re-reading artifacts.
 */
export const handleGetMyTelemetry: ToolHandler = async (args) => {
    const agentId = String(args.agent_id ?? "");
    const sessionId = String(args.session_id ?? "");
    const limit = Math.min(Number(args.limit ?? 50), 200);
    const telemetry = getTelemetry();

    if (!telemetry) {
        return {
            content: [{ type: "text" as const, text: "Telemetry not initialized." }]
        };
    }

    let rows: any[];

    // Try TSDB first
    if (telemetry.isConnected) {
        try {
            const { Pool } = await import("pg");
            const pool = new Pool({ connectionString: process.env.TSDB_URL, max: 2 });
            const result = await pool.query(
                `SELECT ts, tool_name, phase, duration_ms, success, error_msg, args_summary
                 FROM tool_calls
                 WHERE agent_id = $1 AND ($2 = '' OR session_id = $2)
                 ORDER BY ts DESC LIMIT $3`,
                [agentId, sessionId, limit]
            );
            await pool.end();
            rows = result.rows;
        } catch {
            rows = queryLocalTelemetry(telemetry, agentId, sessionId, limit);
        }
    } else {
        rows = queryLocalTelemetry(telemetry, agentId, sessionId, limit);
    }

    const text = rows.length === 0
        ? `No telemetry found for agent ${agentId}.`
        : formatTelemetryRows(rows, `Agent ${agentId} — last ${rows.length} tool calls`);

    return { content: [{ type: "text" as const, text }] };
};

function queryLocalTelemetry(telemetry: any, agentId: string, sessionId: string, limit: number): any[] {
    if (sessionId) {
        return telemetry.queryLocal(
            "SELECT ts, tool_name, phase, duration_ms, success, error_msg, args_summary FROM telemetry_buffer WHERE agent_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?",
            [agentId, sessionId, limit]
        );
    }
    return telemetry.queryLocal(
        "SELECT ts, tool_name, phase, duration_ms, success, error_msg, args_summary FROM telemetry_buffer WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
        [agentId, limit]
    );
}

// ── Tool: get_session_telemetry ───────────────────────────────────────

/**
 * Returns aggregate telemetry for all agents in a session.
 * Coordinators use this for swarm-level health checks.
 */
export const handleGetSessionTelemetry: ToolHandler = async (args) => {
    const sessionId = String(args.session_id ?? "");
    const telemetry = getTelemetry();

    if (!telemetry) {
        return { content: [{ type: "text" as const, text: "Telemetry not initialized." }] };
    }

    let rows: any[];

    if (telemetry.isConnected) {
        try {
            const { Pool } = await import("pg");
            const pool = new Pool({ connectionString: process.env.TSDB_URL, max: 2 });
            const result = await pool.query(
                `SELECT agent_id,
                        COUNT(*)                                      AS total_calls,
                        AVG(duration_ms)::INTEGER                     AS avg_duration_ms,
                        SUM(CASE WHEN NOT success THEN 1 ELSE 0 END)  AS failures,
                        MAX(ts)                                        AS last_seen
                 FROM tool_calls
                 WHERE session_id = $1
                 GROUP BY agent_id
                 ORDER BY total_calls DESC`,
                [sessionId]
            );
            await pool.end();
            rows = result.rows;
        } catch {
            rows = queryLocalSessionTelemetry(telemetry, sessionId);
        }
    } else {
        rows = queryLocalSessionTelemetry(telemetry, sessionId);
    }

    const lines = rows.length === 0
        ? [`No telemetry for session ${sessionId || "(all)"}.`]
        : [
            `Session telemetry — ${sessionId || "all sessions"}`,
            "",
            `${"Agent".padEnd(12)} ${"Calls".padEnd(8)} ${"Avg ms".padEnd(8)} ${"Failures".padEnd(10)} Last seen`,
            "─".repeat(60),
            ...rows.map((r: any) =>
                `${String(r.agent_id).padEnd(12)} ${String(r.total_calls).padEnd(8)} ${String(r.avg_duration_ms ?? 0).padEnd(8)} ${String(r.failures ?? 0).padEnd(10)} ${r.last_seen}`
            )
        ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
};

function queryLocalSessionTelemetry(telemetry: any, sessionId: string): any[] {
    const sql = sessionId
        ? `SELECT agent_id, COUNT(*) AS total_calls, AVG(duration_ms) AS avg_duration_ms,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures, MAX(ts) AS last_seen
           FROM telemetry_buffer WHERE session_id = ? GROUP BY agent_id ORDER BY total_calls DESC`
        : `SELECT agent_id, COUNT(*) AS total_calls, AVG(duration_ms) AS avg_duration_ms,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures, MAX(ts) AS last_seen
           FROM telemetry_buffer GROUP BY agent_id ORDER BY total_calls DESC`;
    const params = sessionId ? [sessionId] : [];
    return telemetry.queryLocal(sql, params);
}

// ── Tool: get_slow_operations ─────────────────────────────────────────

/**
 * Returns tool calls that exceeded a duration threshold.
 * Agents use this to identify bottlenecks.
 */
export const handleGetSlowOperations: ToolHandler = async (args) => {
    const thresholdMs = Number(args.threshold_ms ?? 2000);
    const sessionId = String(args.session_id ?? "");
    const limit = Math.min(Number(args.limit ?? 20), 100);
    const telemetry = getTelemetry();

    if (!telemetry) {
        return { content: [{ type: "text" as const, text: "Telemetry not initialized." }] };
    }

    let rows: any[];

    if (telemetry.isConnected) {
        try {
            const { Pool } = await import("pg");
            const pool = new Pool({ connectionString: process.env.TSDB_URL, max: 2 });
            const result = await pool.query(
                `SELECT ts, agent_id, tool_name, phase, duration_ms, error_msg
                 FROM tool_calls
                 WHERE duration_ms >= $1 AND ($2 = '' OR session_id = $2)
                 ORDER BY duration_ms DESC LIMIT $3`,
                [thresholdMs, sessionId, limit]
            );
            await pool.end();
            rows = result.rows;
        } catch {
            rows = queryLocalSlowOps(telemetry, thresholdMs, sessionId, limit);
        }
    } else {
        rows = queryLocalSlowOps(telemetry, thresholdMs, sessionId, limit);
    }

    if (rows.length === 0) {
        return { content: [{ type: "text" as const, text: `No operations exceeding ${thresholdMs}ms found.` }] };
    }

    const lines = [
        `Slow operations (>${thresholdMs}ms) — ${rows.length} found`,
        "",
        `${"duration".padEnd(10)} ${"tool".padEnd(28)} ${"agent".padEnd(10)} ${"phase".padEnd(6)} ts`,
        "─".repeat(70),
        ...rows.map((r: any) =>
            `${String(r.duration_ms + "ms").padEnd(10)} ${String(r.tool_name).padEnd(28)} ${String(r.agent_id).padEnd(10)} ${String(r.phase ?? "").padEnd(6)} ${r.ts}`
        )
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
};

function queryLocalSlowOps(telemetry: any, thresholdMs: number, sessionId: string, limit: number): any[] {
    const sql = sessionId
        ? "SELECT ts, agent_id, tool_name, phase, duration_ms, error_msg FROM telemetry_buffer WHERE duration_ms >= ? AND session_id = ? ORDER BY duration_ms DESC LIMIT ?"
        : "SELECT ts, agent_id, tool_name, phase, duration_ms, error_msg FROM telemetry_buffer WHERE duration_ms >= ? ORDER BY duration_ms DESC LIMIT ?";
    const params = sessionId ? [thresholdMs, sessionId, limit] : [thresholdMs, limit];
    return telemetry.queryLocal(sql, params);
}

// ── Tool: get_telemetry_summary ───────────────────────────────────────

/**
 * Returns a high-level swarm telemetry summary.
 * Agents and coordinators use this for health checks and status reports.
 */
export const handleGetTelemetrySummary: ToolHandler = async (args) => {
    const sessionId = String(args.session_id ?? "");
    const telemetry = getTelemetry();

    if (!telemetry) {
        return { content: [{ type: "text" as const, text: "Telemetry not initialized." }] };
    }

    let summary: any;
    const source = telemetry.isConnected ? "TimescaleDB" : "SQLite (local buffer)";

    if (telemetry.isConnected) {
        try {
            const { Pool } = await import("pg");
            const pool = new Pool({ connectionString: process.env.TSDB_URL, max: 2 });
            const res = await pool.query(
                `SELECT
                    COUNT(*)                                       AS total_calls,
                    AVG(duration_ms)::INTEGER                      AS avg_duration_ms,
                    MAX(duration_ms)                               AS max_duration_ms,
                    SUM(CASE WHEN NOT success THEN 1 ELSE 0 END)   AS total_failures,
                    COUNT(DISTINCT agent_id)                        AS active_agents,
                    COUNT(DISTINCT tool_name)                       AS distinct_tools,
                    MIN(ts)                                         AS first_call,
                    MAX(ts)                                         AS last_call
                 FROM tool_calls
                 WHERE ($1 = '' OR session_id = $1)`,
                [sessionId]
            );
            const topTools = await pool.query(
                `SELECT tool_name, COUNT(*) AS calls, AVG(duration_ms)::INTEGER AS avg_ms
                 FROM tool_calls
                 WHERE ($1 = '' OR session_id = $1)
                 GROUP BY tool_name ORDER BY calls DESC LIMIT 5`,
                [sessionId]
            );
            await pool.end();
            summary = { ...res.rows[0], top_tools: topTools.rows };
        } catch {
            summary = buildLocalSummary(telemetry, sessionId);
        }
    } else {
        summary = buildLocalSummary(telemetry, sessionId);
    }

    const { total_calls, avg_duration_ms, max_duration_ms, total_failures, active_agents, distinct_tools, first_call, last_call, top_tools } = summary;

    const lines = [
        `Telemetry Summary (${source})`,
        sessionId ? `Session: ${sessionId}` : "All sessions",
        "",
        `Total calls:      ${total_calls}`,
        `Avg duration:     ${avg_duration_ms}ms`,
        `Max duration:     ${max_duration_ms}ms`,
        `Failures:         ${total_failures} (${total_calls > 0 ? Math.round(100 * total_failures / total_calls) : 0}%)`,
        `Active agents:    ${active_agents}`,
        `Distinct tools:   ${distinct_tools}`,
        `First call:       ${first_call ?? "n/a"}`,
        `Last call:        ${last_call ?? "n/a"}`,
    ];

    if (top_tools?.length) {
        lines.push("", "Top tools:");
        for (const t of top_tools) {
            lines.push(`  ${String(t.tool_name).padEnd(30)} ${t.calls} calls, avg ${t.avg_ms}ms`);
        }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
};

function buildLocalSummary(telemetry: any, sessionId: string): any {
    const params = sessionId ? [sessionId] : [];
    const where = sessionId ? "WHERE session_id = ?" : "";
    const [row] = telemetry.queryLocal(
        `SELECT COUNT(*) AS total_calls, AVG(duration_ms) AS avg_duration_ms,
         MAX(duration_ms) AS max_duration_ms,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS total_failures,
         COUNT(DISTINCT agent_id) AS active_agents,
         COUNT(DISTINCT tool_name) AS distinct_tools,
         MIN(ts) AS first_call, MAX(ts) AS last_call
         FROM telemetry_buffer ${where}`, params
    );
    const topTools = telemetry.queryLocal(
        `SELECT tool_name, COUNT(*) AS calls, AVG(duration_ms) AS avg_ms
         FROM telemetry_buffer ${where}
         GROUP BY tool_name ORDER BY calls DESC LIMIT 5`, params
    );
    return { ...(row ?? {}), avg_duration_ms: Math.round(row?.avg_duration_ms ?? 0), max_duration_ms: row?.max_duration_ms ?? 0, top_tools: topTools };
}

// ── Shared formatter ─────────────────────────────────────────────────

function formatTelemetryRows(rows: any[], title: string): string {
    const lines = [title, "", `${"ts".padEnd(22)} ${"tool".padEnd(28)} ${"ph".padEnd(4)} ${"ms".padEnd(7)} ok?`];
    lines.push("─".repeat(70));
    for (const r of rows) {
        const ok = r.success === 1 || r.success === true ? "✅" : "❌";
        lines.push(`${String(r.ts).slice(0, 19).padEnd(22)} ${String(r.tool_name).padEnd(28)} ${String(r.phase ?? "").padEnd(4)} ${String(r.duration_ms + "ms").padEnd(7)} ${ok}`);
        if (r.error_msg) lines.push(`  └─ ${r.error_msg.slice(0, 80)}`);
    }
    return lines.join("\n");
}
