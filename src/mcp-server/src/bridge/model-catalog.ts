/**
 * ModelCatalog — reads the live model list from Antigravity's state.vscdb.
 *
 * The state DB is an SQLite key-value store (`ItemTable`) managed by the
 * Antigravity IDE.  The `antigravityUnifiedStateSync.userStatus` key
 * contains a cached `GetUserStatusResponse` protobuf.  We parse it with
 * a minimal wire-format reader to extract model labels — no generated
 * protobuf code required.
 *
 * Discovery path:
 *   state.vscdb → ItemTable → userStatus → base64 → protobuf
 *     → depth-5, field 1 strings = model labels
 *     → depth-4 "Google AI Ultra" = subscription tier
 *
 * Falls back to the static `model_fallback.json` if the DB is
 * unavailable (e.g. Antigravity not installed, DB locked, etc.).
 */
import fs from "fs";
import path from "path";
import os from "os";
import { getGlobalConfigPath } from "../handlers/context.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ModelEntry {
    /** Human-readable label from the model selector (e.g. "Gemini 3.1 Pro (High)") */
    label: string;
    /** Inferred family: "gemini", "claude", "gpt", or "unknown" */
    family: string;
    /** Whether this is the currently active model */
    active: boolean;
}

export interface CatalogSnapshot {
    /** All available models */
    models: ModelEntry[];
    /** Currently active model label (from modelPreferences or allowed_command) */
    activeModel: string | null;
    /** Subscription tier label (e.g. "Google AI Ultra") */
    subscriptionTier: string | null;
    /** Source of this snapshot */
    source: "state_db" | "fallback_json" | "hardcoded";
    /** When this snapshot was taken */
    timestamp: number;
}

/**
 * A quota bucket groups models that share a common credit pool.
 * Based on Antigravity Quota Monitor UI:
 *   - "gemini" bucket: Gemini 3.1 Pro (High), Gemini 3.1 Pro (Low)
 *   - "claude" bucket: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B
 *   - "flash" bucket: Gemini 3 Flash (appears unbucketed / unlimited)
 */
export interface QuotaBucket {
    /** Bucket identifier: "gemini", "claude", "flash" */
    name: string;
    /** Human label matching the Quota Monitor UI */
    displayName: string;
    /** Model labels in this bucket */
    models: string[];
    /** Quota remaining percentage (null if unknown) */
    quotaPct: number | null;
    /** Seconds until quota resets (null if unknown) */
    resetInSec: number | null;
    /** ISO timestamp of next reset (null if unknown) */
    resetTime: string | null;
    /** Health status: healthy | warning | exhausted */
    status: "healthy" | "warning" | "exhausted" | "unknown";
}

/**
 * Bucket assignment rules — maps model labels to bucket names.
 * Flash is separate because it has its own (seemingly unlimited) quota.
 * GPT-OSS is grouped with Claude per the Quota Monitor UI.
 */
const BUCKET_RULES: Array<{ bucket: string; displayName: string; match: (label: string) => boolean }> = [
    {
        bucket: "gemini",
        displayName: "Gemini",
        match: (l) => /gemini.*pro/i.test(l),
    },
    {
        bucket: "flash",
        displayName: "Flash",
        match: (l) => /flash/i.test(l),
    },
    {
        bucket: "claude",
        displayName: "Claude",
        match: (l) => /claude|opus|sonnet|gpt|oss/i.test(l),
    },
];

// ── Protobuf Wire Format Parser ────────────────────────────────────

interface PbField {
    field: number;
    data?: Buffer;
}

function parseProtobufFields(buffer: Buffer): PbField[] {
    const results: PbField[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        let tag = 0, shift = 0, byte: number;
        do {
            if (offset >= buffer.length) return results;
            byte = buffer[offset++];
            tag |= (byte & 0x7F) << shift;
            shift += 7;
            if (shift > 35) return results;
        } while (byte & 0x80);

        const fieldNumber = tag >> 3;
        const wireType = tag & 0x07;
        if (fieldNumber === 0 || fieldNumber > 1000) return results;

        if (wireType === 0) {
            // varint — skip
            shift = 0;
            do {
                if (offset >= buffer.length) return results;
                byte = buffer[offset++];
                shift += 7;
                if (shift > 64) return results;
            } while (byte & 0x80);
        } else if (wireType === 2) {
            // length-delimited
            let length = 0;
            shift = 0;
            do {
                if (offset >= buffer.length) return results;
                byte = buffer[offset++];
                length |= (byte & 0x7F) << shift;
                shift += 7;
            } while (byte & 0x80);
            if (length < 0 || offset + length > buffer.length) return results;
            results.push({ field: fieldNumber, data: buffer.subarray(offset, offset + length) });
            offset += length;
        } else if (wireType === 5) {
            offset += 4;
        } else if (wireType === 1) {
            offset += 8;
        } else {
            return results;
        }
    }
    return results;
}

/**
 * Recursively extract all printable strings from a protobuf buffer.
 * Returns an array of { value, field, depth } entries.
 */
function extractStrings(
    buffer: Buffer,
    depth: number = 0,
    maxDepth: number = 10
): Array<{ value: string; field: number; depth: number }> {
    if (depth >= maxDepth) return [];
    const strings: Array<{ value: string; field: number; depth: number }> = [];
    const fields = parseProtobufFields(buffer);

    for (const f of fields) {
        if (!f.data) continue;
        const str = f.data.toString("utf8");
        const isPrintable = /^[\x20-\x7e]+$/.test(str);
        if (isPrintable && str.length >= 3) {
            strings.push({ value: str, field: f.field, depth });
        }
        // Recurse into embedded messages
        const nested = extractStrings(f.data, depth + 1, maxDepth);
        strings.push(...nested);
    }
    return strings;
}

// ── State DB Reader ────────────────────────────────────────────────

export function getStateDbPath(): string {
    const platform = os.platform();
    if (platform === "win32") {
        return path.join(process.env.APPDATA ?? "", "Antigravity", "User", "globalStorage", "state.vscdb");
    } else if (platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "Antigravity", "User", "globalStorage", "state.vscdb");
    } else {
        return path.join(os.homedir(), ".config", "Antigravity", "User", "globalStorage", "state.vscdb");
    }
}

export function inferFamily(label: string): string {
    const lower = label.toLowerCase();
    if (lower.includes("gemini")) return "gemini";
    if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus")) return "claude";
    if (lower.includes("gpt") || lower.includes("oss")) return "gpt";
    return "unknown";
}

/**
 * Read the modelCredits key from state.vscdb.
 * Returns raw value string if present, null if empty/missing.
 */
export function readModelCredits(): string | null {
    const dbPath = getStateDbPath();
    if (!fs.existsSync(dbPath)) return null;
    let Database: typeof import("better-sqlite3");
    try { Database = require("better-sqlite3"); } catch { return null; }
    let db: InstanceType<typeof Database>;
    try { db = new Database(dbPath, { readonly: true }); } catch { return null; }
    try {
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?")
            .get("antigravityUnifiedStateSync.modelCredits") as { value: string } | undefined;
        const val = row?.value ? String(row.value) : null;
        return val && val.length > 0 ? val : null;
    } catch {
        return null;
    } finally {
        try { db.close(); } catch { /* ignore */ }
    }
}

/**
 * Read the live model list from the Antigravity state database.
 * Returns null if the DB is unavailable or unreadable.
 */
function readFromStateDb(): CatalogSnapshot | null {
    const dbPath = getStateDbPath();
    if (!fs.existsSync(dbPath)) return null;

    let Database: typeof import("better-sqlite3");
    try {
        // better-sqlite3 is a transitive dependency
        Database = require("better-sqlite3");
    } catch {
        return null;
    }

    let db: InstanceType<typeof Database>;
    try {
        db = new Database(dbPath, { readonly: true });
    } catch {
        return null;
    }

    try {
        // ── Extract full model list from userStatus ──
        const userStatusRow = db.prepare("SELECT value FROM ItemTable WHERE key = ?")
            .get("antigravityUnifiedStateSync.userStatus") as { value: string } | undefined;

        let modelLabels: string[] = [];
        let subscriptionTier: string | null = null;

        if (userStatusRow?.value) {
            const buf = Buffer.from(String(userStatusRow.value), "base64");
            const allStrings = extractStrings(buf);

            // Model labels appear at depth 5, field 1 — capital-letter names, no slashes
            modelLabels = allStrings
                .filter(
                    (s) =>
                        s.depth === 5 &&
                        s.field === 1 &&
                        /^[A-Z]/.test(s.value) &&
                        s.value.length >= 4 &&
                        !s.value.includes("/") &&
                        !s.value.includes("=") &&
                        // Exclude non-model strings that appear at same depth
                        s.value !== "New" &&
                        s.value !== "Recommended"
                )
                .map((s) => s.value);

            // De-duplicate (models repeat because of MIME type sub-messages)
            modelLabels = [...new Set(modelLabels)];

            // Subscription tier at depth 4, field 2
            const tierEntry = allStrings.find(
                (s) => s.depth === 4 && s.field === 2 && /^[A-Z]/.test(s.value) && s.value.includes("AI")
            );
            subscriptionTier = tierEntry?.value ?? null;
        }

        // ── Extract active model from allowed_command configs ──
        let activeModel: string | null = null;
        const activeRow = db.prepare("SELECT value FROM ItemTable WHERE key = ?")
            .get("antigravity_allowed_command_model_configs") as { value: string } | undefined;

        if (activeRow?.value) {
            try {
                const arr = JSON.parse(String(activeRow.value)) as string[];
                if (arr.length > 0) {
                    const activeBuf = Buffer.from(arr[0], "base64");
                    const activeStrings = extractStrings(activeBuf);
                    const modelStr = activeStrings.find(
                        (s) => s.depth === 0 && s.field === 1 && /^[A-Z]/.test(s.value)
                    );
                    activeModel = modelStr?.value ?? null;
                }
            } catch {
                // ignore parse errors
            }
        }

        if (modelLabels.length === 0) return null;

        const models: ModelEntry[] = modelLabels.map((label) => ({
            label,
            family: inferFamily(label),
            active: label === activeModel,
        }));

        return {
            models,
            activeModel,
            subscriptionTier,
            source: "state_db",
            timestamp: Date.now(),
        };
    } catch {
        return null;
    } finally {
        try { db.close(); } catch { /* ignore */ }
    }
}

// ── Fallback: static model_fallback.json ───────────────────────────

function readFromFallbackJson(): CatalogSnapshot | null {
    const configDir = getGlobalConfigPath();
    const envDir = process.env.AGENT_COORDINATOR_CONFIG;
    const searchPaths = [
        envDir ? path.join(envDir, "model_fallback.json") : null,
        path.join(process.cwd(), "..", "..", "model_fallback.json"),
        path.resolve(__dirname, "..", "..", "..", "..", "model_fallback.json"),
        path.join(configDir, "model_fallback.json"),
    ].filter(Boolean) as string[];

    for (const fp of searchPaths) {
        try {
            if (!fs.existsSync(fp)) continue;
            const config = JSON.parse(fs.readFileSync(fp, "utf8"));
            const available = config.model_fallback_chain?.available_models?.models ?? [];
            if (available.length === 0) continue;

            const models: ModelEntry[] = available.map((m: { name: string; family?: string }) => ({
                label: m.name,
                family: m.family ?? inferFamily(m.name),
                active: false,
            }));

            return {
                models,
                activeModel: null,
                subscriptionTier: null,
                source: "fallback_json",
                timestamp: Date.now(),
            };
        } catch {
            continue;
        }
    }
    return null;
}

// ── Hardcoded last-resort ──────────────────────────────────────────

const HARDCODED_MODELS: ModelEntry[] = [
    { label: "Gemini 3.1 Pro (High)", family: "gemini", active: false },
    { label: "Gemini 3.1 Pro (Low)", family: "gemini", active: false },
    { label: "Gemini 3 Flash", family: "gemini", active: false },
    { label: "Claude Sonnet 4.6 (Thinking)", family: "claude", active: false },
    { label: "Claude Opus 4.6 (Thinking)", family: "claude", active: false },
    { label: "GPT-OSS 120B (Medium)", family: "gpt", active: false },
];

// ── ModelCatalog Class ─────────────────────────────────────────────

export class ModelCatalog {
    private cache: CatalogSnapshot | null = null;
    private cacheTtlMs: number;

    constructor(opts?: { cacheTtlMs?: number }) {
        this.cacheTtlMs = opts?.cacheTtlMs ?? 5 * 60_000; // 5 min default
    }

    /** Get the current model catalog snapshot (cached). */
    getSnapshot(): CatalogSnapshot {
        if (this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
            return this.cache;
        }
        return this.refresh();
    }

    /** Force-refresh the catalog from all sources. */
    refresh(): CatalogSnapshot {
        // Try state DB first (live data)
        const fromDb = readFromStateDb();
        if (fromDb) {
            this.cache = fromDb;
            return fromDb;
        }

        // Fallback to model_fallback.json
        const fromJson = readFromFallbackJson();
        if (fromJson) {
            this.cache = fromJson;
            return fromJson;
        }

        // Last resort: hardcoded
        const hardcoded: CatalogSnapshot = {
            models: HARDCODED_MODELS,
            activeModel: null,
            subscriptionTier: null,
            source: "hardcoded",
            timestamp: Date.now(),
        };
        this.cache = hardcoded;
        return hardcoded;
    }

    /** Get just the model label strings. */
    getModelLabels(): string[] {
        return this.getSnapshot().models.map((m) => m.label);
    }

    /** Get the currently active model label. */
    getActiveModel(): string | null {
        return this.getSnapshot().activeModel;
    }

    /** Invalidate the cache so the next call re-reads. */
    invalidate(): void {
        this.cache = null;
    }

    /**
     * Get quota buckets with model assignments.
     * Quota percentages will be null until a quota source is available.
     */
    getQuotaBuckets(quotaData?: Record<string, { pct: number; resetInSec?: number; resetTime?: string }>): QuotaBucket[] {
        const models = this.getModelLabels();
        const bucketMap = new Map<string, { displayName: string; models: string[] }>();

        for (const label of models) {
            const rule = BUCKET_RULES.find((r) => r.match(label));
            const bucketName = rule?.bucket ?? "unknown";
            const displayName = rule?.displayName ?? "Unknown";
            if (!bucketMap.has(bucketName)) {
                bucketMap.set(bucketName, { displayName, models: [] });
            }
            bucketMap.get(bucketName)!.models.push(label);
        }

        const buckets: QuotaBucket[] = [];
        for (const [name, info] of bucketMap) {
            const quota = quotaData?.[name];
            const pct = quota?.pct ?? null;
            let status: QuotaBucket["status"] = "unknown";
            if (pct !== null) {
                if (pct <= 5) status = "exhausted";
                else if (pct <= 20) status = "warning";
                else status = "healthy";
            }
            buckets.push({
                name,
                displayName: info.displayName,
                models: info.models,
                quotaPct: pct,
                resetInSec: quota?.resetInSec ?? null,
                resetTime: quota?.resetTime ?? null,
                status,
            });
        }
        return buckets;
    }

    /**
     * Find the best pivot target when a bucket is exhausted.
     * Returns the healthiest bucket that is NOT the exhausted one.
     */
    findPivotTarget(exhaustedBucket: string, quotaData?: Record<string, { pct: number }>): QuotaBucket | null {
        const buckets = this.getQuotaBuckets(
            quotaData as Record<string, { pct: number; resetInSec?: number; resetTime?: string }> | undefined
        );
        const candidates = buckets
            .filter((b) => b.name !== exhaustedBucket && b.status !== "exhausted" && b.models.length > 0)
            .sort((a, b) => (b.quotaPct ?? 100) - (a.quotaPct ?? 100));
        return candidates[0] ?? null;
    }

    /**
     * Diff cur catalog vs model_fallback.json available_models.
     * Returns { added, removed, unchanged }.
     */
    diffWithFallbackJson(): { added: string[]; removed: string[]; unchanged: string[] } {
        const live = new Set(this.getModelLabels());
        const fromJson = readFromFallbackJson();
        const jsonLabels = new Set(fromJson?.models.map((m) => m.label) ?? []);

        const added = [...live].filter((l) => !jsonLabels.has(l));
        const removed = [...jsonLabels].filter((l) => !live.has(l));
        const unchanged = [...live].filter((l) => jsonLabels.has(l));

        return { added, removed, unchanged };
    }
}

// ── Singleton ──────────────────────────────────────────────────────

let _catalog: ModelCatalog | undefined;

export function getModelCatalog(): ModelCatalog {
    if (!_catalog) {
        _catalog = new ModelCatalog();
    }
    return _catalog;
}

/** Reset singleton (testing). */
export function resetModelCatalog(): void {
    _catalog = undefined;
}
