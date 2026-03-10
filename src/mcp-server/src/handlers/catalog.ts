/**
 * sync_model_catalog — MCP tool handler.
 *
 * Reads the live model list from Antigravity's state database,
 * diffs it against model_fallback.json, and optionally updates
 * the static config to match the live state.
 */
import fs from "fs";
import path from "path";
import { type ToolResponse, getGlobalConfigPath } from "./context.js";
import { getModelCatalog } from "../bridge/model-catalog.js";
import { getQuotaMonitor } from "../bridge/quota-monitor.js";

export async function handleSyncModelCatalog(args: Record<string, unknown>): Promise<ToolResponse> {
    const updateFallback = args.update_fallback === true;
    const catalog = getModelCatalog();

    // Force refresh
    catalog.invalidate();
    const snapshot = catalog.getSnapshot();

    const lines: string[] = [
        `Model Catalog Sync`,
        ``,
        `Source: ${snapshot.source}`,
        `Timestamp: ${new Date(snapshot.timestamp).toISOString()}`,
        `Active model: ${snapshot.activeModel ?? "(unknown)"}`,
        `Subscription tier: ${snapshot.subscriptionTier ?? "(unknown)"}`,
        ``,
        `Available models (${snapshot.models.length}):`,
    ];

    for (const m of snapshot.models) {
        const marker = m.active ? " ← ACTIVE" : "";
        lines.push(`  • ${m.label} [${m.family}]${marker}`);
    }

    // Quota buckets
    const monitor = getQuotaMonitor();
    const status = monitor.getStatusReport();

    lines.push(``);
    lines.push(`Quota Buckets:`);
    for (const b of status.buckets) {
        const pct = b.quotaPct !== null ? `${b.quotaPct.toFixed(1)}%` : "unknown";
        const reset = b.resetInSec !== null ? ` | reset in ${Math.round(b.resetInSec / 60)}m` : "";
        const statusLabel = b.status !== "unknown" ? ` [${b.status.toUpperCase()}]` : "";
        lines.push(`  ${b.displayName}: ${pct}${reset}${statusLabel}`);
        for (const model of b.models) {
            lines.push(`    - ${model}`);
        }
    }

    // Pivot recommendation
    lines.push(``);
    lines.push(`Pivot: ${status.recommendation.reason}`);
    if (status.recommendation.shouldPivot && status.recommendation.targetModel) {
        lines.push(`  → Switch to: ${status.recommendation.targetModel}`);
    }
    lines.push(`Snapshot: ${status.snapshotAge} (${status.source})`);

    // Diff with fallback JSON
    const diff = catalog.diffWithFallbackJson();
    lines.push(``);

    if (diff.added.length === 0 && diff.removed.length === 0) {
        lines.push(`✅ model_fallback.json is in sync with live catalog.`);
    } else {
        if (diff.added.length > 0) {
            lines.push(`🆕 New models (in state DB but not in model_fallback.json):`);
            for (const m of diff.added) lines.push(`  + ${m}`);
        }
        if (diff.removed.length > 0) {
            lines.push(`❌ Removed models (in model_fallback.json but not in state DB):`);
            for (const m of diff.removed) lines.push(`  - ${m}`);
        }
        if (diff.unchanged.length > 0) {
            lines.push(`✅ Unchanged: ${diff.unchanged.join(", ")}`);
        }
    }

    // Optionally update model_fallback.json
    if (updateFallback && (diff.added.length > 0 || diff.removed.length > 0)) {
        const updated = updateFallbackJson(snapshot.models.map((m) => ({
            name: m.label,
            family: m.family,
        })));
        if (updated) {
            lines.push(``);
            lines.push(`📝 Updated model_fallback.json available_models section.`);
        } else {
            lines.push(``);
            lines.push(`⚠️  Could not update model_fallback.json (file not found or write error).`);
        }
    }

    return {
        toolResult: JSON.stringify({
            source: snapshot.source,
            models: snapshot.models,
            activeModel: snapshot.activeModel,
            subscriptionTier: snapshot.subscriptionTier,
            diff,
            quotaBuckets: status.buckets,
            pivotRecommendation: status.recommendation,
        }),
        content: [{ type: "text", text: lines.join("\n") }],
    };
}

/**
 * Update the available_models section of model_fallback.json.
 * Returns true if successful.
 */
function updateFallbackJson(
    models: Array<{ name: string; family: string }>
): boolean {
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

            // Update available_models
            if (!config.model_fallback_chain) continue;
            config.model_fallback_chain.available_models = {
                description: "Auto-synced from Antigravity state DB. Last sync: " + new Date().toISOString(),
                models: models.map((m) => ({
                    name: m.name,
                    family: m.family,
                    tier_recommendation: inferTier(m.name),
                    notes: `Auto-discovered from state.vscdb`,
                })),
            };

            fs.writeFileSync(fp, JSON.stringify(config, null, 2) + "\n", "utf8");
            return true;
        } catch {
            continue;
        }
    }
    return false;
}

function inferTier(label: string): number {
    const lower = label.toLowerCase();
    if (lower.includes("opus")) return 1;
    if (lower.includes("pro") && lower.includes("high")) return 2;
    if (lower.includes("sonnet")) return 2;
    if (lower.includes("pro") && lower.includes("low")) return 3;
    if (lower.includes("flash")) return 3;
    if (lower.includes("gpt") || lower.includes("oss")) return 2;
    return 2;
}
