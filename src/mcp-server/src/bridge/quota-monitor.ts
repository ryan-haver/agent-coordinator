/**
 * QuotaMonitor — tracks per-bucket quota usage and triggers pivot recommendations.
 *
 * Data sources (in priority order):
 *   1. state.vscdb modelCredits key (when Antigravity populates it)
 *   2. quota_snapshot.json (written by external scripts or this monitor)
 *   3. Estimated usage from spawn counts (last resort)
 *
 * Quota buckets match the Antigravity Quota Monitor UI:
 *   - "gemini" → Gemini 3.1 Pro (High), Gemini 3.1 Pro (Low)
 *   - "claude" → Claude Sonnet/Opus 4.6, GPT-OSS 120B
 *   - "flash"  → Gemini 3 Flash (appears unbucketed)
 */
import fs from "fs";
import path from "path";
import { getModelCatalog, readModelCredits, type QuotaBucket } from "./model-catalog.js";
import { getGlobalConfigPath } from "../handlers/context.js";

// ── Types ──────────────────────────────────────────────────────────

export interface QuotaSnapshot {
    /** Per-bucket quota data */
    buckets: Record<string, BucketQuota>;
    /** When this snapshot was captured */
    timestamp: number;
    /** Source of this snapshot */
    source: "state_db" | "snapshot_file" | "estimated";
}

export interface BucketQuota {
    /** Percentage remaining (0-100) */
    pct: number;
    /** Seconds until reset (if known) */
    resetInSec?: number;
    /** ISO timestamp of next reset (if known) */
    resetTime?: string;
}

export interface PivotRecommendation {
    /** Should a pivot happen right now? */
    shouldPivot: boolean;
    /** The bucket that triggered the pivot */
    exhaustedBucket: string | null;
    /** The recommended target bucket */
    targetBucket: QuotaBucket | null;
    /** First model in the target bucket (use for model switch) */
    targetModel: string | null;
    /** Human reason string */
    reason: string;
}

// ── Thresholds ─────────────────────────────────────────────────────

const EXHAUSTED_THRESHOLD_PCT = 5;
const WARNING_THRESHOLD_PCT = 20;
const REFRESHED_THRESHOLD_PCT = 30;

// ── QuotaMonitor Class ─────────────────────────────────────────────

export class QuotaMonitor {
    private lastSnapshot: QuotaSnapshot | null = null;
    private spawnCounts: Map<string, number> = new Map();

    /**
     * Get the current quota snapshot from all available sources.
     */
    getQuotaSnapshot(): QuotaSnapshot {
        // 1. Try live state DB credits
        const liveCredits = this.readFromStateDb();
        if (liveCredits) {
            this.lastSnapshot = liveCredits;
            this.writeSnapshotFile(liveCredits);
            return liveCredits;
        }

        // 2. Try quota_snapshot.json
        const fromFile = this.readFromSnapshotFile();
        if (fromFile) {
            this.lastSnapshot = fromFile;
            return fromFile;
        }

        // 3. Estimate from spawn counts
        const estimated = this.estimateFromSpawns();
        this.lastSnapshot = estimated;
        return estimated;
    }

    /**
     * Record a model spawn to track estimated usage.
     */
    recordSpawn(modelLabel: string): void {
        const catalog = getModelCatalog();
        const buckets = catalog.getQuotaBuckets();
        const bucket = buckets.find((b) => b.models.includes(modelLabel));
        if (bucket) {
            const current = this.spawnCounts.get(bucket.name) ?? 0;
            this.spawnCounts.set(bucket.name, current + 1);
        }
    }

    /**
     * Get a pivot recommendation based on current quota state.
     */
    getPivotRecommendation(currentBucket?: string): PivotRecommendation {
        const snapshot = this.getQuotaSnapshot();
        const catalog = getModelCatalog();

        // Find exhausted buckets
        const exhausted = Object.entries(snapshot.buckets)
            .filter(([, q]) => q.pct <= EXHAUSTED_THRESHOLD_PCT)
            .map(([name]) => name);

        if (exhausted.length === 0) {
            // Check for warnings
            const warnings = Object.entries(snapshot.buckets)
                .filter(([, q]) => q.pct <= WARNING_THRESHOLD_PCT && q.pct > EXHAUSTED_THRESHOLD_PCT);

            if (warnings.length > 0) {
                const [warnName, warnData] = warnings[0];
                return {
                    shouldPivot: false,
                    exhaustedBucket: null,
                    targetBucket: null,
                    targetModel: null,
                    reason: `${warnName} bucket at ${warnData.pct.toFixed(1)}% — approaching exhaustion. ` +
                            `No pivot needed yet.`,
                };
            }

            return {
                shouldPivot: false,
                exhaustedBucket: null,
                targetBucket: null,
                targetModel: null,
                reason: "All buckets healthy. No pivot needed.",
            };
        }

        // Pick the most relevant exhausted bucket (prefer current if exhausted)
        const exhaustedBucket = currentBucket && exhausted.includes(currentBucket)
            ? currentBucket
            : exhausted[0];

        // Find best pivot target
        const target = catalog.findPivotTarget(exhaustedBucket, snapshot.buckets);
        if (!target) {
            return {
                shouldPivot: false,
                exhaustedBucket,
                targetBucket: null,
                targetModel: null,
                reason: `${exhaustedBucket} bucket exhausted but no healthy alternative found. ` +
                        `Wait for quota reset.`,
            };
        }

        return {
            shouldPivot: true,
            exhaustedBucket,
            targetBucket: target,
            targetModel: target.models[0] ?? null,
            reason: `${exhaustedBucket} bucket exhausted (≤${EXHAUSTED_THRESHOLD_PCT}%). ` +
                    `Pivot to ${target.displayName} bucket (${target.quotaPct?.toFixed(1) ?? "unknown"}% remaining). ` +
                    `Recommended model: ${target.models[0] ?? "any"}.`,
        };
    }

    /**
     * Get a structured status report of all buckets.
     */
    getStatusReport(): {
        buckets: QuotaBucket[];
        recommendation: PivotRecommendation;
        snapshotAge: string;
        source: string;
    } {
        const snapshot = this.getQuotaSnapshot();
        const catalog = getModelCatalog();
        const activeModel = catalog.getActiveModel();

        // Determine current bucket from active model
        const allBuckets = catalog.getQuotaBuckets(snapshot.buckets);
        const currentBucket = allBuckets.find((b) =>
            activeModel ? b.models.includes(activeModel) : false
        );

        const recommendation = this.getPivotRecommendation(currentBucket?.name);

        const ageMs = Date.now() - snapshot.timestamp;
        const ageMin = Math.round(ageMs / 60_000);
        const snapshotAge = ageMin < 1 ? "just now" : `${ageMin}m ago`;

        return {
            buckets: allBuckets,
            recommendation,
            snapshotAge,
            source: snapshot.source,
        };
    }

    // ── Private: data source readers ───────────────────────────────

    private readFromStateDb(): QuotaSnapshot | null {
        const raw = readModelCredits();
        if (!raw) return null;

        try {
            // modelCredits format TBD — try JSON first
            const parsed = JSON.parse(raw);
            const buckets: Record<string, BucketQuota> = {};

            if (Array.isArray(parsed)) {
                // Array of { name, remaining_pct, reset_time }
                for (const item of parsed) {
                    const name = String(item.name ?? item.bucket ?? "unknown").toLowerCase();
                    buckets[name] = {
                        pct: Number(item.remaining_pct ?? item.pct ?? 100),
                        resetInSec: item.reset_in_sec,
                        resetTime: item.reset_time,
                    };
                }
            } else if (typeof parsed === "object") {
                // Object keyed by bucket name
                for (const [key, val] of Object.entries(parsed)) {
                    if (typeof val === "number") {
                        buckets[key.toLowerCase()] = { pct: val };
                    } else if (typeof val === "object" && val !== null) {
                        const v = val as Record<string, unknown>;
                        buckets[key.toLowerCase()] = {
                            pct: Number(v.pct ?? v.remaining_pct ?? 100),
                            resetInSec: v.reset_in_sec as number | undefined,
                            resetTime: v.reset_time as string | undefined,
                        };
                    }
                }
            }

            if (Object.keys(buckets).length === 0) return null;

            return { buckets, timestamp: Date.now(), source: "state_db" };
        } catch {
            // Not JSON — might be protobuf; attempt basic parse later
            return null;
        }
    }

    private readFromSnapshotFile(): QuotaSnapshot | null {
        const configDir = getGlobalConfigPath();
        const snapshotPath = path.join(configDir, "quota_snapshot.json");

        try {
            if (!fs.existsSync(snapshotPath)) return null;

            const data = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
            const buckets: Record<string, BucketQuota> = {};

            if (data.models && Array.isArray(data.models)) {
                // Legacy format: { models: [{ name, remaining_pct }] }
                for (const m of data.models) {
                    const family = String(m.name ?? "unknown").toLowerCase().split(" ")[0];
                    if (!buckets[family]) {
                        buckets[family] = { pct: Number(m.remaining_pct ?? m.remainingPercent ?? 100) };
                    }
                }
            } else if (data.buckets && typeof data.buckets === "object") {
                // New format: { buckets: { gemini: { pct: 80 } } }
                for (const [key, val] of Object.entries(data.buckets)) {
                    if (typeof val === "object" && val !== null) {
                        const v = val as Record<string, unknown>;
                        buckets[key.toLowerCase()] = {
                            pct: Number(v.pct ?? 100),
                            resetInSec: v.resetInSec as number | undefined,
                            resetTime: v.resetTime as string | undefined,
                        };
                    }
                }
            } else if (typeof data === "object") {
                // Flat format: { gemini: 80, claude: 45 }
                for (const [key, val] of Object.entries(data)) {
                    if (typeof val === "number") {
                        buckets[key.toLowerCase()] = { pct: val };
                    }
                }
            }

            if (Object.keys(buckets).length === 0) return null;

            const fileTime = fs.statSync(snapshotPath).mtimeMs;
            return { buckets, timestamp: fileTime, source: "snapshot_file" };
        } catch {
            return null;
        }
    }

    private estimateFromSpawns(): QuotaSnapshot {
        // Very rough estimation: assume 100 spawns = 100% usage
        // This is a last resort when no real data is available.
        const buckets: Record<string, BucketQuota> = {};

        for (const [bucket, count] of this.spawnCounts) {
            const estimatedUsed = Math.min(count * 2, 100); // 2% per spawn estimate
            buckets[bucket] = { pct: Math.max(0, 100 - estimatedUsed) };
        }

        return { buckets, timestamp: Date.now(), source: "estimated" };
    }

    private writeSnapshotFile(snapshot: QuotaSnapshot): void {
        try {
            const configDir = getGlobalConfigPath();
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            const snapshotPath = path.join(configDir, "quota_snapshot.json");
            fs.writeFileSync(snapshotPath, JSON.stringify({
                buckets: snapshot.buckets,
                timestamp: snapshot.timestamp,
                source: snapshot.source,
                updated_at: new Date().toISOString(),
            }, null, 2), "utf8");
        } catch {
            // Non-fatal — logging would be nice but quota monitor shouldn't crash
        }
    }

    /** Clear cached data (testing). */
    reset(): void {
        this.lastSnapshot = null;
        this.spawnCounts.clear();
    }
}

// ── Singleton ──────────────────────────────────────────────────────

let _monitor: QuotaMonitor | undefined;

export function getQuotaMonitor(): QuotaMonitor {
    if (!_monitor) {
        _monitor = new QuotaMonitor();
    }
    return _monitor;
}

/** Reset singleton (testing). */
export function resetQuotaMonitor(): void {
    _monitor = undefined;
}
