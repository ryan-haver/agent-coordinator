/**
 * File→SQLite Migration Utility
 *
 * One-shot migration that imports existing file-based swarm data
 * into the SQLite database.
 *
 * Usage:
 *   node build/storage/migrate.js --workspace /path/to/workspace
 *
 * This is ADDITIVE — it does NOT delete existing files.
 * Both backends can coexist safely.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
    getTableFromSection,
    readManifest
} from "../utils/manifest.js";
import {
    readAllAgentProgress,
    extractSessionId
} from "../utils/agent-progress.js";
import {
    listActiveSwarms
} from "../utils/swarm-registry.js";
import { applyWorkspaceMigrations } from "./migrations.js";

interface MigrationResult {
    agents: number;
    progress: number;
    fileClaims: number;
    issues: number;
    phaseGates: number;
    manifestStored: boolean;
}

/**
 * Migrate a workspace from file-based storage to SQLite.
 */
export function migrateWorkspace(wsRoot: string): MigrationResult {
    const result: MigrationResult = {
        agents: 0,
        progress: 0,
        fileClaims: 0,
        issues: 0,
        phaseGates: 0,
        manifestStored: false
    };

    // 1. Read existing manifest
    let md: string;
    try {
        md = readManifest(wsRoot);
    } catch {
        console.error(`No swarm-manifest.md found in ${wsRoot}, skipping.`);
        return result;
    }

    // 2. Open/create SQLite DB
    const dbDir = path.join(wsRoot, ".swarm");
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, "coordinator.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    applyWorkspaceMigrations(db);

    const sessionId = extractSessionId(md);

    db.transaction(() => {
        // 3. Store raw manifest
        db.prepare("INSERT OR REPLACE INTO manifest_content (id, content) VALUES (1, ?)").run(md);
        result.manifestStored = true;

        // 4. Store session ID in meta
        db.prepare(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('session_id', ?)"
        ).run(sessionId);

        // 5. Import agents table
        const agentsTable = getTableFromSection(md, "Agents");
        if (agentsTable) {
            const insertAgent = db.prepare(
                "INSERT OR REPLACE INTO agents (id, role, model, phase, scope, status) VALUES (?, ?, ?, ?, ?, ?)"
            );
            for (const row of agentsTable.rows) {
                insertAgent.run(
                    row["ID"] || "", row["Role"] || "", row["Model"] || "",
                    row["Phase"] || "0", row["Scope"] || "*", row["Status"] || "⏳ Pending"
                );
                result.agents++;
            }
        }

        // 6. Import issues from manifest
        const issuesTable = getTableFromSection(md, "Issues");
        if (issuesTable) {
            const insertIssue = db.prepare(
                "INSERT INTO issues (severity, area, description, reporter) VALUES (?, ?, ?, ?)"
            );
            for (const row of issuesTable.rows) {
                insertIssue.run(
                    row["Severity"] || "", row["File/Area"] || "",
                    row["Description"] || "", row["Reported By"] || ""
                );
                result.issues++;
            }
        }

        // 7. Import phase gates
        const gatesMatch = md.match(/## Phase Gates\s*\n+([\s\S]*?)(?:\n##\s|$)/);
        if (gatesMatch) {
            const insertGate = db.prepare(
                "INSERT OR REPLACE INTO phase_gates (phase, label, complete) VALUES (?, ?, ?)"
            );
            for (const line of gatesMatch[1].split("\n")) {
                const m = line.match(/^\s*-\s*\[(x| )\]\s*(.+)/);
                if (m) {
                    insertGate.run(m[2].trim(), m[2].trim(), m[1] === "x" ? 1 : 0);
                    result.phaseGates++;
                }
            }
        }

        // 8. Import agent progress files
        const allProgress = readAllAgentProgress(wsRoot, sessionId);
        const insertProgress = db.prepare(`
            INSERT OR REPLACE INTO agent_progress (agent_id, role, phase, status, detail, session_id, handoff_notes, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertClaim = db.prepare(
            "INSERT INTO file_claims (file, agent_id, status) VALUES (?, ?, ?)"
        );
        const insertAgentIssue = db.prepare(
            "INSERT INTO agent_issues (agent_id, severity, area, description) VALUES (?, ?, ?, ?)"
        );

        for (const ap of allProgress) {
            insertProgress.run(
                ap.agent_id, ap.role, ap.phase, ap.status,
                ap.detail || "", ap.swarm_session_id || sessionId,
                ap.handoff_notes || "", ap.last_updated || new Date().toISOString()
            );
            result.progress++;

            for (const claim of ap.file_claims) {
                insertClaim.run(claim.file, ap.agent_id, claim.status);
                result.fileClaims++;
            }

            for (const issue of ap.issues) {
                insertAgentIssue.run(ap.agent_id, issue.severity, issue.area, issue.description);
            }
        }
    })();

    db.close();
    return result;
}

// ── CLI Entry Point ──────────────────────────────────────────────────

if (process.argv[1]?.endsWith("migrate.js") || process.argv[1]?.endsWith("migrate.ts")) {
    const wsIdx = process.argv.indexOf("--workspace");
    const wsRoot = wsIdx !== -1 ? process.argv[wsIdx + 1] : process.cwd();

    console.log(`Migrating workspace: ${wsRoot}`);
    const result = migrateWorkspace(wsRoot);

    console.log("\nMigration complete:");
    console.log(`  Manifest stored: ${result.manifestStored}`);
    console.log(`  Agents:          ${result.agents}`);
    console.log(`  Progress files:  ${result.progress}`);
    console.log(`  File claims:     ${result.fileClaims}`);
    console.log(`  Issues:          ${result.issues}`);
    console.log(`  Phase gates:     ${result.phaseGates}`);
    console.log(`\nDatabase: ${path.join(wsRoot, ".swarm", "coordinator.db")}`);
}
