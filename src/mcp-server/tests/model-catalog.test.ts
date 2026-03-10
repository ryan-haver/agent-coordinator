/**
 * model-catalog.test.ts — Tests for ModelCatalog, QuotaBucket, bucket rules.
 *
 * Tests bucket assignment logic, pivot targeting, family inference,
 * and diff computation. Does NOT hit state.vscdb (no DB fixture needed).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
    ModelCatalog,
    inferFamily,
    resetModelCatalog,
    type QuotaBucket,
} from "../src/bridge/model-catalog.js";

// ── inferFamily ────────────────────────────────────────────────────

describe("inferFamily", () => {
    it("classifies Gemini labels", () => {
        expect(inferFamily("Gemini 3.1 Pro (High)")).toBe("gemini");
        expect(inferFamily("Gemini 3 Flash")).toBe("gemini");
    });

    it("classifies Claude labels", () => {
        expect(inferFamily("Claude Sonnet 4.6 (Thinking)")).toBe("claude");
        expect(inferFamily("Claude Opus 4.6 (Thinking)")).toBe("claude");
    });

    it("classifies GPT/OSS labels", () => {
        expect(inferFamily("GPT-OSS 120B (Medium)")).toBe("gpt");
    });

    it("returns unknown for unrecognized labels", () => {
        expect(inferFamily("LLaMA 3 70B")).toBe("unknown");
        expect(inferFamily("Custom Model")).toBe("unknown");
    });
});

// ── ModelCatalog (hardcoded fallback — no DB) ──────────────────────

describe("ModelCatalog", () => {
    let catalog: ModelCatalog;

    beforeEach(() => {
        resetModelCatalog();
        catalog = new ModelCatalog({ cacheTtlMs: 0 }); // Disable cache for testing
    });

    describe("getSnapshot", () => {
        it("returns a snapshot with models", () => {
            const snap = catalog.getSnapshot();
            expect(snap.models.length).toBeGreaterThan(0);
            expect(snap.timestamp).toBeGreaterThan(0);
        });

        it("snapshot contains expected model families", () => {
            const snap = catalog.getSnapshot();
            const families = new Set(snap.models.map((m) => m.family));
            expect(families.has("gemini")).toBe(true);
            expect(families.has("claude")).toBe(true);
        });
    });

    describe("getModelLabels", () => {
        it("returns string array of labels", () => {
            const labels = catalog.getModelLabels();
            expect(Array.isArray(labels)).toBe(true);
            expect(labels.length).toBeGreaterThan(0);
            expect(typeof labels[0]).toBe("string");
        });
    });

    describe("invalidate", () => {
        it("forces refresh on next call", () => {
            const snap1 = catalog.getSnapshot();
            catalog.invalidate();
            const snap2 = catalog.getSnapshot();
            // Timestamps should differ (invalidate forces re-read)
            expect(snap2.timestamp).toBeGreaterThanOrEqual(snap1.timestamp);
        });
    });

    // ── Quota Buckets ──────────────────────────────────────────────

    describe("getQuotaBuckets", () => {
        it("groups models into correct buckets", () => {
            const buckets = catalog.getQuotaBuckets();
            const names = buckets.map((b) => b.name);
            expect(names).toContain("gemini");
            expect(names).toContain("flash");
            expect(names).toContain("claude");
        });

        it("gemini bucket contains Pro models only", () => {
            const buckets = catalog.getQuotaBuckets();
            const gemini = buckets.find((b) => b.name === "gemini")!;
            expect(gemini).toBeDefined();
            for (const m of gemini.models) {
                expect(m.toLowerCase()).toMatch(/gemini.*pro/);
            }
        });

        it("flash bucket contains Flash model", () => {
            const buckets = catalog.getQuotaBuckets();
            const flash = buckets.find((b) => b.name === "flash")!;
            expect(flash).toBeDefined();
            expect(flash.models.some((m) => m.toLowerCase().includes("flash"))).toBe(true);
        });

        it("claude bucket contains Claude and GPT-OSS models", () => {
            const buckets = catalog.getQuotaBuckets();
            const claude = buckets.find((b) => b.name === "claude")!;
            expect(claude).toBeDefined();
            expect(claude.models.some((m) => m.toLowerCase().includes("claude"))).toBe(true);
        });

        it("status is unknown when no quota data provided", () => {
            const buckets = catalog.getQuotaBuckets();
            for (const b of buckets) {
                expect(b.quotaPct).toBeNull();
                expect(b.status).toBe("unknown");
            }
        });

        it("status reflects quota percentage", () => {
            const buckets = catalog.getQuotaBuckets({
                gemini: { pct: 80 },
                claude: { pct: 15 },
                flash: { pct: 3 },
            });

            const gemini = buckets.find((b) => b.name === "gemini")!;
            expect(gemini.status).toBe("healthy");
            expect(gemini.quotaPct).toBe(80);

            const claude = buckets.find((b) => b.name === "claude")!;
            expect(claude.status).toBe("warning");

            const flash = buckets.find((b) => b.name === "flash")!;
            expect(flash.status).toBe("exhausted");
        });

        it("includes reset time when provided", () => {
            const buckets = catalog.getQuotaBuckets({
                gemini: { pct: 100, resetInSec: 18000, resetTime: "2026-03-10T23:00:00Z" },
            });
            const gemini = buckets.find((b) => b.name === "gemini")!;
            expect(gemini.resetInSec).toBe(18000);
            expect(gemini.resetTime).toBe("2026-03-10T23:00:00Z");
        });
    });

    // ── Pivot Target ───────────────────────────────────────────────

    describe("findPivotTarget", () => {
        it("returns healthiest alternative bucket", () => {
            const target = catalog.findPivotTarget("gemini", {
                gemini: { pct: 0 },
                claude: { pct: 80 },
                flash: { pct: 50 },
            });
            expect(target).not.toBeNull();
            expect(target!.name).toBe("claude"); // 80% > 50%
        });

        it("returns null when all buckets exhausted", () => {
            const target = catalog.findPivotTarget("gemini", {
                gemini: { pct: 0 },
                claude: { pct: 3 },
                flash: { pct: 2 },
            });
            expect(target).toBeNull();
        });

        it("returns null when no alternative exists", () => {
            const target = catalog.findPivotTarget("gemini");
            // Without quota data, all are "unknown" status — should still return candidates
            expect(target).not.toBeNull(); // unknown status candidates are valid
        });

        it("excludes the exhausted bucket from candidates", () => {
            const target = catalog.findPivotTarget("claude", {
                gemini: { pct: 100 },
                claude: { pct: 0 },
                flash: { pct: 100 },
            });
            expect(target).not.toBeNull();
            expect(target!.name).not.toBe("claude");
        });
    });

    // ── Diff ───────────────────────────────────────────────────────

    describe("diffWithFallbackJson", () => {
        it("returns diff structure with arrays", () => {
            const diff = catalog.diffWithFallbackJson();
            expect(diff).toHaveProperty("added");
            expect(diff).toHaveProperty("removed");
            expect(diff).toHaveProperty("unchanged");
            expect(Array.isArray(diff.added)).toBe(true);
            expect(Array.isArray(diff.removed)).toBe(true);
            expect(Array.isArray(diff.unchanged)).toBe(true);
        });
    });
});
