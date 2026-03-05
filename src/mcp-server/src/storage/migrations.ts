/**
 * Migration runner for SQLite databases.
 * Applies DDL and tracks schema version in the `meta` table.
 * Each migration is incremental (v0→v1, v1→v2, etc.)
 */
import Database from "better-sqlite3";
import {
    WORKSPACE_SCHEMA_VERSION,
    GLOBAL_SCHEMA_VERSION,
    WORKSPACE_DDL,
    GLOBAL_DDL
} from "./schema.js";

/**
 * Get current schema version from a database.
 * Returns 0 if the meta table doesn't exist yet.
 */
function getSchemaVersion(db: Database.Database): number {
    try {
        const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
        return row ? parseInt(row.value, 10) : 0;
    } catch {
        return 0;
    }
}

/**
 * Set schema version in the meta table.
 */
function setSchemaVersion(db: Database.Database, version: number): void {
    db.prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(String(version));
}

// ── Workspace migrations ─────────────────────────────────────────────

/** v0 → v1: full schema creation */
const WORKSPACE_V1 = WORKSPACE_DDL;

/** v1 → v2: add telemetry_buffer table */
const WORKSPACE_V2 = `
CREATE TABLE IF NOT EXISTS telemetry_buffer (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL DEFAULT (datetime('now')),
    session_id   TEXT    NOT NULL DEFAULT '',
    workspace    TEXT    NOT NULL DEFAULT '',
    agent_id     TEXT    NOT NULL DEFAULT '',
    tool_name    TEXT    NOT NULL,
    phase        TEXT    NOT NULL DEFAULT '',
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    success      INTEGER NOT NULL DEFAULT 1,
    error_msg    TEXT    NOT NULL DEFAULT '',
    args_summary TEXT    NOT NULL DEFAULT '',
    synced       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_telemetry_unsynced ON telemetry_buffer(synced);
CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_buffer(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_agent ON telemetry_buffer(agent_id);
`;

/**
 * Apply workspace database migrations incrementally.
 */
export function applyWorkspaceMigrations(db: Database.Database): void {
    let version = getSchemaVersion(db);
    if (version >= WORKSPACE_SCHEMA_VERSION) return;

    if (version < 1) {
        db.transaction(() => {
            db.exec(WORKSPACE_V1);
            setSchemaVersion(db, 1);
        })();
        version = 1;
    }

    if (version < 2) {
        db.transaction(() => {
            db.exec(WORKSPACE_V2);
            setSchemaVersion(db, 2);
        })();
        version = 2;
    }
}

// ── Global migrations ────────────────────────────────────────────────

/**
 * Apply global database migrations.
 */
export function applyGlobalMigrations(db: Database.Database): void {
    const currentVersion = getSchemaVersion(db);
    if (currentVersion >= GLOBAL_SCHEMA_VERSION) return;

    db.transaction(() => {
        db.exec(GLOBAL_DDL);
        setSchemaVersion(db, GLOBAL_SCHEMA_VERSION);
    })();
}
