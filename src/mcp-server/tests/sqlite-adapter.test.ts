/**
 * Integration tests for SqliteStorageAdapter.
 * Uses in-memory SQLite for speed and isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { SqliteStorageAdapter, closeAllDatabases } from "../src/storage/sqlite-adapter.js";
import type { AgentProgressData, SwarmInfo } from "../src/storage/adapter.js";

let adapter: SqliteStorageAdapter;
let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-adapter-test-"));
    adapter = new SqliteStorageAdapter();
});

afterEach(() => {
    closeAllDatabases();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Manifest CRUD ─────────────────────────────────────────────────────

describe("Manifest", () => {
    it("reads and writes manifest content", () => {
        const content = "# Test Manifest\n\n<!-- session: test-123 -->\n\n## Agents\n";
        adapter.writeManifest(tmpDir, content);
        const read = adapter.readManifest(tmpDir);
        expect(read).toBe(content);
    });

    it("falls back to file if DB is empty", () => {
        const content = "# From File\n<!-- session: file-fallback -->\n";
        fs.writeFileSync(path.join(tmpDir, "swarm-manifest.md"), content, "utf8");
        const read = adapter.readManifest(tmpDir);
        expect(read).toBe(content);
    });

    it("throws if no manifest found", () => {
        expect(() => adapter.readManifest(tmpDir)).toThrow("No manifest found");
    });

    it("withManifestLock provides serialized access", async () => {
        adapter.writeManifest(tmpDir, "original");
        const result = await adapter.withManifestLock(tmpDir, (md) => {
            expect(md).toBe("original");
            return { content: "modified", result: 42 };
        });
        expect(result).toBe(42);
        expect(adapter.readManifest(tmpDir)).toBe("modified");
    });

    it("withManifestLock does not write if content is null", async () => {
        adapter.writeManifest(tmpDir, "unchanged");
        await adapter.withManifestLock(tmpDir, () => ({ content: null, result: "skip" }));
        expect(adapter.readManifest(tmpDir)).toBe("unchanged");
    });
});

// ── Agent CRUD ────────────────────────────────────────────────────────

describe("Agents", () => {
    it("adds and lists agents", () => {
        adapter.addAgent(tmpDir, { id: "α", role: "architect", model: "claude", phase: "1", scope: "src/", status: "⏳ Pending" });
        adapter.addAgent(tmpDir, { id: "β", role: "developer", model: "gemini", phase: "2", scope: "tests/", status: "⏳ Pending" });

        const agents = adapter.listAgents(tmpDir);
        expect(agents).toHaveLength(2);
        expect(agents[0].id).toBe("α");
        expect(agents[1].id).toBe("β");
    });

    it("getAgent returns null for missing agent", () => {
        expect(adapter.getAgent(tmpDir, "nonexistent")).toBeNull();
    });

    it("getAgent returns the correct agent", () => {
        adapter.addAgent(tmpDir, { id: "α", role: "architect", model: "claude", phase: "1", scope: "src/", status: "⏳ Pending" });
        const agent = adapter.getAgent(tmpDir, "α");
        expect(agent).not.toBeNull();
        expect(agent!.role).toBe("architect");
    });

    it("prevents duplicate agents", () => {
        adapter.addAgent(tmpDir, { id: "α", role: "architect", model: "x", phase: "1", scope: "*", status: "⏳ Pending" });
        expect(() => adapter.addAgent(tmpDir, { id: "α", role: "dev", model: "y", phase: "2", scope: "*", status: "⏳ Pending" })).toThrow("already exists");
    });

    it("updates agent fields", () => {
        adapter.addAgent(tmpDir, { id: "α", role: "architect", model: "claude", phase: "1", scope: "src/", status: "⏳ Pending" });
        adapter.updateAgent(tmpDir, "α", { status: "✅ Complete", phase: "2" });
        const agent = adapter.getAgent(tmpDir, "α")!;
        expect(agent.status).toBe("✅ Complete");
        expect(agent.phase).toBe("2");
        expect(agent.role).toBe("architect"); // unchanged
    });

    it("throws on update for missing agent", () => {
        expect(() => adapter.updateAgent(tmpDir, "nonexistent", { status: "x" })).toThrow("not found");
    });

    it("removes an agent", () => {
        adapter.addAgent(tmpDir, { id: "α", role: "architect", model: "claude", phase: "1", scope: "src/", status: "⏳ Pending" });
        adapter.removeAgent(tmpDir, "α");
        expect(adapter.listAgents(tmpDir)).toHaveLength(0);
    });

    it("throws on remove for missing agent", () => {
        expect(() => adapter.removeAgent(tmpDir, "nonexistent")).toThrow("not found");
    });
});

// ── Agent Progress ────────────────────────────────────────────────────

describe("Agent Progress", () => {
    const makeProgress = (agentId: string, sessionId = "sess-1"): AgentProgressData => ({
        agent_id: agentId,
        role: "developer",
        phase: "1",
        status: "🔄 Active",
        detail: "working",
        session_id: sessionId,
        file_claims: [{ file: "src/foo.ts", status: "🔄 Active" }],
        issues: [{ severity: "🔴", area: "src/foo.ts", description: "Bug" }],
        handoff_notes: "test note",
        last_updated: new Date().toISOString()
    });

    it("writes and reads agent progress", () => {
        adapter.writeAgentProgress(tmpDir, makeProgress("α"));
        const read = adapter.readAgentProgress(tmpDir, "α");
        expect(read).not.toBeNull();
        expect(read!.agent_id).toBe("α");
        expect(read!.status).toBe("🔄 Active");
        expect(read!.file_claims).toHaveLength(1);
        expect(read!.file_claims[0].file).toBe("src/foo.ts");
        expect(read!.issues).toHaveLength(1);
        expect(read!.issues[0].severity).toBe("🔴");
    });

    it("returns null for missing progress", () => {
        expect(adapter.readAgentProgress(tmpDir, "nonexistent")).toBeNull();
    });

    it("updates existing progress (upsert)", () => {
        adapter.writeAgentProgress(tmpDir, makeProgress("α"));
        const updated = { ...makeProgress("α"), status: "✅ Complete", detail: "done" };
        adapter.writeAgentProgress(tmpDir, updated);

        const read = adapter.readAgentProgress(tmpDir, "α")!;
        expect(read.status).toBe("✅ Complete");
        expect(read.detail).toBe("done");
    });

    it("reads all progress filtered by session", () => {
        adapter.writeAgentProgress(tmpDir, makeProgress("α", "sess-1"));
        adapter.writeAgentProgress(tmpDir, makeProgress("β", "sess-1"));
        adapter.writeAgentProgress(tmpDir, makeProgress("γ", "sess-2"));

        const sess1 = adapter.readAllAgentProgress(tmpDir, "sess-1");
        expect(sess1).toHaveLength(2);
        const ids = sess1.map(p => p.agent_id).sort();
        expect(ids).toEqual(["α", "β"]);
    });

    it("cleanupAgentFiles removes all progress data", () => {
        adapter.writeAgentProgress(tmpDir, makeProgress("α"));
        adapter.writeAgentProgress(tmpDir, makeProgress("β"));
        const cleaned = adapter.cleanupAgentFiles(tmpDir);
        expect(cleaned).toBeGreaterThan(0);
        expect(adapter.readAllAgentProgress(tmpDir, "sess-1")).toHaveLength(0);
    });
});

// ── File Claims ──────────────────────────────────────────────────────

describe("File Claims", () => {
    it("claims a file successfully", () => {
        const ok = adapter.claimFile(tmpDir, "α", "src/foo.ts");
        expect(ok).toBe(true);
        const claims = adapter.checkFileClaim(tmpDir, "src/foo.ts");
        expect(claims).toHaveLength(1);
        expect(claims[0].agent_id).toBe("α");
    });

    it("rejects duplicate active claim by different agent", () => {
        adapter.claimFile(tmpDir, "α", "src/foo.ts");
        expect(() => adapter.claimFile(tmpDir, "β", "src/foo.ts")).toThrow("already claimed");
    });

    it("releases a file claim", () => {
        adapter.claimFile(tmpDir, "α", "src/foo.ts");
        adapter.releaseFileClaim(tmpDir, "α", "src/foo.ts", "✅ Done");
        const claims = adapter.checkFileClaim(tmpDir, "src/foo.ts");
        expect(claims[0].status).toBe("✅ Done");
    });

    it("throws on release for non-existent claim", () => {
        expect(() => adapter.releaseFileClaim(tmpDir, "α", "no-file.ts", "✅ Done")).toThrow("not found");
    });

    it("releases all claims for an agent", () => {
        adapter.claimFile(tmpDir, "α", "src/a.ts");
        adapter.claimFile(tmpDir, "α", "src/b.ts");
        const released = adapter.releaseAllClaims(tmpDir, "α");
        expect(released).toHaveLength(2);
        expect(released).toContain("src/a.ts");
        expect(released).toContain("src/b.ts");
    });
});

// ── Issues ────────────────────────────────────────────────────────────

describe("Issues", () => {
    it("adds and lists issues", () => {
        adapter.addIssue(tmpDir, { severity: "🔴", area: "src/foo.ts", description: "Bug", reporter: "α" });
        const issues = adapter.listIssues(tmpDir);
        expect(issues).toHaveLength(1);
        expect(issues[0].description).toBe("Bug");
    });

    it("deduplicates agent issues from progress", () => {
        adapter.addIssue(tmpDir, { severity: "🔴", area: "src/foo.ts", description: "Bug", reporter: "α" });
        adapter.writeAgentProgress(tmpDir, {
            agent_id: "α", role: "dev", phase: "1", status: "Active", detail: "",
            session_id: "s", file_claims: [],
            issues: [{ severity: "🔴", area: "src/foo.ts", description: "Bug" }],
            handoff_notes: "", last_updated: new Date().toISOString()
        });
        const issues = adapter.listIssues(tmpDir);
        expect(issues).toHaveLength(1); // deduped
    });
});

// ── Phase Gates ──────────────────────────────────────────────────────

describe("Phase Gates", () => {
    it("sets and gets phase gates", () => {
        adapter.setPhaseGate(tmpDir, "Phase 1", false);
        adapter.setPhaseGate(tmpDir, "Phase 2", false);

        let gates = adapter.getPhaseGates(tmpDir);
        expect(gates).toHaveLength(2);
        expect(gates[0].complete).toBe(false);

        adapter.setPhaseGate(tmpDir, "Phase 1", true);
        gates = adapter.getPhaseGates(tmpDir);
        expect(gates.find(g => g.phase === "Phase 1")!.complete).toBe(true);
    });
});

// ── Events ────────────────────────────────────────────────────────────

describe("Events", () => {
    it("broadcasts and retrieves events", async () => {
        await adapter.broadcastEvent({
            timestamp: new Date().toISOString(),
            agent_id: "α",
            event_type: "build_broken",
            message: "Build failed",
            workspace: tmpDir,
            session_id: "sess-1"
        });
        const events = adapter.getEvents(tmpDir, "sess-1");
        expect(events).toHaveLength(1);
        expect(events[0].event_type).toBe("build_broken");
    });

    it("filters events by type", async () => {
        await adapter.broadcastEvent({
            timestamp: new Date().toISOString(), agent_id: "α", event_type: "info",
            message: "Info msg", workspace: tmpDir, session_id: "sess-1"
        });
        await adapter.broadcastEvent({
            timestamp: new Date().toISOString(), agent_id: "α", event_type: "build_broken",
            message: "Build msg", workspace: tmpDir, session_id: "sess-1"
        });
        const infos = adapter.getEvents(tmpDir, "sess-1", "info");
        expect(infos).toHaveLength(1);
        expect(infos[0].message).toBe("Info msg");
    });

    it("cleans up events by session", async () => {
        await adapter.broadcastEvent({
            timestamp: new Date().toISOString(), agent_id: "α", event_type: "info",
            message: "msg", workspace: tmpDir, session_id: "sess-1"
        });
        adapter.cleanupEvents(tmpDir, "sess-1");
        expect(adapter.getEvents(tmpDir, "sess-1")).toHaveLength(0);
    });
});

// ── Swarm Registry ───────────────────────────────────────────────────

describe("Swarm Registry", () => {
    const makeSwarm = (workspace: string): SwarmInfo => ({
        workspace,
        session_id: "sess-1",
        mission: "Test mission",
        phase: "1",
        agents_active: 2,
        agents_total: 3,
        supervision: "Full",
        started_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        status: "active"
    });

    it("registers and lists active swarms", async () => {
        await adapter.registerSwarm(makeSwarm(tmpDir));
        const swarms = adapter.listActiveSwarms();
        expect(swarms.some(s => s.workspace === tmpDir)).toBe(true);
    });

    it("updates swarm registry fields", async () => {
        await adapter.registerSwarm(makeSwarm(tmpDir));
        await adapter.updateSwarmRegistry(tmpDir, { phase: "2", agents_active: 1 });
        const swarms = adapter.listActiveSwarms();
        const swarm = swarms.find(s => s.workspace === tmpDir)!;
        expect(swarm.phase).toBe("2");
        expect(swarm.agents_active).toBe(1);
    });

    it("deregisters a swarm", async () => {
        await adapter.registerSwarm(makeSwarm(tmpDir));
        await adapter.deregisterSwarm(tmpDir);
        const swarms = adapter.listActiveSwarms();
        expect(swarms.some(s => s.workspace === tmpDir)).toBe(false);
    });
});

// ── Session ──────────────────────────────────────────────────────────

describe("Session", () => {
    it("extracts session ID from manifest", () => {
        const md = "# Manifest\n<!-- session: test-2026-01-01T00-00-00 -->\n";
        expect(adapter.extractSessionId(md)).toBe("test-2026-01-01T00-00-00");
    });

    it("returns empty string for missing session", () => {
        expect(adapter.extractSessionId("# No session here")).toBe("");
    });

    it("generates valid session ID", () => {
        const id = adapter.generateSessionId();
        expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    });
});
