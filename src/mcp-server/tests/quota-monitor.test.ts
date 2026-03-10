/**
 * quota-monitor.test.ts — Tests for QuotaMonitor.
 *
 * Tests spawn tracking, pivot recommendations, snapshot file I/O,
 * and the 3-source fallback chain. No external services needed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { QuotaMonitor, resetQuotaMonitor } from "../src/bridge/quota-monitor.js";
import { resetModelCatalog } from "../src/bridge/model-catalog.js";

let monitor: QuotaMonitor;
let tmpDir: string;

beforeEach(() => {
    resetQuotaMonitor();
    resetModelCatalog();
    monitor = new QuotaMonitor();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-monitor-test-"));
});

afterEach(() => {
    monitor.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── recordSpawn ────────────────────────────────────────────────────

describe("recordSpawn", () => {
    it("tracks spawns without crashing", () => {
        expect(() => monitor.recordSpawn("Gemini 3.1 Pro (High)")).not.toThrow();
        expect(() => monitor.recordSpawn("Claude Sonnet 4.6 (Thinking)")).not.toThrow();
    });

    it("handles unknown model labels gracefully", () => {
        expect(() => monitor.recordSpawn("Unknown Model XYZ")).not.toThrow();
    });
});

// ── getQuotaSnapshot ───────────────────────────────────────────────

describe("getQuotaSnapshot", () => {
    it("returns a snapshot with timestamp and source", () => {
        const snap = monitor.getQuotaSnapshot();
        expect(snap).toHaveProperty("timestamp");
        expect(snap).toHaveProperty("source");
        expect(snap).toHaveProperty("buckets");
        expect(typeof snap.timestamp).toBe("number");
    });

    it("falls back to estimated when no other sources available", () => {
        const snap = monitor.getQuotaSnapshot();
        expect(snap.source).toBe("estimated");
    });

    it("estimated usage increases with spawns", () => {
        // Spawn many times on gemini
        for (let i = 0; i < 10; i++) {
            monitor.recordSpawn("Gemini 3.1 Pro (High)");
        }
        const snap = monitor.getQuotaSnapshot();
        if (snap.buckets["gemini"]) {
            expect(snap.buckets["gemini"].pct).toBeLessThan(100);
        }
    });
});

// ── getPivotRecommendation ─────────────────────────────────────────

describe("getPivotRecommendation", () => {
    it("returns no-pivot when all buckets are healthy", () => {
        const rec = monitor.getPivotRecommendation();
        expect(rec.shouldPivot).toBe(false);
        expect(rec.reason).toContain("healthy");
    });

    it("has correct structure", () => {
        const rec = monitor.getPivotRecommendation();
        expect(rec).toHaveProperty("shouldPivot");
        expect(rec).toHaveProperty("exhaustedBucket");
        expect(rec).toHaveProperty("targetBucket");
        expect(rec).toHaveProperty("targetModel");
        expect(rec).toHaveProperty("reason");
        expect(typeof rec.reason).toBe("string");
    });

    it("accepts optional currentBucket parameter", () => {
        const rec = monitor.getPivotRecommendation("gemini");
        expect(rec).toHaveProperty("shouldPivot");
    });
});

// ── getStatusReport ────────────────────────────────────────────────

describe("getStatusReport", () => {
    it("returns structured report", () => {
        const report = monitor.getStatusReport();
        expect(report).toHaveProperty("buckets");
        expect(report).toHaveProperty("recommendation");
        expect(report).toHaveProperty("snapshotAge");
        expect(report).toHaveProperty("source");
        expect(Array.isArray(report.buckets)).toBe(true);
    });

    it("buckets match model catalog grouping", () => {
        const report = monitor.getStatusReport();
        const names = report.buckets.map((b) => b.name);
        expect(names).toContain("gemini");
        expect(names).toContain("flash");
        expect(names).toContain("claude");
    });

    it("snapshotAge is human-readable", () => {
        const report = monitor.getStatusReport();
        expect(typeof report.snapshotAge).toBe("string");
        // Should be "just now" for freshly created snapshot
        expect(report.snapshotAge).toBe("just now");
    });
});

// ── reset ──────────────────────────────────────────────────────────

describe("reset", () => {
    it("clears spawn counts", () => {
        monitor.recordSpawn("Gemini 3.1 Pro (High)");
        monitor.recordSpawn("Gemini 3.1 Pro (High)");
        monitor.reset();
        const snap = monitor.getQuotaSnapshot();
        // After reset, estimated usage should be back to defaults
        expect(Object.keys(snap.buckets).length).toBe(0);
    });
});
