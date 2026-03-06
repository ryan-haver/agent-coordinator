/**
 * Milestone 2 Integration Tests — SQLite Storage Backend.
 *
 * Validates that with STORAGE_BACKEND=sqlite:
 * - coordinator.db is created on first tool call
 * - Agent, manifest, and claim data is stored in SQLite tables
 * - Schema version = 2 (includes telemetry_buffer)
 * - Direct SQLite assertions via better-sqlite3
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, TestServer } from "./helpers/server.js";
import { createFixture, Fixture } from "./helpers/fixtures.js";
import path from "path";
import Database from "better-sqlite3";

let server: TestServer;
let fixture: Fixture;

function openDb(tmpDir: string): Database.Database {
    const dbPath = path.join(tmpDir, ".swarm", "coordinator.db");
    return new Database(dbPath);
}

beforeEach(async () => {
    fixture = createFixture("m2-");
    server = await createTestServer(fixture.tmpDir, { backend: "sqlite" });
});

afterEach(async () => {
    await server.close();
    fixture.cleanup();
});

// ── DB creation ──────────────────────────────────────────────────────

describe("SQLite DB creation", () => {
    it("coordinator.db exists after first tool call", async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "SQLite test", workspace_root: fixture.tmpDir
        });
        const db = openDb(fixture.tmpDir);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
        const names = tables.map(t => t.name);
        expect(names).toContain("agents");
        expect(names).toContain("manifest_content");
        expect(names).toContain("telemetry_buffer");
        db.close();
    });

    it("schema_version = 2", async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Version test", workspace_root: fixture.tmpDir
        });
        const db = openDb(fixture.tmpDir);
        const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
        expect(row?.value).toBe("2");
        db.close();
    });
});

// ── Manifest in SQLite ────────────────────────────────────────────────

describe("Manifest stored in SQLite", () => {
    it("create_swarm_manifest writes to manifest_content table", async () => {
        const result = await server.callTool("create_swarm_manifest", {
            mission: "SQLite manifest test", workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);

        const db = openDb(fixture.tmpDir);
        const rows = db.prepare("SELECT * FROM manifest_content").all() as Array<{ content: string }>;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].content).toContain("SQLite manifest test");
        db.close();
    });
});

// ── Agents in SQLite ──────────────────────────────────────────────────

describe("Agents stored in SQLite", () => {
    beforeEach(async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Agent SQLite test", workspace_root: fixture.tmpDir
        });
    });

    it("add_agent_to_manifest writes agent into manifest_content", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "architect", model: "claude",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });

        const db = openDb(fixture.tmpDir);
        // Agents are written into the manifest markdown blob, not a separate agents row
        const manifest = db.prepare("SELECT content FROM manifest_content LIMIT 1").get() as { content: string } | undefined;
        expect(manifest?.content).toContain("α");
        expect(manifest?.content).toContain("architect");
        db.close();
    });

    it("update_agent_status updates agents row in SQLite", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "β", role: "developer", model: "gemini",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
        await server.callTool("update_agent_status", {
            agent_id: "β", status: "✅ Complete", workspace_root: fixture.tmpDir
        });

        const db = openDb(fixture.tmpDir);
        const row = db.prepare("SELECT status FROM agent_progress WHERE agent_id = ?").get("β") as { status: string } | undefined;
        expect(row?.status).toContain("Complete");
        db.close();
    });
});

// ── File claims in SQLite ─────────────────────────────────────────────

describe("File claims stored in SQLite", () => {
    beforeEach(async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "File claim SQLite test", workspace_root: fixture.tmpDir
        });
        await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "developer", model: "claude",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
    });

    it("claim_file writes to file_claims table", async () => {
        const result = await server.callTool("claim_file", {
            agent_id: "α", file_path: "src/auth.ts", workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);

        const db = openDb(fixture.tmpDir);
        const claims = db.prepare("SELECT * FROM file_claims WHERE file = ?").all("src/auth.ts") as any[];
        expect(claims.length).toBeGreaterThan(0);
        expect(claims[0].agent_id).toBe("α");
        db.close();
    });
});

// ── Full round-trip ───────────────────────────────────────────────────

describe("Full tool round-trip via SQLite", () => {
    it("create manifest → add agent → claim file — all persisted in SQLite", async () => {
        await server.callTool("create_swarm_manifest", { mission: "Round trip", workspace_root: fixture.tmpDir });
        await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "qa", model: "claude",
            phase: "1", scope: "tests/", workspace_root: fixture.tmpDir
        });
        await server.callTool("claim_file", {
            agent_id: "α", file_path: "tests/auth.test.ts", workspace_root: fixture.tmpDir
        });

        // Verify agent appears in manifest section (reads manifest_content in SQLite mode)
        const section = await server.callTool("read_manifest_section", {
            section: "Agents", workspace_root: fixture.tmpDir
        });
        expect(section.isError).toBe(false);
        expect(section.text).toContain("α");

        // Verify manifest_content blob contains agent data
        const db = openDb(fixture.tmpDir);
        const manifest = db.prepare("SELECT content FROM manifest_content LIMIT 1").get() as { content: string } | undefined;
        expect(manifest?.content).toContain("α");

        // Verify file claims are readable via MCP tool
        const check = await server.callTool("check_file_claim", {
            file_path: "tests/auth.test.ts", workspace_root: fixture.tmpDir
        });
        expect(check.isError).toBe(false);
        db.close();
    });
});
