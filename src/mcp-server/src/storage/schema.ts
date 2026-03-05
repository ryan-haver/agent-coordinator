/**
 * SQLite Schema — DDL for the Agent Coordinator storage backend.
 *
 * Two databases exist:
 *   1. Workspace DB  ({wsRoot}/.swarm/coordinator.db) — per-swarm state
 *   2. Global DB     (~/.antigravity-configs/coordinator-global.db) — cross-workspace registry
 */

export const WORKSPACE_SCHEMA_VERSION = 2;
export const GLOBAL_SCHEMA_VERSION = 1;

// ── Workspace DB tables ──────────────────────────────────────────────

export const WORKSPACE_DDL = `
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manifest_content (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS agents (
    id     TEXT PRIMARY KEY,
    role   TEXT NOT NULL,
    model  TEXT NOT NULL DEFAULT '',
    phase  TEXT NOT NULL DEFAULT '0',
    scope  TEXT NOT NULL DEFAULT '*',
    status TEXT NOT NULL DEFAULT '⏳ Pending'
);

CREATE TABLE IF NOT EXISTS agent_progress (
    agent_id       TEXT PRIMARY KEY,
    role           TEXT NOT NULL,
    phase          TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT '⏳ Pending',
    detail         TEXT NOT NULL DEFAULT '',
    session_id     TEXT NOT NULL DEFAULT '',
    handoff_notes  TEXT NOT NULL DEFAULT '',
    last_updated   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS file_claims (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    file       TEXT NOT NULL,
    agent_id   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT '🔄 Active',
    claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id    TEXT NOT NULL,
    severity    TEXT NOT NULL,
    area        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    severity    TEXT NOT NULL,
    area        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    reporter    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phase_gates (
    phase    TEXT PRIMARY KEY,
    label    TEXT NOT NULL DEFAULT '',
    complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
    agent_id   TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message    TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT ''
);

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

// ── Global DB tables ─────────────────────────────────────────────────

export const GLOBAL_DDL = `
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS swarm_registry (
    workspace     TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    mission       TEXT NOT NULL DEFAULT '',
    phase         TEXT NOT NULL DEFAULT '0',
    agents_active INTEGER NOT NULL DEFAULT 0,
    agents_total  INTEGER NOT NULL DEFAULT 0,
    supervision   TEXT NOT NULL DEFAULT 'Full',
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_updated  TEXT NOT NULL DEFAULT (datetime('now')),
    status        TEXT NOT NULL DEFAULT 'active'
);
`;
