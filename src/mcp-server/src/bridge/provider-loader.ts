/**
 * Provider Loader — reads providers.json and bootstraps the ProviderRegistry.
 *
 * On server startup, call `loadProviders()` to populate the registry
 * with all enabled providers from the config file. Falls back to
 * registering only the AntigravityProvider if no config is found.
 *
 * Config search order:
 *   1. ~/.antigravity-configs/providers.json (user override)
 *   2. <mcp-server>/providers.json (bundled default)
 */
import fs from "fs";
import path from "path";
import os from "os";
import { getProviderRegistry } from "./registry.js";
import { getAntigravityProvider } from "./antigravity-provider.js";
import { ClaudeCodeProvider } from "./claude-code-provider.js";
import type { AgentProvider } from "./provider.js";

/** Shape of a single provider entry in providers.json */
export interface ProviderConfigEntry {
    enabled: boolean;
    type: "http" | "cli" | "api";
    endpoint?: string;
    command?: string;
    priority: number;
    maxConcurrent: number;
    /** Provider-specific settings */
    settings?: Record<string, unknown>;
}

/** Shape of the full providers.json file */
export interface ProvidersConfig {
    providers: Record<string, ProviderConfigEntry>;
    routing: {
        strategy: "priority" | "cost-optimized" | "round-robin";
        fallbackChain: string[];
    };
    rateLimits: {
        globalMaxConcurrent: number;
        globalMaxPerHour: number;
    };
}

/** Default config path inside the MCP server package */
const BUNDLED_CONFIG = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
    "../../providers.json",
);

/** User override config path */
const USER_CONFIG = path.join(os.homedir(), ".antigravity-configs", "providers.json");

/**
 * Read providers.json from the user override path or bundled default.
 * Returns null if neither exists.
 */
export function readProvidersConfig(): ProvidersConfig | null {
    for (const configPath of [USER_CONFIG, BUNDLED_CONFIG]) {
        try {
            if (fs.existsSync(configPath)) {
                const raw = fs.readFileSync(configPath, "utf8");
                return JSON.parse(raw) as ProvidersConfig;
            }
        } catch {
            // Malformed JSON — skip and try next
        }
    }
    return null;
}

/**
 * Create a provider instance by type.
 *
 * Currently only "http" (Antigravity) is implemented.
 * CLI providers (claude-code, codex) will be added in Phase 8B/8D.
 */
export function createProvider(
    name: string,
    entry: ProviderConfigEntry,
): AgentProvider | null {
    switch (name) {
        case "antigravity":
            return getAntigravityProvider();

        case "claude-code":
            return new ClaudeCodeProvider({
                command: entry.command,
                defaultModel: entry.settings?.defaultModel as string | undefined,
                maxTurns: entry.settings?.maxTurns as number | undefined,
                allowedTools: entry.settings?.allowedTools as string | undefined,
            });

        // Phase 8D: Codex
        // case "codex":
        //     return new CodexProvider(entry);

        default:
            return null;
    }
}

/**
 * Bootstrap the ProviderRegistry from config.
 *
 * Call once at server startup. Idempotent — clears registry first.
 */
export function loadProviders(): { loaded: string[]; skipped: string[] } {
    const registry = getProviderRegistry();
    registry.clear();

    const config = readProvidersConfig();
    const loaded: string[] = [];
    const skipped: string[] = [];

    if (config) {
        for (const [name, entry] of Object.entries(config.providers)) {
            if (!entry.enabled) {
                skipped.push(name);
                continue;
            }

            const provider = createProvider(name, entry);
            if (!provider) {
                skipped.push(name);
                continue;
            }

            registry.register(provider, {
                enabled: true,
                priority: entry.priority,
                maxConcurrent: entry.maxConcurrent,
                settings: entry.settings,
            });
            loaded.push(name);
        }
    }

    // Always ensure Antigravity is registered as fallback
    if (!registry.getProvider("antigravity")) {
        const ag = getAntigravityProvider();
        registry.register(ag, { enabled: true, priority: 99, maxConcurrent: 3 });
        loaded.push("antigravity");
    }

    return { loaded, skipped };
}

/**
 * Write updated providers config to user config path.
 * Creates ~/.antigravity-configs/ if needed.
 */
export function writeProvidersConfig(config: ProvidersConfig): void {
    const dir = path.dirname(USER_CONFIG);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(USER_CONFIG, JSON.stringify(config, null, 2), "utf8");
}
