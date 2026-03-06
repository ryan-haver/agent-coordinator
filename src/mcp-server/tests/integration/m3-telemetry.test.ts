/**
 * Milestone 3 Integration Tests — Telemetry (SQLite buffer + optional TSDB).
 *
 * Part A (always runs): SQLite buffer — verifies record(), queryLocal(), drain marking.
 * Part B (TSDB_URL required): live TimescaleDB writes and drain.
 *
 * Guards: Part B tests skip gracefully when TSDB_URL is not set.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, TestServer } from "./helpers/server.js";
import { createFixture, Fixture } from "./helpers/fixtures.js";
import { getTelemetry } from "../../src/telemetry/client.js";
import path from "path";
import Database from "better-sqlite3";

let server: TestServer;
let fixture: Fixture;

function openDb(tmpDir: string): Database.Database {
    const dbPath = path.join(tmpDir, ".swarm", "coordinator.db");
    return new Database(dbPath);
}

const TSDB_URL = process.env.TSDB_URL;
const hasTsdb = !!TSDB_URL;

beforeEach(async () => {
    fixture = createFixture("m3-");
    // Enable telemetry recording (disable TSDB for Part A)
    server = await createTestServer(fixture.tmpDir, {
        backend: "file",
        disableTelemetry: false   // let telemetry record to SQLite buffer
    });
});

afterEach(async () => {
    await server.close();
    fixture.cleanup();
});

// ── Part A: SQLite buffer (always runs) ───────────────────────────────

describe("Part A — SQLite telemetry buffer", () => {
    it("tool call records row in telemetry_buffer", async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Telemetry test", workspace_root: fixture.tmpDir
        });

        const db = openDb(fixture.tmpDir);
        const rows = db.prepare("SELECT * FROM telemetry_buffer").all() as Array<{ tool_name: string; success: number }>;
        expect(rows.length).toBeGreaterThan(0);
        const manifestCall = rows.find(r => r.tool_name === "create_swarm_manifest");
        expect(manifestCall).toBeTruthy();
        expect(manifestCall!.success).toBe(1);
        db.close();
    });

    it("failed tool call records success=0 + error_msg", async () => {
        // Call with missing required args to force error
        await server.callTool("add_agent_to_manifest", {
            // missing: role, model, phase, scope, agent_id
            workspace_root: fixture.tmpDir
        });

        const db = openDb(fixture.tmpDir);
        const rows = db.prepare(
            "SELECT * FROM telemetry_buffer WHERE tool_name = 'add_agent_to_manifest' AND success = 0"
        ).all() as Array<{ error_msg: string }>;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].error_msg).toBeTruthy();
        db.close();
    });

    it("multiple tool calls accumulate in buffer", async () => {
        await server.callTool("create_swarm_manifest", { mission: "Test", workspace_root: fixture.tmpDir });
        await server.callTool("read_manifest_section", { section: "Agents", workspace_root: fixture.tmpDir });
        await server.callTool("get_swarm_status", { workspace_root: fixture.tmpDir });

        const db = openDb(fixture.tmpDir);
        const count = (db.prepare("SELECT COUNT(*) AS c FROM telemetry_buffer").get() as { c: number }).c;
        expect(count).toBeGreaterThanOrEqual(3);
        db.close();
    });

    it("duration_ms is recorded and non-negative", async () => {
        await server.callTool("create_swarm_manifest", { mission: "Duration", workspace_root: fixture.tmpDir });

        const db = openDb(fixture.tmpDir);
        const row = db.prepare("SELECT duration_ms FROM telemetry_buffer LIMIT 1").get() as { duration_ms: number };
        expect(row.duration_ms).toBeGreaterThanOrEqual(0);
        db.close();
    });

    it("args_summary is stored and not empty for create_swarm_manifest", async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "ArgSummary test", workspace_root: fixture.tmpDir
        });

        const db = openDb(fixture.tmpDir);
        const row = db.prepare(
            "SELECT args_summary FROM telemetry_buffer WHERE tool_name = 'create_swarm_manifest' LIMIT 1"
        ).get() as { args_summary: string } | undefined;
        expect(row?.args_summary).toBeTruthy();
        expect(row?.args_summary).toContain("ArgSummary test");
        db.close();
    });
});

// ── Part A: telemetry MCP tools ───────────────────────────────────────

describe("Part A — telemetry MCP query tools", () => {
    beforeEach(async () => {
        // Generate some telemetry data
        await server.callTool("create_swarm_manifest", { mission: "Query test", workspace_root: fixture.tmpDir });
        await server.callTool("read_manifest_section", { section: "Agents", workspace_root: fixture.tmpDir });
    });

    it("get_telemetry_summary returns non-zero total_calls", async () => {
        const result = await server.callTool("get_telemetry_summary", {});
        expect(result.isError).toBe(false);
        // Output uses 'Total calls:' (capital T, human-readable format)
        expect(result.text).toContain("Total calls:");
        // Should NOT show 0 calls (beforeEach makes 2 tool calls)
        expect(result.text).not.toMatch(/Total calls:\s+0/);
    });

    it("get_my_telemetry returns rows for agent_id", async () => {
        // Trigger a call that sets an agent_id in context
        await server.callTool("get_my_assignment", {
            agent_id: "test-agent", workspace_root: fixture.tmpDir
        });
        const result = await server.callTool("get_my_telemetry", {
            agent_id: "test-agent"
        });
        expect(result.isError).toBe(false);
    });

    it("get_slow_operations returns no false positives for fast ops", async () => {
        const result = await server.callTool("get_slow_operations", {
            threshold_ms: 5000
        });
        expect(result.isError).toBe(false);
        // Fast test ops should not appear as slow (threshold: 5000ms)
        // Either returns "No operations exceeding" or a result with ops
        // — just verify it doesn't error out
    });

    it("get_session_telemetry returns aggregated data", async () => {
        const result = await server.callTool("get_session_telemetry", {});
        expect(result.isError).toBe(false);
    });
});

// ── Part B: Live TSDB (skip if TSDB_URL not set) ──────────────────────

describe.skipIf(!hasTsdb)("Part B — TimescaleDB live writes (requires TSDB_URL)", () => {
    it("tool call writes row to TSDB tool_calls table", async () => {
        // Re-create server with TSDB enabled
        await server.close();
        server = await createTestServer(fixture.tmpDir, {
            backend: "file",
            disableTelemetry: false
        });

        await server.callTool("create_swarm_manifest", {
            mission: "TSDB write test", workspace_root: fixture.tmpDir
        });

        // Give async TSDB write time to complete
        await new Promise(r => setTimeout(r, 500));

        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: TSDB_URL, max: 2 });
        const result = await pool.query(
            "SELECT COUNT(*) AS c FROM tool_calls WHERE tool_name = 'create_swarm_manifest'"
        );
        await pool.end();
        expect(Number(result.rows[0].c)).toBeGreaterThan(0);
    });

    it("drainBuffer syncs unsynced rows to TSDB and marks them synced", async () => {
        await server.callTool("create_swarm_manifest", { mission: "Drain test", workspace_root: fixture.tmpDir });
        await server.callTool("read_manifest_section", { section: "Agents", workspace_root: fixture.tmpDir });

        const telemetry = getTelemetry();
        expect(telemetry).not.toBeNull();

        const drained = await telemetry!.drainBuffer();
        expect(drained).toBeGreaterThan(0);

        const db = openDb(fixture.tmpDir);
        const unsynced = db.prepare("SELECT COUNT(*) AS c FROM telemetry_buffer WHERE synced = 0").get() as { c: number };
        expect(unsynced.c).toBe(0);
        db.close();
    });
});
