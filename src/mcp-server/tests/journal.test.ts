/**
 * journal.test.ts — Tests for journal_write, journal_read, journal_promote, journal_search handlers.
 *
 * Uses in-memory SQLite with the journal_entries schema applied.
 * Does NOT test Qdrant (semantic search) — tests SQLite fallback path only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";

// Fresh DB for each test — created in beforeEach and swapped via closure
let currentDb: Database.Database;
let tmpDir: string;

vi.mock("../src/storage/singleton.js", () => ({
    getStorage: () => ({
        getDb: () => currentDb,
        extractSessionId: () => "test-session-001",
        readManifest: () => "# Mock\n<!-- session: test-session-001 -->",
    }),
}));

vi.mock("../src/memory/client.js", () => ({
    getMemory: () => null, // No Qdrant available
}));

vi.mock("../src/handlers/context.js", () => ({
    resolveWorkspaceRoot: () => "/mock/workspace",
}));

import {
    handleJournalWrite,
    handleJournalRead,
    handleJournalPromote,
    handleJournalSearch,
} from "../src/handlers/journal.js";

// ── Setup / Teardown ──────────────────────────────────────────────

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
    currentDb = new Database(":memory:");
    // Apply journal schema
    currentDb.exec(`
        CREATE TABLE IF NOT EXISTS journal_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id    TEXT NOT NULL,
            role        TEXT NOT NULL,
            entry_type  TEXT NOT NULL,
            visibility  TEXT NOT NULL DEFAULT 'personal',
            context     TEXT NOT NULL DEFAULT '',
            content     TEXT NOT NULL,
            tags        TEXT NOT NULL DEFAULT '',
            session_id  TEXT NOT NULL DEFAULT '',
            workspace   TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
});

afterEach(() => {
    try { currentDb?.close(); } catch { /* non-fatal */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── journal_write ─────────────────────────────────────────────────

describe("journal_write", () => {
    it("writes a valid journal entry", async () => {
        const result = await handleJournalWrite({
            entry_type: "decision",
            content: "Chose SQLite over Postgres for local storage",
            context: "storage-layer design",
            tags: "architecture,storage",
            agent_id: "alpha",
            role: "architect",
        });

        expect(result.content[0].text).toContain("✅");
        expect(result.content[0].text).toContain("decision");
        expect(result.content[0].text).toContain("journal_promote");
    });

    it("throws on missing content", async () => {
        await expect(
            handleJournalWrite({ entry_type: "decision" })
        ).rejects.toThrow("Missing required argument: content");
    });

    it("throws on invalid entry_type", async () => {
        await expect(
            handleJournalWrite({ entry_type: "invalid_type", content: "test" })
        ).rejects.toThrow("Invalid entry_type");
    });

    it("accepts all valid entry types", async () => {
        const types = ["decision", "dead_end", "discovery", "assumption", "question", "idea", "blocker"];
        for (const t of types) {
            const result = await handleJournalWrite({
                entry_type: t,
                content: `Test ${t} entry`,
                agent_id: "alpha",
            });
            expect(result.content[0].text).toContain("✅");
        }
    });

    it("defaults agent_id and role to unknown", async () => {
        const result = await handleJournalWrite({
            entry_type: "idea",
            content: "No agent specified",
        });
        expect(result.content[0].text).toContain("✅");
    });
});

// ── journal_read ──────────────────────────────────────────────────

describe("journal_read", () => {
    beforeEach(async () => {
        // Seed some entries
        await handleJournalWrite({ entry_type: "decision", content: "Entry 1", agent_id: "alpha", role: "architect" });
        await handleJournalWrite({ entry_type: "discovery", content: "Entry 2", agent_id: "beta", role: "developer" });
        await handleJournalWrite({ entry_type: "blocker", content: "Entry 3", agent_id: "alpha", role: "architect" });
    });

    it("reads all entries with scope=all", async () => {
        const result = await handleJournalRead({ scope: "all" });
        expect(result.content[0].text).toContain("3 journal entries");
    });

    it("filters by agent_id with scope=personal", async () => {
        const result = await handleJournalRead({ scope: "personal", agent_id: "alpha" });
        expect(result.content[0].text).toContain("2 journal entries");
    });

    it("filters by role with scope=role", async () => {
        const result = await handleJournalRead({ scope: "role", role: "developer" });
        expect(result.content[0].text).toContain("1 journal entries");
    });

    it("filters by entry_type", async () => {
        const result = await handleJournalRead({ scope: "all", entry_type: "decision" });
        expect(result.content[0].text).toContain("1 journal entries");
    });

    it("respects limit parameter", async () => {
        const result = await handleJournalRead({ scope: "all", limit: 1 });
        expect(result.content[0].text).toContain("1 journal entries");
    });

    it("returns empty message when no entries found", async () => {
        const result = await handleJournalRead({ scope: "personal", agent_id: "nonexistent" });
        expect(result.content[0].text).toContain("No journal entries found");
    });

    it("throws on invalid entry_type filter", async () => {
        await expect(
            handleJournalRead({ scope: "all", entry_type: "bad_type" })
        ).rejects.toThrow("Invalid entry_type filter");
    });
});

// ── journal_promote ───────────────────────────────────────────────

describe("journal_promote", () => {
    it("promotes a personal entry to shared", async () => {
        const writeResult = await handleJournalWrite({
            entry_type: "discovery",
            content: "Key finding about API structure",
            agent_id: "alpha",
        });
        const id = parseInt(writeResult.content[0].text.match(/#(\d+)/)?.[1] ?? "0");
        expect(id).toBeGreaterThan(0);

        const result = await handleJournalPromote({ entry_id: id, reason: "Useful for all agents" });
        expect(result.content[0].text).toContain("✅");
        expect(result.content[0].text).toContain("promoted");
        expect(result.content[0].text).toContain("Qdrant unavailable");
    });

    it("no-ops when entry already promoted", async () => {
        await handleJournalWrite({ entry_type: "idea", content: "Some idea", agent_id: "alpha" });
        const result1 = await handleJournalPromote({ entry_id: 1 });
        expect(result1.content[0].text).toContain("✅");

        const result2 = await handleJournalPromote({ entry_id: 1 });
        expect(result2.content[0].text).toContain("already promoted");
    });

    it("throws on missing entry_id", async () => {
        await expect(handleJournalPromote({})).rejects.toThrow("Missing required argument: entry_id");
    });

    it("throws on nonexistent entry", async () => {
        await expect(handleJournalPromote({ entry_id: 9999 })).rejects.toThrow("not found");
    });
});

// ── journal_search ────────────────────────────────────────────────

describe("journal_search", () => {
    it("throws on missing query", async () => {
        await expect(handleJournalSearch({})).rejects.toThrow("Missing required argument: query");
    });

    it("returns empty when no promoted entries match", async () => {
        await handleJournalWrite({ entry_type: "decision", content: "No match here", agent_id: "alpha" });
        const result = await handleJournalSearch({ query: "kubernetes" });
        expect(result.content[0].text).toContain("No shared journal entries found");
    });

    it("finds promoted entries via SQL text search", async () => {
        await handleJournalWrite({ entry_type: "discovery", content: "SQLite schema design patterns", agent_id: "alpha" });
        await handleJournalPromote({ entry_id: 1 });

        const result = await handleJournalSearch({ query: "schema" });
        expect(result.content[0].text).toContain("schema");
        expect(result.content[0].text).toContain("text search fallback");
    });
});
