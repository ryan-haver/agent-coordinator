/**
 * Quota, routing, and notification tool handlers.
 *
 * Tools: check_quota, get_routing_recommendation,
 *        configure_notifications, send_notification
 */
import path from "path";
import os from "os";
import fs from "fs";
import { type ToolResponse } from "./context.js";
import { loadConfigs, saveConfigs, emitNotification, type WebhookConfig } from "../notifications/dispatcher.js";

const CONFIG_DIR = path.join(os.homedir(), '.antigravity-configs');

export async function handleCheckQuota(_args: Record<string, unknown>): Promise<ToolResponse> {
    const quotaPath = path.join(CONFIG_DIR, 'quota_snapshot.json');
    try {
        if (fs.existsSync(quotaPath)) {
            const quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
            return { toolResult: JSON.stringify(quota), content: [{ type: "text", text: JSON.stringify(quota, null, 2) }] };
        }
        return { toolResult: "(No quota snapshot found)", content: [{ type: "text", text: "No quota_snapshot.json found. Run quota_check.ps1 or .sh first." }] };
    } catch (e: any) {
        return { toolResult: `Quota check failed: ${e.message}`, content: [{ type: "text", text: `Error reading quota: ${e.message}` }] };
    }
}

// ── get_routing_recommendation ────────────────────────────────────────

interface RoutingRecommendation {
    recommended_model: string;
    reason: string;
    quota_remaining_pct: Record<string, number>;
    fallback_chain: string[];
    task_type?: string;
}

export async function handleGetRoutingRecommendation(args: Record<string, unknown>): Promise<ToolResponse> {
    const taskType = String(args.task_type ?? "");
    const quotaPath = path.join(CONFIG_DIR, 'quota_snapshot.json');
    const fallbackPath = path.join(process.cwd(), '..', '..', 'model_fallback.json');
    // Also try a relative path from the MCP server
    const fallbackPath2 = path.resolve(__dirname, '..', '..', '..', '..', 'model_fallback.json');

    // Load model fallback chain
    let fallbackConfig: any;
    for (const fp of [fallbackPath, fallbackPath2]) {
        try {
            if (fs.existsSync(fp)) {
                fallbackConfig = JSON.parse(fs.readFileSync(fp, 'utf8'));
                break;
            }
        } catch { /* try next */ }
    }

    if (!fallbackConfig) {
        return { content: [{ type: "text", text: "No model_fallback.json found. Cannot generate routing recommendation." }] };
    }

    const chain = fallbackConfig.model_fallback_chain;
    const tiers = chain?.tiers ?? [];
    const taskRouting = chain?.task_routing?.routes ?? {};
    const fallbackChain = tiers.map((t: any) => t.model);

    // Load quota snapshot
    let quotaRemaining: Record<string, number> = {};
    try {
        if (fs.existsSync(quotaPath)) {
            const quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
            // Extract remaining percentage per model family
            if (quota.models && Array.isArray(quota.models)) {
                for (const m of quota.models) {
                    const pct = m.remaining_pct ?? m.remainingPercent ?? 100;
                    quotaRemaining[m.name ?? m.model ?? "unknown"] = pct;
                }
            } else if (typeof quota === 'object') {
                // Flat quota format: { "claude": 85, "gemini": 45 }
                quotaRemaining = { ...quota };
            }
        }
    } catch { /* proceed without quota data */ }

    // Determine recommendation
    let recommended = fallbackChain[0] ?? "Unknown";
    let reason = "Default: top-tier model";

    // Task-based routing
    if (taskType && taskRouting[taskType]) {
        recommended = taskRouting[taskType];
        reason = `Task routing: "${taskType}" maps to ${recommended}`;
    }

    // Quota-aware override: if recommended model's family is below 30%, fall back
    const LOW_QUOTA_THRESHOLD = 30;
    const recommendedTier = tiers.find((t: any) => t.model === recommended);
    if (recommendedTier) {
        const family = recommendedTier.model?.toLowerCase();
        const familyQuota = Object.entries(quotaRemaining).find(([k]) =>
            k.toLowerCase().includes(family?.split(' ')[0] ?? '')
        );
        if (familyQuota && familyQuota[1] < LOW_QUOTA_THRESHOLD) {
            const tierIdx = tiers.indexOf(recommendedTier);
            const fallback = tiers[tierIdx + 1];
            if (fallback) {
                recommended = fallback.model;
                reason = `Quota-aware fallback: ${recommendedTier.model} at ${familyQuota[1]}% (below ${LOW_QUOTA_THRESHOLD}% threshold) → ${fallback.model} (${fallback.role})`;
            }
        }
    }

    const result: RoutingRecommendation = {
        recommended_model: recommended,
        reason,
        quota_remaining_pct: quotaRemaining,
        fallback_chain: fallbackChain,
        ...(taskType ? { task_type: taskType } : {})
    };

    const lines = [
        `Routing Recommendation`,
        "",
        `Recommended: ${result.recommended_model}`,
        `Reason:      ${result.reason}`,
        "",
        `Fallback chain: ${fallbackChain.join(" → ")}`,
        "",
        `Quota remaining:`,
        ...Object.entries(quotaRemaining).map(([k, v]) => `  ${k}: ${v}%`),
    ];

    if (Object.keys(quotaRemaining).length === 0) {
        lines.push("  (no quota data — run quota_check first)");
    }

    return {
        toolResult: JSON.stringify(result),
        content: [{ type: "text", text: lines.join("\n") }]
    };
}

// ── configure_notifications ───────────────────────────────────────────

export async function handleConfigureNotifications(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = String(args.action ?? "list");

    if (action === "list") {
        const configs = loadConfigs();
        if (configs.length === 0) {
            return { content: [{ type: "text", text: "No notification webhooks configured." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(configs, null, 2) }] };
    }

    if (action === "add") {
        const url = String(args.url ?? "");
        if (!url) return { isError: true, content: [{ type: "text", text: "url is required for action=add" }] };
        const events = Array.isArray(args.events) ? args.events.map(String) : ["*"];
        const format = (String(args.format ?? "json")) as "slack" | "discord" | "json";
        const label = String(args.label ?? "");

        const configs = loadConfigs();
        const newConfig: WebhookConfig = { url, events, format, ...(label ? { label } : {}) };
        configs.push(newConfig);
        saveConfigs(configs);

        return { content: [{ type: "text", text: `Added webhook: ${label || url} (${format}, events: ${events.join(", ")})` }] };
    }

    if (action === "remove") {
        const index = Number(args.index ?? -1);
        const configs = loadConfigs();
        if (index < 0 || index >= configs.length) {
            return { isError: true, content: [{ type: "text", text: `Invalid index ${index}. Use action=list to see configs.` }] };
        }
        const removed = configs.splice(index, 1)[0];
        saveConfigs(configs);
        return { content: [{ type: "text", text: `Removed webhook: ${removed.label || removed.url}` }] };
    }

    if (action === "clear") {
        saveConfigs([]);
        return { content: [{ type: "text", text: "All notification webhooks cleared." }] };
    }

    return { isError: true, content: [{ type: "text", text: `Unknown action "${action}". Use: list, add, remove, clear.` }] };
}

// ── send_notification ─────────────────────────────────────────────────

export async function handleSendNotification(args: Record<string, unknown>): Promise<ToolResponse> {
    const event = String(args.event ?? "manual");
    const message = String(args.message ?? "");
    if (!message) return { isError: true, content: [{ type: "text", text: "message is required" }] };

    const data = args.data && typeof args.data === 'object' ? args.data as object : undefined;
    const sent = await emitNotification(event, message, data);

    return {
        content: [{ type: "text", text: sent > 0 ? `Notification sent to ${sent} webhook(s).` : "No matching webhooks configured for this event." }]
    };
}
