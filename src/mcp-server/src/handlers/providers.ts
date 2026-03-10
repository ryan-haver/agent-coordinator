/**
 * Provider management handlers — list_providers, configure_provider.
 *
 * These MCP tools let agents and users query the available providers
 * and update their configuration at runtime.
 */
import type { ToolHandler } from "./context.js";
import { getProviderRegistry } from "../bridge/registry.js";
import {
    readProvidersConfig,
    writeProvidersConfig,
    loadProviders,
} from "../bridge/provider-loader.js";

/**
 * list_providers — returns all registered providers with health + config.
 *
 * Response includes: name, displayName, enabled, priority, models,
 * capabilities, maxConcurrent, activeCount, and live health status.
 */
export const handleListProviders: ToolHandler = async (_args) => {
    const registry = getProviderRegistry();
    const providers = registry.listProviders();

    // Get health status for all providers
    const healthMap = await registry.pingAll();

    const result = providers.map((p) => ({
        ...p,
        health: healthMap.get(p.name) ?? { online: false, latencyMs: -1, error: "Not checked" },
    }));

    const summary = result.map((p) => {
        const status = p.health.online ? "🟢 online" : "🔴 offline";
        const active = `${p.activeCount}/${p.maxConcurrent}`;
        return `  ${p.name} (${p.displayName}) — ${status}, ${active} active, priority ${p.priority}`;
    });

    return {
        toolResult: JSON.stringify({ providers: result }),
        content: [{
            type: "text" as const,
            text: `Registered Providers (${result.length}):\n${summary.join("\n")}`,
        }],
    };
};

/**
 * configure_provider — update a provider's runtime config.
 *
 * Supports toggling enabled/disabled, changing priority, and
 * adjusting maxConcurrent. Changes are persisted to providers.json.
 */
export const handleConfigureProvider: ToolHandler = async (args) => {
    const providerName = args.provider_name as string;
    const enabled = args.enabled as boolean | undefined;
    const priority = args.priority as number | undefined;
    const maxConcurrent = args.max_concurrent as number | undefined;

    if (!providerName) {
        return {
            toolResult: JSON.stringify({ error: "provider_name is required" }),
            content: [{ type: "text" as const, text: "Error: provider_name is required" }],
        };
    }

    // Read current config
    let config = readProvidersConfig();
    if (!config) {
        return {
            toolResult: JSON.stringify({ error: "No providers.json found — run loadProviders first" }),
            content: [{ type: "text" as const, text: "Error: No providers.json found" }],
        };
    }

    const entry = config.providers[providerName];
    if (!entry) {
        const available = Object.keys(config.providers).join(", ");
        return {
            toolResult: JSON.stringify({ error: `Unknown provider: ${providerName}`, available }),
            content: [{ type: "text" as const, text: `Unknown provider: ${providerName}. Available: ${available}` }],
        };
    }

    // Apply updates
    const changes: string[] = [];
    if (enabled !== undefined) {
        entry.enabled = enabled;
        changes.push(`enabled → ${enabled}`);
    }
    if (priority !== undefined) {
        entry.priority = priority;
        changes.push(`priority → ${priority}`);
    }
    if (maxConcurrent !== undefined) {
        entry.maxConcurrent = maxConcurrent;
        changes.push(`maxConcurrent → ${maxConcurrent}`);
    }

    if (changes.length === 0) {
        return {
            toolResult: JSON.stringify({ error: "No changes specified" }),
            content: [{ type: "text" as const, text: "No changes specified. Use enabled, priority, or max_concurrent." }],
        };
    }

    // Persist to disk
    writeProvidersConfig(config);

    // Reload the registry to pick up changes
    const loadResult = loadProviders();

    const summary = [
        `Updated "${providerName}":`,
        ...changes.map((c) => `  • ${c}`),
        "",
        `Registry reloaded: ${loadResult.loaded.length} loaded, ${loadResult.skipped.length} skipped`,
    ];

    return {
        toolResult: JSON.stringify({ updated: providerName, changes, loadResult }),
        content: [{ type: "text" as const, text: summary.join("\n") }],
    };
};
