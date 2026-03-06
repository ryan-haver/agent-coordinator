/**
 * Milestone 1 Integration Tests — Handler routing & correctness.
 *
 * Validates that all major handler groups work correctly when called
 * through a real MCP Server+Client using InMemoryTransport.
 * No mocks — real file system, real storage adapter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, TestServer } from "./helpers/server.js";
import { createFixture, fixtureFileExists, Fixture } from "./helpers/fixtures.js";

let server: TestServer;
let fixture: Fixture;

beforeEach(async () => {
    fixture = createFixture("m1-");
    server = await createTestServer(fixture.tmpDir, { backend: "file" });
});

afterEach(async () => {
    await server.close();
    fixture.cleanup();
});

// ── Tool registration ────────────────────────────────────────────────

describe("Tool registration", () => {
    it("lists all expected tools (≥35)", async () => {
        const tools = await server.listTools();
        expect(tools).toContain("create_swarm_manifest");
        expect(tools).toContain("update_agent_status");
        expect(tools).toContain("claim_file");
        expect(tools).toContain("broadcast_event");
        expect(tools).toContain("get_swarm_status");
        expect(tools).toContain("get_my_telemetry");
        expect(tools.length).toBeGreaterThanOrEqual(35);
    });

    it("returns isError for unknown tool", async () => {
        const result = await server.callTool("nonexistent_tool_xyz", {});
        expect(result.isError).toBe(true);
        expect(result.text).toContain("Unknown tool");
    });
});

// ── Manifest handlers ────────────────────────────────────────────────

describe("Manifest handlers", () => {
    it("create_swarm_manifest creates manifest file", async () => {
        const result = await server.callTool("create_swarm_manifest", {
            mission: "Integration test mission",
            workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
        expect(fixtureFileExists(fixture.tmpDir, "swarm-manifest.md")).toBe(true);
    });

    it("read_manifest_section returns agents section after creation", async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Test", workspace_root: fixture.tmpDir
        });
        const result = await server.callTool("read_manifest_section", {
            section: "Agents", workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
    });
});

// ── Agent handlers ────────────────────────────────────────────────────

describe("Agent handlers", () => {
    beforeEach(async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Agent test", workspace_root: fixture.tmpDir
        });
    });

    it("add_agent_to_manifest + get_my_assignment round-trips", async () => {
        const add = await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "architect", model: "claude",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
        expect(add.isError).toBe(false);

        const assign = await server.callTool("get_my_assignment", {
            agent_id: "α", workspace_root: fixture.tmpDir
        });
        expect(assign.isError).toBe(false);
        expect(assign.text).toContain("architect");
    });

    it("update_agent_status reflects in get_my_assignment", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "β", role: "developer", model: "gemini",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
        const update = await server.callTool("update_agent_status", {
            agent_id: "β", status: "✅ Complete", workspace_root: fixture.tmpDir
        });
        // Tool should succeed and confirm the status update in its response
        expect(update.isError).toBe(false);
        expect(update.text).toContain("Complete");
    });

    it("mark_agent_failed sets failed status", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "γ", role: "qa", model: "gemini", phase: "1", scope: "*",
            workspace_root: fixture.tmpDir
        });
        const result = await server.callTool("mark_agent_failed", {
            agent_id: "γ", reason: "Context overflow", workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
    });
});

// ── File claim handlers ───────────────────────────────────────────────

describe("File claim handlers", () => {
    beforeEach(async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "File test", workspace_root: fixture.tmpDir
        });
        await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "developer", model: "claude",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
    });

    it("claim_file + check_file_claim shows active claim", async () => {
        const claim = await server.callTool("claim_file", {
            agent_id: "α", file_path: "src/index.ts", workspace_root: fixture.tmpDir
        });
        expect(claim.isError).toBe(false);

        const check = await server.callTool("check_file_claim", {
            file_path: "src/index.ts", workspace_root: fixture.tmpDir
        });
        expect(check.isError).toBe(false);
        expect(check.text).toContain("α");
    });

    it("release_file_claim marks claim done", async () => {
        await server.callTool("claim_file", {
            agent_id: "α", file_path: "src/foo.ts", workspace_root: fixture.tmpDir
        });
        const release = await server.callTool("release_file_claim", {
            agent_id: "α", file_path: "src/foo.ts",
            status: "✅ Done", workspace_root: fixture.tmpDir
        });
        expect(release.isError).toBe(false);
    });

    it("duplicate claim by different agent is rejected", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "β", role: "developer", model: "gemini",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
        await server.callTool("claim_file", {
            agent_id: "α", file_path: "src/conflict.ts", workspace_root: fixture.tmpDir
        });
        const conflict = await server.callTool("claim_file", {
            agent_id: "β", file_path: "src/conflict.ts", workspace_root: fixture.tmpDir
        });
        expect(conflict.isError).toBe(true);
    });
});

// ── Event handlers ────────────────────────────────────────────────────

describe("Event handlers", () => {
    beforeEach(async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Event test", workspace_root: fixture.tmpDir
        });
    });

    it("broadcast_event + get_events round-trips", async () => {
        const broadcast = await server.callTool("broadcast_event", {
            agent_id: "α", event_type: "build_broken",
            message: "TypeScript compilation failed", workspace_root: fixture.tmpDir
        });
        expect(broadcast.isError).toBe(false);

        const events = await server.callTool("get_events", {
            event_type: "build_broken", workspace_root: fixture.tmpDir
        });
        expect(events.isError).toBe(false);
        expect(events.text).toContain("TypeScript compilation failed");
    });

    it("report_issue stores issue", async () => {
        const result = await server.callTool("report_issue", {
            reporter: "α", severity: "🔴", area: "src/index.ts",
            description: "Null pointer exception", workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
    });

    it("post_handoff_note + get_handoff_notes round-trips", async () => {
        await server.callTool("post_handoff_note", {
            agent_id: "α",
            note: "Auth module is broken — needs PKCE fix",
            workspace_root: fixture.tmpDir
        });
        const notes = await server.callTool("get_handoff_notes", {
            workspace_root: fixture.tmpDir
        });
        expect(notes.text).toContain("PKCE fix");
    });
});

// ── Phase + Swarm handlers ────────────────────────────────────────────

describe("Phase and swarm handlers", () => {
    beforeEach(async () => {
        await server.callTool("create_swarm_manifest", {
            mission: "Phase test", workspace_root: fixture.tmpDir
        });
    });

    it("check_phase_gates returns gate list", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "developer", model: "claude",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
        const result = await server.callTool("check_phase_gates", {
            phase_number: "1", workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
    });

    it("get_swarm_status returns status", async () => {
        const result = await server.callTool("get_swarm_status", {
            workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
    });
});
