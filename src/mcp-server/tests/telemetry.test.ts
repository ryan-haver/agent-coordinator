/**
 * Tests for the telemetry layer:
 * - TelemetryClient: record(), queryLocal(), drainBuffer() (mocked TSDB)
 * - summarizeArgs(): sanitization and truncation
 * - Schema v2 migration: telemetry_buffer table creation
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TelemetryClient, summarizeArgs, resetTelemetry } from "../src/telemetry/client.js";
import Database from "better-sqlite3";
import { applyWorkspaceMigrations } from "../src/storage/migrations.js";

let tmpDir: string;
let client: TelemetryClient;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-test-"));
    // No TSDB_URL set — TSDB path will be skipped entirely
    delete process.env.TSDB_URL;
    process.env.TELEMETRY_ENABLED = "true";
    client = new TelemetryClient(tmpDir, "test-session");
});

afterEach(() => {
    client.close();
    resetTelemetry();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── summarizeArgs ─────────────────────────────────────────────────────

describe("summarizeArgs", () => {
    it("passes through normal args", () => {
        const result = summarizeArgs({ agent_id: "α", phase: "1" });
        expect(result).toContain("agent_id");
        expect(result).toContain("α");
    });

    it("redacts sensitive keys", () => {
        const result = summarizeArgs({
            agent_id: "α",
            token: "secret-value",
            password: "hunter2",
            API_KEY: "should-not-redact-uppercase" // only lowercase match
        });
        expect(result).toContain("[REDACTED]");
        expect(result).not.toContain("secret-value");
        expect(result).not.toContain("hunter2");
        // Case-insensitive redaction
        const resultLower = summarizeArgs({ apikey: "abc123" });
        expect(resultLower).toContain("[REDACTED]");
    });

    it("truncates to 200 chars", () => {
        const longValue = "x".repeat(500);
        const result = summarizeArgs({ data: longValue });
        expect(result.length).toBeLessThanOrEqual(203); // 200 + "..."
        expect(result.slice(-3)).toBe("...");
    });

    it("handles empty args", () => {
        const result = summarizeArgs({});
        expect(result).toBe("{}");
    });
});

// ── SQLite buffer: record + queryLocal ───────────────────────────────

describe("TelemetryClient.record", () => {
    it("writes to telemetry_buffer synchronously", () => {
        client.record({ tool_name: "update_agent_status", agent_id: "α", duration_ms: 15, success: true });
        const rows = client.queryLocal("SELECT * FROM telemetry_buffer");
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).tool_name).toBe("update_agent_status");
        expect((rows[0] as any).success).toBe(1);
        expect((rows[0] as any).synced).toBe(0);
    });

    it("records failures with error_msg", () => {
        client.record({ tool_name: "claim_file", agent_id: "β", duration_ms: 42, success: false, error_msg: "File already claimed" });
        const rows = client.queryLocal("SELECT * FROM telemetry_buffer");
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).success).toBe(0);
        expect((rows[0] as any).error_msg).toBe("File already claimed");
    });

    it("records multiple events", () => {
        client.record({ tool_name: "get_my_assignment", duration_ms: 5, success: true });
        client.record({ tool_name: "update_agent_status", duration_ms: 12, success: true });
        client.record({ tool_name: "broadcast_event", duration_ms: 8, success: false });
        const rows = client.queryLocal("SELECT * FROM telemetry_buffer ORDER BY id");
        expect(rows).toHaveLength(3);
    });

    it("no-ops when TELEMETRY_ENABLED=false", () => {
        process.env.TELEMETRY_ENABLED = "false";
        const disabledClient = new TelemetryClient(tmpDir + "-disabled", "sess");
        fs.mkdirSync(tmpDir + "-disabled/.swarm", { recursive: true });
        // Should not throw
        disabledClient.record({ tool_name: "claim_file", duration_ms: 5, success: true });
        // No rows since telemetry disabled
        const rows = disabledClient.queryLocal("SELECT * FROM telemetry_buffer");
        expect(rows).toHaveLength(0);
    });
});

// ── queryLocal ────────────────────────────────────────────────────────

describe("TelemetryClient.queryLocal", () => {
    beforeEach(() => {
        client.record({ tool_name: "update_agent_status", agent_id: "α", session_id: "s1", duration_ms: 10, success: true });
        client.record({ tool_name: "claim_file", agent_id: "β", session_id: "s1", duration_ms: 3000, success: true });
        client.record({ tool_name: "broadcast_event", agent_id: "α", session_id: "s2", duration_ms: 20, success: false });
    });

    it("filters by agent_id", () => {
        const rows = client.queryLocal("SELECT * FROM telemetry_buffer WHERE agent_id = ?", ["α"]);
        expect(rows).toHaveLength(2);
    });

    it("filters by session_id", () => {
        const rows = client.queryLocal("SELECT * FROM telemetry_buffer WHERE session_id = ?", ["s1"]);
        expect(rows).toHaveLength(2);
    });

    it("finds slow operations above threshold", () => {
        const rows = client.queryLocal("SELECT * FROM telemetry_buffer WHERE duration_ms >= ?", [2000]);
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).tool_name).toBe("claim_file");
    });

    it("aggregates per agent", () => {
        const rows = client.queryLocal(
            "SELECT agent_id, COUNT(*) AS total FROM telemetry_buffer GROUP BY agent_id ORDER BY total DESC"
        );
        expect(rows).toHaveLength(2);
        expect((rows[0] as any).agent_id).toBe("α");
        expect((rows[0] as any).total).toBe(2);
    });

    it("returns empty array on bad SQL", () => {
        const rows = client.queryLocal("SELECT * FROM nonexistent_table");
        expect(rows).toEqual([]);
    });
});

// ── drainBuffer (mocked TSDB) ─────────────────────────────────────────

describe("TelemetryClient.drainBuffer", () => {
    it("marks rows as synced after drain (mock pool)", async () => {
        client.record({ tool_name: "update_agent_status", duration_ms: 10, success: true });
        client.record({ tool_name: "claim_file", duration_ms: 20, success: true });

        // Verify rows exist as unsynced
        const before = client.queryLocal("SELECT * FROM telemetry_buffer WHERE synced = 0");
        expect(before).toHaveLength(2);

        // Mock the pool on the client by patching pool property using TS casting
        const mockClient = {
            query: vi.fn().mockResolvedValue({}),
            release: vi.fn()
        };
        const mockPool = {
            connect: vi.fn().mockResolvedValue(mockClient),
            end: vi.fn().mockResolvedValue(undefined)
        };
        (client as any).pool = mockPool;
        (client as any).connected = true;

        const drained = await client.drainBuffer();
        expect(drained).toBe(2);

        // Rows should be marked synced
        const after = client.queryLocal("SELECT * FROM telemetry_buffer WHERE synced = 0");
        expect(after).toHaveLength(0);
        const synced = client.queryLocal("SELECT * FROM telemetry_buffer WHERE synced = 1");
        expect(synced).toHaveLength(2);
    });

    it("returns 0 when buffer is empty", async () => {
        (client as any).pool = { connect: vi.fn(), end: vi.fn() };
        (client as any).connected = true;
        const count = await client.drainBuffer();
        expect(count).toBe(0);
    });

    it("TTL cleanup removes old synced rows after drain", async () => {
        // Insert a recent row normally
        client.record({ tool_name: "get_my_assignment", duration_ms: 5, success: true });

        // Manually insert an old already-synced row (simulate pre-existing synced data)
        client.queryLocal(
            "INSERT INTO telemetry_buffer (ts, tool_name, duration_ms, success, synced) VALUES (datetime('now', '-48 hours'), 'old_tool', 1, 1, 1)"
        );

        const mockClient = {
            query: vi.fn().mockResolvedValue({}),
            release: vi.fn()
        };
        const mockPool = {
            connect: vi.fn().mockResolvedValue(mockClient),
            end: vi.fn().mockResolvedValue(undefined)
        };
        (client as any).pool = mockPool;
        (client as any).connected = true;

        // Set TTL to 24h
        process.env.TELEMETRY_BUFFER_TTL_HOURS = "24";
        await client.drainBuffer();
        delete process.env.TELEMETRY_BUFFER_TTL_HOURS;

        // Old row (48h ago) should be gone
        const old = client.queryLocal("SELECT * FROM telemetry_buffer WHERE tool_name = 'old_tool'");
        expect(old).toHaveLength(0);

        // Recent row (just drained) should still be present (it's < 24h old)
        const recent = client.queryLocal("SELECT * FROM telemetry_buffer WHERE synced = 1 AND tool_name = 'get_my_assignment'");
        expect(recent).toHaveLength(1);
    });
});

// ── Schema v2 migration ───────────────────────────────────────────────

describe("Schema v2 migration", () => {
    it("creates telemetry_buffer on fresh DB", () => {
        const dbPath = path.join(tmpDir, ".swarm", "test-migration.db");
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);
        applyWorkspaceMigrations(db);

        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='telemetry_buffer'"
        ).all();
        expect(tables).toHaveLength(1);
        db.close();
    });

    it("upgrades v1 DB to v2 without losing data", () => {
        const dbPath = path.join(tmpDir, ".swarm", "test-v1-upgrade.db");
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);

        // Simulate v1 DB
        db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run();
        db.exec("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, role TEXT NOT NULL)");
        db.prepare("INSERT INTO agents (id, role) VALUES ('α', 'architect')").run();

        // Apply migrations (should add v2 tables)
        applyWorkspaceMigrations(db);

        // telemetry_buffer should now exist
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='telemetry_buffer'"
        ).all();
        expect(tables).toHaveLength(1);

        // Original data should still be there
        const agents = db.prepare("SELECT * FROM agents").all();
        expect(agents).toHaveLength(1);

        db.close();
    });
});
