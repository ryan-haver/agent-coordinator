/**
 * SqliteStorageAdapter — Implements StorageAdapter using better-sqlite3.
 *
 * Two databases:
 *   - Workspace DB at {wsRoot}/.swarm/coordinator.db  (per-swarm)
 *   - Global DB   at ~/.antigravity-configs/coordinator-global.db (cross-workspace)
 *
 * All operations are synchronous (better-sqlite3 is sync), wrapped in
 * the async interface for compatibility with the StorageAdapter contract.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import type {
    StorageAdapter,
    AgentRow,
    FileClaim,
    Issue,
    PhaseGate,
    AgentProgressData,
    SwarmEvent,
    SwarmInfo
} from "./adapter.js";
import { applyWorkspaceMigrations, applyGlobalMigrations } from "./migrations.js";

// ── DB Lifecycle ──────────────────────────────────────────────────────

const wsDbCache = new Map<string, Database.Database>();
let globalDb: Database.Database | null = null;

const GLOBAL_DB_DIR = path.join(os.homedir(), ".antigravity-configs");
const GLOBAL_DB_PATH = path.join(GLOBAL_DB_DIR, "coordinator-global.db");

function getWsDb(wsRoot: string): Database.Database {
    const key = path.resolve(wsRoot);
    let db = wsDbCache.get(key);
    if (db) return db;

    const dbDir = path.join(key, ".swarm");
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, "coordinator.db");

    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    applyWorkspaceMigrations(db);
    wsDbCache.set(key, db);
    return db;
}

function getGlobalDb(): Database.Database {
    if (globalDb) return globalDb;

    if (!fs.existsSync(GLOBAL_DB_DIR)) fs.mkdirSync(GLOBAL_DB_DIR, { recursive: true });

    globalDb = new Database(GLOBAL_DB_PATH);
    globalDb.pragma("journal_mode = WAL");
    globalDb.pragma("busy_timeout = 5000");
    applyGlobalMigrations(globalDb);
    return globalDb;
}

// ── Implementation ────────────────────────────────────────────────────

export class SqliteStorageAdapter implements StorageAdapter {

    // ── Manifest ─────────────────────────────────────────────────────

    readManifest(wsRoot: string): string {
        const db = getWsDb(wsRoot);
        const row = db.prepare("SELECT content FROM manifest_content WHERE id = 1").get() as { content: string } | undefined;
        if (!row || !row.content) {
            // Fallback: try reading from file for backwards compat
            const filePath = path.join(wsRoot, "swarm-manifest.md");
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf8");
                // Seed the DB
                db.prepare("INSERT OR REPLACE INTO manifest_content (id, content) VALUES (1, ?)").run(content);
                return content;
            }
            throw new Error(`No manifest found for workspace ${wsRoot}`);
        }
        return row.content;
    }

    writeManifest(wsRoot: string, content: string): void {
        const db = getWsDb(wsRoot);
        db.prepare("INSERT OR REPLACE INTO manifest_content (id, content) VALUES (1, ?)").run(content);
        // Also write to file for human readability
        try {
            const filePath = path.join(wsRoot, "swarm-manifest.md");
            const backupPath = filePath + ".bak";
            if (fs.existsSync(filePath)) {
                try { fs.copyFileSync(filePath, backupPath); } catch { /* non-fatal */ }
            }
            fs.writeFileSync(filePath, content, "utf8");
        } catch { /* file write is non-fatal, DB is source of truth */ }
    }

    async withManifestLock<T>(
        wsRoot: string,
        fn: (md: string) => { content: string | null; result: T }
    ): Promise<T> {
        const db = getWsDb(wsRoot);
        // SQLite's BEGIN IMMEDIATE gives us serialized access
        const run = db.transaction(() => {
            const md = this.readManifest(wsRoot);
            const { content, result } = fn(md);
            if (content !== null) {
                this.writeManifest(wsRoot, content);
            }
            return result;
        });
        return run();
    }

    // ── Agents ───────────────────────────────────────────────────────

    listAgents(wsRoot: string): AgentRow[] {
        const db = getWsDb(wsRoot);
        const rows = db.prepare("SELECT id, role, model, phase, scope, status FROM agents").all() as AgentRow[];
        return rows;
    }

    getAgent(wsRoot: string, agentId: string): AgentRow | null {
        const db = getWsDb(wsRoot);
        const row = db.prepare("SELECT id, role, model, phase, scope, status FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
        return row || null;
    }

    addAgent(wsRoot: string, agent: AgentRow): void {
        const db = getWsDb(wsRoot);
        try {
            db.prepare(
                "INSERT INTO agents (id, role, model, phase, scope, status) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(agent.id, agent.role, agent.model, agent.phase, agent.scope, agent.status);
        } catch (e: any) {
            if (e.message?.includes("UNIQUE constraint")) {
                throw new Error(`Agent ${agent.id} already exists`);
            }
            throw e;
        }
    }

    updateAgent(wsRoot: string, agentId: string, fields: Partial<Omit<AgentRow, "id">>): void {
        const db = getWsDb(wsRoot);
        const sets: string[] = [];
        const values: any[] = [];
        if (fields.role !== undefined) { sets.push("role = ?"); values.push(fields.role); }
        if (fields.model !== undefined) { sets.push("model = ?"); values.push(fields.model); }
        if (fields.phase !== undefined) { sets.push("phase = ?"); values.push(fields.phase); }
        if (fields.scope !== undefined) { sets.push("scope = ?"); values.push(fields.scope); }
        if (fields.status !== undefined) { sets.push("status = ?"); values.push(fields.status); }
        if (sets.length === 0) return;
        values.push(agentId);
        const result = db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...values);
        if (result.changes === 0) throw new Error(`Agent ${agentId} not found`);
    }

    removeAgent(wsRoot: string, agentId: string): void {
        const db = getWsDb(wsRoot);
        const result = db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
        if (result.changes === 0) throw new Error(`Agent ${agentId} not found`);
    }

    // ── Agent Progress ───────────────────────────────────────────────

    readAgentProgress(wsRoot: string, agentId: string): AgentProgressData | null {
        const db = getWsDb(wsRoot);
        const row = db.prepare(
            "SELECT agent_id, role, phase, status, detail, session_id, handoff_notes, last_updated FROM agent_progress WHERE agent_id = ?"
        ).get(agentId) as any;
        if (!row) return null;

        const fileClaims = db.prepare(
            "SELECT file, status FROM file_claims WHERE agent_id = ?"
        ).all(agentId) as Array<{ file: string; status: string }>;

        const issues = db.prepare(
            "SELECT severity, area, description FROM agent_issues WHERE agent_id = ?"
        ).all(agentId) as Array<{ severity: string; area: string; description: string }>;

        return {
            agent_id: row.agent_id,
            role: row.role,
            phase: row.phase,
            status: row.status,
            detail: row.detail,
            session_id: row.session_id,
            file_claims: fileClaims,
            issues,
            handoff_notes: row.handoff_notes,
            last_updated: row.last_updated
        };
    }

    writeAgentProgress(wsRoot: string, progress: AgentProgressData): void {
        const db = getWsDb(wsRoot);
        const now = new Date().toISOString();

        db.transaction(() => {
            // Upsert the main progress row
            db.prepare(`
                INSERT INTO agent_progress (agent_id, role, phase, status, detail, session_id, handoff_notes, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                    role = excluded.role,
                    phase = excluded.phase,
                    status = excluded.status,
                    detail = excluded.detail,
                    session_id = excluded.session_id,
                    handoff_notes = excluded.handoff_notes,
                    last_updated = excluded.last_updated
            `).run(
                progress.agent_id, progress.role, progress.phase,
                progress.status, progress.detail, progress.session_id,
                progress.handoff_notes, now
            );

            // Sync file claims: delete then re-insert
            db.prepare("DELETE FROM file_claims WHERE agent_id = ?").run(progress.agent_id);
            const insertClaim = db.prepare(
                "INSERT INTO file_claims (file, agent_id, status) VALUES (?, ?, ?)"
            );
            for (const claim of progress.file_claims) {
                insertClaim.run(claim.file, progress.agent_id, claim.status);
            }

            // Sync issues: delete then re-insert
            db.prepare("DELETE FROM agent_issues WHERE agent_id = ?").run(progress.agent_id);
            const insertIssue = db.prepare(
                "INSERT INTO agent_issues (agent_id, severity, area, description) VALUES (?, ?, ?, ?)"
            );
            for (const issue of progress.issues) {
                insertIssue.run(progress.agent_id, issue.severity, issue.area, issue.description);
            }
        })();
    }

    readAllAgentProgress(wsRoot: string, sessionId: string): AgentProgressData[] {
        const db = getWsDb(wsRoot);
        let rows: any[];
        if (sessionId) {
            rows = db.prepare(
                "SELECT agent_id, role, phase, status, detail, session_id, handoff_notes, last_updated FROM agent_progress WHERE session_id = ?"
            ).all(sessionId);
        } else {
            rows = db.prepare(
                "SELECT agent_id, role, phase, status, detail, session_id, handoff_notes, last_updated FROM agent_progress"
            ).all();
        }

        const claimStmt = db.prepare("SELECT file, status FROM file_claims WHERE agent_id = ?");
        const issueStmt = db.prepare("SELECT severity, area, description FROM agent_issues WHERE agent_id = ?");

        return rows.map(row => ({
            agent_id: row.agent_id,
            role: row.role,
            phase: row.phase,
            status: row.status,
            detail: row.detail,
            session_id: row.session_id,
            file_claims: claimStmt.all(row.agent_id) as Array<{ file: string; status: string }>,
            issues: issueStmt.all(row.agent_id) as Array<{ severity: string; area: string; description: string }>,
            handoff_notes: row.handoff_notes,
            last_updated: row.last_updated
        }));
    }

    cleanupAgentFiles(wsRoot: string): number {
        const db = getWsDb(wsRoot);
        let count = 0;
        db.transaction(() => {
            count += db.prepare("DELETE FROM agent_progress").run().changes;
            count += db.prepare("DELETE FROM file_claims").run().changes;
            count += db.prepare("DELETE FROM agent_issues").run().changes;
            count += db.prepare("DELETE FROM events").run().changes;
        })();
        return count;
    }

    // ── File Claims ──────────────────────────────────────────────────

    claimFile(wsRoot: string, agentId: string, filePath: string): boolean {
        const db = getWsDb(wsRoot);

        // Check for existing active claim
        const existing = db.prepare(
            "SELECT agent_id FROM file_claims WHERE file = ? AND status NOT IN ('✅ Done', '⚠️ Abandoned')"
        ).get(filePath) as { agent_id: string } | undefined;

        if (existing && existing.agent_id !== agentId) {
            throw new Error(`File ${filePath} already claimed by ${existing.agent_id}`);
        }

        // Ensure agent progress row exists
        const hasProgress = db.prepare("SELECT 1 FROM agent_progress WHERE agent_id = ?").get(agentId);
        if (!hasProgress) {
            db.prepare(`
                INSERT INTO agent_progress (agent_id, role, phase, status, detail, session_id, handoff_notes, last_updated)
                VALUES (?, 'unknown', '0', '⏳ Pending', '', '', '', datetime('now'))
            `).run(agentId);
        }

        db.prepare(
            "INSERT INTO file_claims (file, agent_id, status) VALUES (?, ?, '🔄 Active')"
        ).run(filePath, agentId);

        return true;
    }

    checkFileClaim(wsRoot: string, filePath: string): FileClaim[] {
        const db = getWsDb(wsRoot);
        return db.prepare(
            "SELECT file, agent_id, status, claimed_at FROM file_claims WHERE file = ?"
        ).all(filePath) as FileClaim[];
    }

    releaseFileClaim(wsRoot: string, agentId: string, filePath: string, status: string): void {
        const db = getWsDb(wsRoot);
        const result = db.prepare(
            "UPDATE file_claims SET status = ? WHERE file = ? AND agent_id = ? AND status NOT IN ('✅ Done', '⚠️ Abandoned')"
        ).run(status, filePath, agentId);
        if (result.changes === 0) {
            throw new Error(`Active claim for ${filePath} by ${agentId} not found`);
        }
    }

    releaseAllClaims(wsRoot: string, agentId: string): string[] {
        const db = getWsDb(wsRoot);
        const active = db.prepare(
            "SELECT file FROM file_claims WHERE agent_id = ? AND status NOT IN ('✅ Done', '⚠️ Abandoned')"
        ).all(agentId) as Array<{ file: string }>;

        db.prepare(
            "UPDATE file_claims SET status = '⚠️ Abandoned' WHERE agent_id = ? AND status NOT IN ('✅ Done', '⚠️ Abandoned')"
        ).run(agentId);

        return active.map(r => r.file);
    }

    // ── Issues ────────────────────────────────────────────────────────

    addIssue(wsRoot: string, issue: Issue): void {
        const db = getWsDb(wsRoot);
        db.prepare(
            "INSERT INTO issues (severity, area, description, reporter) VALUES (?, ?, ?, ?)"
        ).run(issue.severity, issue.area, issue.description, issue.reporter);
    }

    listIssues(wsRoot: string): Issue[] {
        const db = getWsDb(wsRoot);

        // Manifest-level issues
        const manifestIssues = db.prepare(
            "SELECT severity, area, description, reporter FROM issues"
        ).all() as Issue[];

        // Agent-level issues
        const agentIssues = db.prepare(
            "SELECT ai.severity, ai.area, ai.description, ai.agent_id AS reporter FROM agent_issues ai"
        ).all() as Issue[];

        // Dedup
        const combined = [...manifestIssues];
        for (const ai of agentIssues) {
            if (!combined.some(e => e.description === ai.description && e.reporter === ai.reporter)) {
                combined.push(ai);
            }
        }
        return combined;
    }

    // ── Phase Gates ──────────────────────────────────────────────────

    getPhaseGates(wsRoot: string): PhaseGate[] {
        const db = getWsDb(wsRoot);
        return db.prepare(
            "SELECT phase, complete FROM phase_gates ORDER BY phase"
        ).all().map((r: any) => ({ phase: r.phase, complete: r.complete === 1 }));
    }

    setPhaseGate(wsRoot: string, phase: string, complete: boolean): void {
        const db = getWsDb(wsRoot);
        const result = db.prepare(
            "UPDATE phase_gates SET complete = ? WHERE phase = ?"
        ).run(complete ? 1 : 0, phase);
        if (result.changes === 0) {
            // Insert if doesn't exist
            db.prepare(
                "INSERT INTO phase_gates (phase, complete) VALUES (?, ?)"
            ).run(phase, complete ? 1 : 0);
        }
    }

    // ── Events ────────────────────────────────────────────────────────

    async broadcastEvent(event: SwarmEvent): Promise<void> {
        const db = getWsDb(event.workspace);
        db.prepare(
            "INSERT INTO events (timestamp, agent_id, event_type, message, session_id) VALUES (?, ?, ?, ?, ?)"
        ).run(event.timestamp, event.agent_id, event.event_type, event.message, event.session_id);
    }

    getEvents(wsRoot: string, sessionId: string, eventType?: string): SwarmEvent[] {
        const db = getWsDb(wsRoot);
        if (eventType) {
            return db.prepare(
                "SELECT timestamp, agent_id, event_type, message, session_id FROM events WHERE session_id = ? AND event_type = ? ORDER BY timestamp"
            ).all(sessionId, eventType).map((r: any) => ({ ...r, workspace: wsRoot }));
        }
        return db.prepare(
            "SELECT timestamp, agent_id, event_type, message, session_id FROM events WHERE session_id = ? ORDER BY timestamp"
        ).all(sessionId).map((r: any) => ({ ...r, workspace: wsRoot }));
    }

    cleanupEvents(wsRoot: string, sessionId: string): void {
        const db = getWsDb(wsRoot);
        db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId);
    }

    // ── Swarm Registry (global DB) ───────────────────────────────────

    async registerSwarm(info: SwarmInfo): Promise<void> {
        const db = getGlobalDb();
        db.prepare(`
            INSERT INTO swarm_registry (workspace, session_id, mission, phase, agents_active, agents_total, supervision, started_at, last_updated, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace) DO UPDATE SET
                session_id = excluded.session_id,
                mission = excluded.mission,
                phase = excluded.phase,
                agents_active = excluded.agents_active,
                agents_total = excluded.agents_total,
                supervision = excluded.supervision,
                started_at = excluded.started_at,
                last_updated = excluded.last_updated,
                status = excluded.status
        `).run(
            info.workspace, info.session_id, info.mission, info.phase,
            info.agents_active, info.agents_total, info.supervision,
            info.started_at, info.last_updated, info.status
        );
    }

    async updateSwarmRegistry(wsRoot: string, fields: Partial<SwarmInfo>): Promise<void> {
        const db = getGlobalDb();
        const sets: string[] = ["last_updated = datetime('now')"];
        const values: any[] = [];

        if (fields.session_id !== undefined) { sets.push("session_id = ?"); values.push(fields.session_id); }
        if (fields.mission !== undefined) { sets.push("mission = ?"); values.push(fields.mission); }
        if (fields.phase !== undefined) { sets.push("phase = ?"); values.push(fields.phase); }
        if (fields.agents_active !== undefined) { sets.push("agents_active = ?"); values.push(fields.agents_active); }
        if (fields.agents_total !== undefined) { sets.push("agents_total = ?"); values.push(fields.agents_total); }
        if (fields.supervision !== undefined) { sets.push("supervision = ?"); values.push(fields.supervision); }
        if (fields.status !== undefined) { sets.push("status = ?"); values.push(fields.status); }

        values.push(wsRoot);
        db.prepare(`UPDATE swarm_registry SET ${sets.join(", ")} WHERE workspace = ?`).run(...values);
    }

    async deregisterSwarm(wsRoot: string): Promise<void> {
        const db = getGlobalDb();
        db.prepare("DELETE FROM swarm_registry WHERE workspace = ?").run(wsRoot);
    }

    listActiveSwarms(): SwarmInfo[] {
        const db = getGlobalDb();
        return db.prepare(
            "SELECT workspace, session_id, mission, phase, agents_active, agents_total, supervision, started_at, last_updated, status FROM swarm_registry WHERE status = 'active'"
        ).all() as SwarmInfo[];
    }

    // ── Session ──────────────────────────────────────────────────────

    extractSessionId(md: string): string {
        const match = md.match(/<!--\s*session:\s*(\S+)\s*-->/);
        return match ? match[1] : "";
    }

    generateSessionId(): string {
        return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    }

    // ── Status ────────────────────────────────────────────────────────

    writeSwarmStatus(wsRoot: string, lastEvent: string): void {
        try {
            const db = getWsDb(wsRoot);
            const md = this.readManifest(wsRoot);

            const modeSection = md.match(/Supervision:\s*(.+)/);
            const supervision = modeSection ? modeSection[1].trim() : "unknown";

            const missionMatch = md.match(/## Mission\s*\n+(.+)/);
            const task = missionMatch ? missionMatch[1].trim() : "";

            const sessionId = this.extractSessionId(md);

            // Query agent counts directly from DB
            const counts = db.prepare(`
                SELECT
                    COUNT(CASE WHEN status LIKE '%Active%' THEN 1 END) AS active,
                    COUNT(CASE WHEN status LIKE '%Complete%' OR status LIKE '%Done%' THEN 1 END) AS complete,
                    COUNT(CASE WHEN status LIKE '%Pending%' THEN 1 END) AS pending
                FROM agent_progress WHERE session_id = ?
            `).get(sessionId) as { active: number; complete: number; pending: number } | undefined;

            const active = counts?.active || 0;
            const complete = counts?.complete || 0;
            const pending = counts?.pending || 0;

            const activeAgent = db.prepare(
                "SELECT phase FROM agent_progress WHERE session_id = ? AND status LIKE '%Active%' LIMIT 1"
            ).get(sessionId) as { phase: string } | undefined;

            const totalAgents = db.prepare(
                "SELECT COUNT(*) AS cnt FROM agent_progress WHERE session_id = ?"
            ).get(sessionId) as { cnt: number };

            const phase = activeAgent?.phase || (complete === totalAgents.cnt && totalAgents.cnt > 0 ? "done" : "0");

            // Check if phase gate advancement needed
            let allPhaseAgentsDone = false;
            if (totalAgents.cnt > 0) {
                const phaseAgents = db.prepare(
                    "SELECT COUNT(*) AS total, COUNT(CASE WHEN status LIKE '%Complete%' OR status LIKE '%Done%' THEN 1 END) AS done FROM agent_progress WHERE session_id = ? AND phase = ?"
                ).get(sessionId, phase) as { total: number; done: number };
                allPhaseAgentsDone = phaseAgents.total > 0 && phaseAgents.done === phaseAgents.total;
            }

            const needsAction = (supervision.toLowerCase().includes("gate") || supervision === "2") && allPhaseAgentsDone && phase !== "done";

            // Get detailed agent list and their phases/statuses
            const allAgentsData = db.prepare(
                "SELECT agent_id, role, phase, status FROM agent_progress WHERE session_id = ?"
            ).all(sessionId) as Array<{ agent_id: string; role: string; phase: string; status: string }>;

            // Get session telemetry
            let telemetry = { total_calls: 0, avg_duration_ms: 0, failures: 0 };
            try {
                const telRow = db.prepare(`
                    SELECT COUNT(*) as total_calls, AVG(duration_ms) as avg_duration, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failures
                    FROM telemetry_buffer WHERE session_id = ?
                `).get(sessionId) as { total_calls: number; avg_duration: number; failures: number } | undefined;
                if (telRow) {
                    telemetry = {
                        total_calls: Number(telRow.total_calls || 0),
                        avg_duration_ms: Math.round(Number(telRow.avg_duration || 0)),
                        failures: Number(telRow.failures || 0)
                    };
                }
            } catch { /* ignore if table not ready */ }

            const statusObj = {
                task,
                phase,
                supervision,
                agents_active: active,
                agents_complete: complete,
                agents_pending: pending,
                last_event: lastEvent,
                needs_user_action: needsAction,
                timestamp: new Date().toISOString(),
                agents: allAgentsData,
                telemetry
            };
            fs.writeFileSync(path.join(wsRoot, "swarm_status.json"), JSON.stringify(statusObj, null, 2));
        } catch (e) {
            console.error("[agent-coordinator] Failed to write swarm_status.json:", e);
        }
    }
}

// ── Cleanup ──────────────────────────────────────────────────────────

/**
 * Close all cached database connections.
 * Call during graceful shutdown or tests.
 */
export function closeAllDatabases(): void {
    for (const db of wsDbCache.values()) {
        try { db.close(); } catch { /* ignore */ }
    }
    wsDbCache.clear();
    if (globalDb) {
        try { globalDb.close(); } catch { /* ignore */ }
        globalDb = null;
    }
}
