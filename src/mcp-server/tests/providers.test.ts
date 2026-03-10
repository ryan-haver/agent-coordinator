/**
 * Provider Management Tool Tests — list_providers, configure_provider.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleListProviders, handleConfigureProvider } from "../src/handlers/providers.js";
import { getProviderRegistry, resetProviderRegistry } from "../src/bridge/registry.js";
import { TOOL_HANDLERS } from "../src/handlers/index.js";
import { TOOL_DEFINITIONS } from "../src/handlers/tool-definitions.js";
import type { AgentProvider, ProviderHealth, SpawnResult, AgentStatus, SessionInfo } from "../src/bridge/provider.js";
import fs from "fs";

// Mock fs for writeProvidersConfig persistence
vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof fs>("fs");
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: vi.fn().mockReturnValue(false),
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
        },
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});

/** Minimal mock provider for testing */
function createMockProvider(name: string, online = true): AgentProvider {
    return {
        name,
        displayName: `Mock ${name}`,
        models: ["test-model"],
        capabilities: ["file-edit"],
        ping: async (): Promise<ProviderHealth> => ({
            online,
            latencyMs: online ? 10 : -1,
            error: online ? undefined : "offline",
        }),
        spawn: async (): Promise<SpawnResult> => ({ success: true, conversationId: "test-123" }),
        getAgentStatus: async (id: string): Promise<AgentStatus> => ({ conversationId: id, state: "running" }),
        listSessions: async (): Promise<SessionInfo[]> => [],
        stop: async (): Promise<void> => {},
    };
}

beforeEach(() => {
    resetProviderRegistry();
    vi.clearAllMocks();
});

afterEach(() => {
    resetProviderRegistry();
});

// ── Tool registration ───────────────────────────────────────────────

describe("tool registration", () => {
    it("list_providers is registered in TOOL_HANDLERS", () => {
        expect(TOOL_HANDLERS.list_providers).toBeDefined();
    });

    it("configure_provider is registered in TOOL_HANDLERS", () => {
        expect(TOOL_HANDLERS.configure_provider).toBeDefined();
    });

    it("list_providers has a tool definition", () => {
        const def = TOOL_DEFINITIONS.find((t) => t.name === "list_providers");
        expect(def).toBeDefined();
    });

    it("configure_provider has a tool definition", () => {
        const def = TOOL_DEFINITIONS.find((t) => t.name === "configure_provider");
        expect(def).toBeDefined();
        expect(def!.inputSchema.required).toContain("provider_name");
    });
});

// ── list_providers ──────────────────────────────────────────────────

describe("handleListProviders", () => {
    it("returns empty list when no providers registered", async () => {
        const result = await handleListProviders({});
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.providers).toEqual([]);
    });

    it("returns providers with health", async () => {
        const registry = getProviderRegistry();
        registry.register(createMockProvider("test-provider"), {
            enabled: true,
            priority: 1,
            maxConcurrent: 3,
        });

        const result = await handleListProviders({});
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.providers).toHaveLength(1);
        expect(parsed.providers[0].name).toBe("test-provider");
        expect(parsed.providers[0].health.online).toBe(true);
    });

    it("reports offline providers", async () => {
        const registry = getProviderRegistry();
        registry.register(createMockProvider("offline-provider", false), {
            enabled: true,
            priority: 1,
            maxConcurrent: 3,
        });

        const result = await handleListProviders({});
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.providers[0].health.online).toBe(false);
    });

    it("includes human-readable summary", async () => {
        const registry = getProviderRegistry();
        registry.register(createMockProvider("my-provider"), {
            enabled: true,
            priority: 2,
            maxConcurrent: 5,
        });

        const result = await handleListProviders({});
        const text = result.content![0].text;
        expect(text).toContain("my-provider");
        expect(text).toContain("online");
    });
});

// ── configure_provider ──────────────────────────────────────────────

describe("handleConfigureProvider", () => {
    it("returns error when provider_name missing", async () => {
        const result = await handleConfigureProvider({});
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.error).toContain("provider_name is required");
    });

    it("returns error when no config file found", async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const result = await handleConfigureProvider({ provider_name: "test" });
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.error).toContain("No providers.json");
    });

    it("returns error for unknown provider", async () => {
        const config = {
            providers: { antigravity: { enabled: true, type: "http", priority: 1, maxConcurrent: 3 } },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

        const result = await handleConfigureProvider({ provider_name: "nonexistent" });
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.error).toContain("Unknown provider");
    });

    it("returns error when no changes specified", async () => {
        const config = {
            providers: { antigravity: { enabled: true, type: "http", priority: 1, maxConcurrent: 3 } },
            routing: { strategy: "priority", fallbackChain: ["antigravity"] },
            rateLimits: { globalMaxConcurrent: 5, globalMaxPerHour: 50 },
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

        const result = await handleConfigureProvider({ provider_name: "antigravity" });
        const parsed = JSON.parse(result.toolResult as string);
        expect(parsed.error).toContain("No changes");
    });
});
