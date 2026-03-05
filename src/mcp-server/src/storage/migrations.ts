/**
 * Migration runner for SQLite databases.
 * Applies DDL and tracks schema version in the `meta` table.
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

/**
 * Apply workspace database migrations.
 * Runs all DDL statements inside a transaction.
 */
export function applyWorkspaceMigrations(db: Database.Database): void {
    const currentVersion = getSchemaVersion(db);
    if (currentVersion >= WORKSPACE_SCHEMA_VERSION) return;

    db.transaction(() => {
        db.exec(WORKSPACE_DDL);
        setSchemaVersion(db, WORKSPACE_SCHEMA_VERSION);
    })();
}

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
