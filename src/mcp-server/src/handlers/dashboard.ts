/**
 * Dashboard aggregation handler: get_dashboard_data
 *
 * Combines swarm status, telemetry summary, quota snapshot, file conflicts,
 * and recent events into a single JSON response for dashboard consumers.
 */
import path from "path";
import fs from "fs";
import os from "os";
import type { ToolHandler } from "./context.js";
import { getStorage } from "../storage/singleton.js";
import { getTelemetry } from "../telemetry/client.js";
import { listActiveSwarms, type SwarmRegistryEntry } from "../utils/swarm-registry.js";

const QUOTA_PATH = path.join(os.homedir(), '.antigravity-configs', 'quota_snapshot.json');
const EVENTS_DIR = path.join(os.homedir(), '.antigravity-configs', 'swarm_events');

interface DashboardData {
    swarms: SwarmRegistryEntry[];
    telemetry: {
        total_calls: number;
        avg_duration_ms: number;
        total_failures: number;
        active_agents: number;
        failure_rate_pct: number;
    };
    quota: object | null;
    file_conflicts: Array<{ file: string; claimants: string[] }>;
    recent_events: object[];
    timestamp: string;
}

export const handleGetDashboardData: ToolHandler = async (_args) => {
    const data: DashboardData = {
        swarms: [],
        telemetry: { total_calls: 0, avg_duration_ms: 0, total_failures: 0, active_agents: 0, failure_rate_pct: 0 },
        quota: null,
        file_conflicts: [],
        recent_events: [],
        timestamp: new Date().toISOString()
    };

    // 1. Active swarms
    try {
        data.swarms = listActiveSwarms();
    } catch { /* non-fatal */ }

    // 2. Telemetry summary
    try {
        const telemetry = getTelemetry();
        if (telemetry) {
            const [row] = telemetry.queryLocal(
                `SELECT COUNT(*) AS total_calls, AVG(duration_ms) AS avg_duration_ms,
                 SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS total_failures,
                 COUNT(DISTINCT agent_id) AS active_agents
                 FROM telemetry_buffer`, []
            );
            if (row) {
                data.telemetry = {
                    total_calls: Number(row.total_calls ?? 0),
                    avg_duration_ms: Math.round(Number(row.avg_duration_ms ?? 0)),
                    total_failures: Number(row.total_failures ?? 0),
                    active_agents: Number(row.active_agents ?? 0),
                    failure_rate_pct: row.total_calls > 0
                        ? Math.round(100 * Number(row.total_failures ?? 0) / Number(row.total_calls))
                        : 0
                };
            }
        }
    } catch { /* non-fatal */ }

    // 3. Quota snapshot
    try {
        if (fs.existsSync(QUOTA_PATH)) {
            data.quota = JSON.parse(fs.readFileSync(QUOTA_PATH, 'utf8'));
        }
    } catch { /* non-fatal */ }

    // 4. File conflicts (files claimed by >1 agent)
    try {
        const storage = getStorage();
        if (typeof (storage as any).db?.prepare === 'function') {
            // SQLite backend: direct query for multi-claimed files
            const conflicts = (storage as any).db.prepare(
                `SELECT file, GROUP_CONCAT(agent_id) AS claimants
                 FROM file_claims
                 WHERE status NOT IN ('✅ Done', '🚫 Abandoned')
                 GROUP BY file HAVING COUNT(DISTINCT agent_id) > 1`
            ).all() as Array<{ file: string; claimants: string }>;
            data.file_conflicts = conflicts.map(c => ({
                file: c.file,
                claimants: c.claimants.split(',')
            }));
        }
    } catch { /* non-fatal — file adapter doesn't support this query */ }

    // 5. Recent events (last 20 from most recent event file)
    try {
        if (fs.existsSync(EVENTS_DIR)) {
            const files = fs.readdirSync(EVENTS_DIR)
                .filter(f => f.startsWith('events-') && f.endsWith('.json'))
                .sort().reverse();
            if (files.length > 0) {
                const events = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, files[0]), 'utf8'));
                data.recent_events = Array.isArray(events) ? events.slice(-20) : [];
            }
        }
    } catch { /* non-fatal */ }

    const summary = [
        `Dashboard Snapshot — ${data.timestamp}`,
        "",
        `Active swarms:    ${data.swarms.length}`,
        `Total tool calls: ${data.telemetry.total_calls}`,
        `Avg duration:     ${data.telemetry.avg_duration_ms}ms`,
        `Failure rate:     ${data.telemetry.failure_rate_pct}%`,
        `Active agents:    ${data.telemetry.active_agents}`,
        `File conflicts:   ${data.file_conflicts.length}`,
        `Quota loaded:     ${data.quota ? "yes" : "no"}`,
        `Recent events:    ${data.recent_events.length}`,
    ];

    return {
        toolResult: JSON.stringify(data),
        content: [{ type: "text" as const, text: summary.join("\n") + "\n\n" + JSON.stringify(data, null, 2) }]
    };
};
