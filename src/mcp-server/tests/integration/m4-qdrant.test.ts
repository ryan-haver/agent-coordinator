/**
 * Milestone 4 Integration Tests — Qdrant Semantic Memory.
 *
 * Part A (always runs — no Qdrant required):
 *   Verifies graceful degradation: all 4 tools return informational text when
 *   QDRANT_URL is not set, with isError: false.
 *
 * Part B (skip if QDRANT_URL not set):
 *   Verifies live Qdrant: store, search, find_similar_code, auto-index on post_handoff_note.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, TestServer } from "./helpers/server.js";
import { createFixture, Fixture } from "./helpers/fixtures.js";

let server: TestServer;
let fixture: Fixture;

const QDRANT_URL = process.env.QDRANT_URL;
const hasQdrant = !!QDRANT_URL;

beforeEach(async () => {
    fixture = createFixture("m4-");
    server = await createTestServer(fixture.tmpDir, { backend: "file" });
    // Setup manifest for tests that need it
    await server.callTool("create_swarm_manifest", {
        mission: "M4 semantic memory test", workspace_root: fixture.tmpDir
    });
});

afterEach(async () => {
    await server.close();
    fixture.cleanup();
});

// ── Part A: Graceful degradation (always runs) ───────────────────────

describe("Part A — graceful no-op when QDRANT_URL not set", () => {
    it("store_memory returns informational text, isError: false", async () => {
        // Ensure QDRANT_URL is unset for this test suite
        const savedUrl = process.env.QDRANT_URL;
        delete process.env.QDRANT_URL;

        const result = await server.callTool("store_memory", {
            text: "The auth module uses PKCE flow with PKCE verifier stored in session",
            collection: "agent_notes"
        });
        expect(result.isError).toBe(false);
        // Should explain that Qdrant is not configured (not an error)
        expect(result.text).toContain("not configured");

        if (savedUrl) process.env.QDRANT_URL = savedUrl;
    });

    it("semantic_search returns informational text, isError: false", async () => {
        const savedUrl = process.env.QDRANT_URL;
        delete process.env.QDRANT_URL;

        const result = await server.callTool("semantic_search", {
            query: "authentication patterns"
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("not configured");

        if (savedUrl) process.env.QDRANT_URL = savedUrl;
    });

    it("find_similar_code returns informational text, isError: false", async () => {
        const savedUrl = process.env.QDRANT_URL;
        delete process.env.QDRANT_URL;

        const result = await server.callTool("find_similar_code", {
            query: "parse JWT token and extract claims"
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("not configured");

        if (savedUrl) process.env.QDRANT_URL = savedUrl;
    });

    it("find_past_solutions returns informational text, isError: false", async () => {
        const savedUrl = process.env.QDRANT_URL;
        delete process.env.QDRANT_URL;

        const result = await server.callTool("find_past_solutions", {
            query: "database connection timeout"
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("not configured");

        if (savedUrl) process.env.QDRANT_URL = savedUrl;
    });

    it("store_memory rejects unsupported collection with isError: true", async () => {
        const result = await server.callTool("store_memory", {
            text: "Some content",
            collection: "invalid_collection_xyz"
        });
        // Invalid collection should throw → router wraps as isError: true
        expect(result.isError).toBe(true);
    });

    it("store_memory without text throws, isError: true", async () => {
        const result = await server.callTool("store_memory", {});
        expect(result.isError).toBe(true);
    });

    it("semantic_search without query throws, isError: true", async () => {
        const result = await server.callTool("semantic_search", {});
        expect(result.isError).toBe(true);
    });
});

// ── Part B: Live Qdrant (skip if QDRANT_URL not set) ─────────────────

describe.skipIf(!hasQdrant)("Part B — live Qdrant (requires QDRANT_URL)", () => {
    it("store_memory upserts to Qdrant and returns success text", async () => {
        const result = await server.callTool("store_memory", {
            text: "The auth module uses PKCE flow with PKCE verifier stored in session storage",
            collection: "agent_notes",
            agent_id: "α",
            workspace_root: fixture.tmpDir
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("agent_notes");
    });

    it("semantic_search returns similar result after store", async () => {
        // Store first
        await server.callTool("store_memory", {
            text: "TimescaleDB stores telemetry with hypertables partitioned by time",
            collection: "project_docs",
            workspace_root: fixture.tmpDir
        });

        // Give Qdrant time to index
        await new Promise(r => setTimeout(r, 500));

        const result = await server.callTool("semantic_search", {
            query: "time series telemetry storage",
            collection: "project_docs",
            limit: 3
        });
        expect(result.isError).toBe(false);
        // Should find the stored content
        expect(result.text).not.toContain("No results found");
    });

    it("find_similar_code searches code_snippets collection", async () => {
        await server.callTool("store_memory", {
            text: "async function parseJwt(token: string): Promise<JwtPayload> { return jwt.verify(token, secret) as JwtPayload; }",
            collection: "code_snippets",
            file_path: "src/auth/jwt.ts",
            workspace_root: fixture.tmpDir
        });
        await new Promise(r => setTimeout(r, 500));

        const result = await server.callTool("find_similar_code", {
            query: "parse JWT token and verify signature",
            limit: 5
        });
        expect(result.isError).toBe(false);
    });

    it("post_handoff_note auto-indexes into agent_notes", async () => {
        await server.callTool("add_agent_to_manifest", {
            agent_id: "α", role: "developer", model: "claude",
            phase: "1", scope: "src/", workspace_root: fixture.tmpDir
        });
        const noteResult = await server.callTool("post_handoff_note", {
            agent_id: "α",
            note: "Switched auth from sessions to JWT. PKCE verifier now stored in Redis.",
            workspace_root: fixture.tmpDir
        });
        expect(noteResult.isError).toBe(false);

        // Give async indexing time to complete
        await new Promise(r => setTimeout(r, 1000));

        const searchResult = await server.callTool("semantic_search", {
            query: "PKCE authentication JWT",
            collection: "agent_notes"
        });
        expect(searchResult.isError).toBe(false);
        // Should find the auto-indexed note
        expect(searchResult.text).not.toContain("No results found");
    });
});
