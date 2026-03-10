/**
 * Provider Loader Tests — config parsing, provider creation, registry bootstrap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    loadProviders,
    readProvidersConfig,
    createProvider,
} from "../src/bridge/provider-loader.js";
import { resetProviderRegistry, getProviderRegistry } from "../src/bridge/registry.js";
import type { ProviderConfigEntry, ProvidersConfig } from "../src/bridge/provider-loader.js";
import fs from "fs";

// Mock fs to avoid touching real config files
vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof fs>("fs");
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: vi.fn(),
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
        },
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});

beforeEach(() => {
    resetProviderRegistry();
    vi.clearAllMocks();
});

afterEach(() => {
    resetProviderRegistry();
});

// ── readProvidersConfig ─────────────────────────────────────────────

describe("readProvidersConfig", () => {
    it("returns null when no config files exist", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const config = readProvidersConfig();
        expect(config).toBeNull();
    });

    it("returns parsed config when file exists", () => {
        const mockConfig: ProvidersConfig = {
            providers: {
                antigravity: { enabled: true, type: "http", endpoint: "http://127.0.0.1:9090", priority: 1, maxConcurrent: 3 },
            },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const config = readProvidersConfig();
        expect(config).not.toBeNull();
        expect(config!.providers.antigravity.priority).toBe(1);
        expect(config!.routing.strategy).toBe("priority");
    });

    it("skips malformed JSON", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("{ not valid json }}}");

        const config = readProvidersConfig();
        // Should not throw — returns null
        expect(config).toBeNull();
    });
});

// ── createProvider ──────────────────────────────────────────────────

describe("createProvider", () => {
    it("returns AntigravityProvider for 'antigravity'", () => {
        const entry: ProviderConfigEntry = { enabled: true, type: "http", priority: 1, maxConcurrent: 3 };
        const provider = createProvider("antigravity", entry);
        expect(provider).not.toBeNull();
        expect(provider!.name).toBe("antigravity");
    });

    it("returns null for unknown provider type", () => {
        const entry: ProviderConfigEntry = { enabled: true, type: "cli", priority: 2, maxConcurrent: 2 };
        const provider = createProvider("unknown-provider", entry);
        expect(provider).toBeNull();
    });

    it("returns ClaudeCodeProvider for claude-code", () => {
        const entry: ProviderConfigEntry = { enabled: true, type: "cli", command: "claude", priority: 2, maxConcurrent: 2 };
        const provider = createProvider("claude-code", entry);
        expect(provider).not.toBeNull();
        expect(provider!.name).toBe("claude-code");
    });
});

// ── loadProviders ───────────────────────────────────────────────────

describe("loadProviders", () => {
    it("registers antigravity as fallback when no config exists", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const result = loadProviders();

        expect(result.loaded).toContain("antigravity");
        const registry = getProviderRegistry();
        expect(registry.getProvider("antigravity")).toBeDefined();
    });

    it("registers enabled providers from config", () => {
        const mockConfig: ProvidersConfig = {
            providers: {
                antigravity: { enabled: true, type: "http", priority: 1, maxConcurrent: 3 },
            },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const result = loadProviders();

        expect(result.loaded).toContain("antigravity");
        expect(result.skipped).toHaveLength(0);
    });

    it("skips disabled providers", () => {
        const mockConfig: ProvidersConfig = {
            providers: {
                antigravity: { enabled: true, type: "http", priority: 1, maxConcurrent: 3 },
                "claude-code": { enabled: false, type: "cli", command: "claude", priority: 2, maxConcurrent: 2 },
            },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const result = loadProviders();

        expect(result.loaded).toContain("antigravity");
        expect(result.skipped).toContain("claude-code");

        const registry = getProviderRegistry();
        expect(registry.getProvider("claude-code")).toBeUndefined();
    });

    it("clears existing providers before loading", () => {
        // Load once
        vi.mocked(fs.existsSync).mockReturnValue(false);
        loadProviders();

        const registry = getProviderRegistry();
        expect(registry.getProvider("antigravity")).toBeDefined();

        // Load again — should clear and re-register
        const result = loadProviders();
        expect(result.loaded).toContain("antigravity");
        expect(registry.listProviders().length).toBe(1);
    });

    it("respects priority from config", () => {
        const mockConfig: ProvidersConfig = {
            providers: {
                antigravity: { enabled: true, type: "http", priority: 5, maxConcurrent: 3 },
            },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        loadProviders();

        const registry = getProviderRegistry();
        const listed = registry.listProviders();
        expect(listed[0].priority).toBe(5);
    });

    it("respects maxConcurrent from config", () => {
        const mockConfig: ProvidersConfig = {
            providers: {
                antigravity: { enabled: true, type: "http", priority: 1, maxConcurrent: 10 },
            },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        loadProviders();

        const registry = getProviderRegistry();
        const listed = registry.listProviders();
        expect(listed[0].maxConcurrent).toBe(10);
    });
});

// ── Barrel export check ─────────────────────────────────────────────

describe("barrel exports provider-loader", () => {
    it("re-exports loader functions from bridge barrel", async () => {
        const barrel = await import("../src/bridge/index.js");
        expect(barrel.loadProviders).toBeDefined();
        expect(barrel.readProvidersConfig).toBeDefined();
        expect(barrel.writeProvidersConfig).toBeDefined();
        expect(barrel.createProvider).toBeDefined();
    });
});
