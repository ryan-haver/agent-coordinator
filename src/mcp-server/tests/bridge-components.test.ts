/**
 * bridge-components.test.ts — Tests for ProviderRegistry, RateLimiter, ErrorDetector.
 *
 * Pure unit tests — no external services or I/O. Tests the core bridge
 * infrastructure that spawn, routing, and health checking depend on.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProviderRegistry, resetProviderRegistry } from "../src/bridge/registry.js";
import { RateLimiter } from "../src/bridge/rate-limiter.js";
import { ErrorDetector } from "../src/bridge/error-detector.js";
import type { AgentProvider, ProviderConfig, ProviderHealth } from "../src/bridge/provider.js";

// ── Mock Provider ────────────────────────────────────────────────

function createMockProvider(name: string, opts?: {
    models?: string[];
    capabilities?: string[];
}): AgentProvider {
    return {
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        models: opts?.models ?? ["gemini-3-pro"],
        capabilities: opts?.capabilities ?? ["code", "chat"],
        async ping(): Promise<ProviderHealth> {
            return { online: true, latencyMs: 50 };
        },
        async start() { return { conversationId: "conv-123", agentId: name, success: true }; },
        async stop() { return true; },
        async getConversation() { return null; },
        async list() { return []; },
    } as AgentProvider;
}

const DEFAULT_CONFIG: ProviderConfig = {
    enabled: true,
    priority: 1,
    maxConcurrent: 3,
};

// ══════════════════════════════════════════════════════════════════
// ProviderRegistry
// ══════════════════════════════════════════════════════════════════

describe("ProviderRegistry", () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
        resetProviderRegistry();
        registry = new ProviderRegistry();
    });

    describe("register / unregister", () => {
        it("registers a provider", () => {
            registry.register(createMockProvider("alpha"), DEFAULT_CONFIG);
            const list = registry.listProviders();
            expect(list).toHaveLength(1);
            expect(list[0].name).toBe("alpha");
        });

        it("updates config for existing provider", () => {
            registry.register(createMockProvider("alpha"), { ...DEFAULT_CONFIG, priority: 1 });
            registry.register(createMockProvider("alpha"), { ...DEFAULT_CONFIG, priority: 5 });
            const list = registry.listProviders();
            expect(list).toHaveLength(1);
            expect(list[0].priority).toBe(5);
        });

        it("unregisters a provider", () => {
            registry.register(createMockProvider("alpha"), DEFAULT_CONFIG);
            const removed = registry.unregister("alpha");
            expect(removed).toBe(true);
            expect(registry.listProviders()).toHaveLength(0);
        });

        it("returns false when unregistering non-existent provider", () => {
            expect(registry.unregister("nonexistent")).toBe(false);
        });
    });

    describe("selectProvider", () => {
        beforeEach(() => {
            registry.register(createMockProvider("alpha", { models: ["gemini-3-pro"] }), { ...DEFAULT_CONFIG, priority: 2 });
            registry.register(createMockProvider("beta", { models: ["claude-sonnet"] }), { ...DEFAULT_CONFIG, priority: 1 });
        });

        it("selects highest-priority provider", () => {
            const selection = registry.selectProvider();
            expect(selection).not.toBeNull();
            expect(selection!.provider.name).toBe("beta"); // priority 1 < 2
        });

        it("selects by explicit provider name", () => {
            const selection = registry.selectProvider({ provider: "alpha" });
            expect(selection).not.toBeNull();
            expect(selection!.provider.name).toBe("alpha");
        });

        it("filters by model", () => {
            const selection = registry.selectProvider({ model: "claude" });
            expect(selection).not.toBeNull();
            expect(selection!.provider.name).toBe("beta");
        });

        it("returns null for unsupported model", () => {
            const selection = registry.selectProvider({ model: "llama-3" });
            expect(selection).toBeNull();
        });

        it("respects capacity limits", () => {
            registry.register(createMockProvider("full"), { enabled: true, priority: 0, maxConcurrent: 1 });
            registry.recordSpawn("full");
            const selection = registry.selectProvider({ provider: "full" });
            expect(selection).toBeNull(); // At capacity
        });

        it("returns null for disabled provider", () => {
            registry.register(createMockProvider("disabled"), { ...DEFAULT_CONFIG, enabled: false });
            const selection = registry.selectProvider({ provider: "disabled" });
            expect(selection).toBeNull();
        });

        it("filters by capabilities", () => {
            registry.register(createMockProvider("special", { capabilities: ["code", "image-gen"] }), DEFAULT_CONFIG);
            const selection = registry.selectProvider({ capabilities: ["image-gen"] });
            expect(selection).not.toBeNull();
            expect(selection!.provider.name).toBe("special");
        });
    });

    describe("active count tracking", () => {
        it("records spawns and completions", () => {
            registry.register(createMockProvider("alpha"), DEFAULT_CONFIG);
            registry.recordSpawn("alpha");
            expect(registry.getActiveCount("alpha")).toBe(1);
            registry.recordCompletion("alpha");
            expect(registry.getActiveCount("alpha")).toBe(0);
        });

        it("completion does not go below zero", () => {
            registry.register(createMockProvider("alpha"), DEFAULT_CONFIG);
            registry.recordCompletion("alpha");
            expect(registry.getActiveCount("alpha")).toBe(0);
        });

        it("getTotalActiveCount sums all providers", () => {
            registry.register(createMockProvider("a"), DEFAULT_CONFIG);
            registry.register(createMockProvider("b"), DEFAULT_CONFIG);
            registry.recordSpawn("a");
            registry.recordSpawn("b");
            registry.recordSpawn("b");
            expect(registry.getTotalActiveCount()).toBe(3);
        });

        it("resetCounts clears all", () => {
            registry.register(createMockProvider("a"), DEFAULT_CONFIG);
            registry.recordSpawn("a");
            registry.resetCounts();
            expect(registry.getActiveCount("a")).toBe(0);
        });
    });

    describe("getDefault", () => {
        it("returns highest-priority enabled provider", () => {
            registry.register(createMockProvider("alpha"), { ...DEFAULT_CONFIG, priority: 5 });
            registry.register(createMockProvider("beta"), { ...DEFAULT_CONFIG, priority: 1 });
            const def = registry.getDefault();
            expect(def).not.toBeNull();
            expect(def!.name).toBe("beta");
        });

        it("returns null when no providers registered", () => {
            expect(registry.getDefault()).toBeNull();
        });
    });

    describe("pingAll", () => {
        it("pings all providers", async () => {
            registry.register(createMockProvider("alpha"), DEFAULT_CONFIG);
            registry.register(createMockProvider("beta"), DEFAULT_CONFIG);
            const results = await registry.pingAll();
            expect(results.size).toBe(2);
            expect(results.get("alpha")?.online).toBe(true);
            expect(results.get("beta")?.online).toBe(true);
        });
    });

    describe("clear", () => {
        it("removes all providers", () => {
            registry.register(createMockProvider("a"), DEFAULT_CONFIG);
            registry.register(createMockProvider("b"), DEFAULT_CONFIG);
            registry.clear();
            expect(registry.listProviders()).toHaveLength(0);
        });
    });
});

// ══════════════════════════════════════════════════════════════════
// RateLimiter
// ══════════════════════════════════════════════════════════════════

describe("RateLimiter", () => {
    let limiter: RateLimiter;

    beforeEach(() => {
        limiter = new RateLimiter({ cooldownMs: 100, maxConcurrent: 3, maxPerHour: 30 });
    });

    describe("check", () => {
        it("allows initial spawn", () => {
            // On first check, no cooldown applies (lastSpawnTime is 0)
            const result = limiter.check();
            expect(result.allowed).toBe(true);
        });

        it("blocks when at concurrent limit", () => {
            limiter.recordSpawn();
            limiter.recordSpawn();
            limiter.recordSpawn();
            const result = limiter.check();
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Concurrent limit");
        });

        it("allows after completion frees slot", async () => {
            limiter.recordSpawn();
            limiter.recordSpawn();
            limiter.recordSpawn();
            limiter.recordCompletion();
            // Wait for cooldown to pass
            await new Promise((r) => setTimeout(r, 150));
            const result = limiter.check();
            expect(result.allowed).toBe(true);
        });
    });

    describe("recordError / backoff", () => {
        it("entering error state triggers backoff", () => {
            limiter.recordError();
            const stats = limiter.getStats();
            expect(stats.consecutiveErrors).toBe(1);
            expect(stats.backoffMs).toBeGreaterThan(0);
        });

        it("consecutive errors increase backoff", () => {
            limiter.recordError();
            const b1 = limiter.getStats().backoffMs;
            limiter.recordError();
            const b2 = limiter.getStats().backoffMs;
            // With cooldownMs=100 and backoffMultiplier=2:
            // b1 = 100 * 2^1 = 200, b2 = 100 * 2^2 = 400
            expect(b2).toBeGreaterThanOrEqual(b1);
            expect(b2).toBeGreaterThan(0);
        });

        it("successful spawn resets error state", () => {
            limiter.recordError();
            limiter.recordError();
            // Bypass cooldown
            limiter.recordSpawn();
            const stats = limiter.getStats();
            expect(stats.consecutiveErrors).toBe(0);
            expect(stats.backoffMs).toBe(0);
        });
    });

    describe("getStats", () => {
        it("returns correct structure", () => {
            const stats = limiter.getStats();
            expect(stats).toHaveProperty("activeCount");
            expect(stats).toHaveProperty("spawnsThisHour");
            expect(stats).toHaveProperty("consecutiveErrors");
            expect(stats).toHaveProperty("backoffMs");
            expect(stats).toHaveProperty("config");
            expect(stats.config.maxConcurrent).toBe(3);
        });
    });

    describe("setActiveCount", () => {
        it("overrides active count", () => {
            limiter.setActiveCount(5);
            const stats = limiter.getStats();
            expect(stats.activeCount).toBe(5);
        });

        it("clamps to zero", () => {
            limiter.setActiveCount(-3);
            expect(limiter.getStats().activeCount).toBe(0);
        });
    });

    describe("updateConfig", () => {
        it("updates config at runtime", () => {
            limiter.updateConfig({ maxConcurrent: 10 });
            expect(limiter.getStats().config.maxConcurrent).toBe(10);
        });
    });
});

// ══════════════════════════════════════════════════════════════════
// ErrorDetector
// ══════════════════════════════════════════════════════════════════

describe("ErrorDetector", () => {
    let detector: ErrorDetector;

    beforeEach(() => {
        detector = new ErrorDetector({ pollIntervalMs: 60_000, maxRetries: 3 });
    });

    afterEach(() => {
        detector.dispose();
    });

    describe("watchAgent / unwatchAgent", () => {
        it("starts watching an agent", () => {
            detector.watchAgent("agent-1", "conv-1", "alpha");
            const watches = detector.getWatches();
            expect(watches).toHaveLength(1);
            expect(watches[0].agentId).toBe("agent-1");
            expect(watches[0].status).toBe("running");
        });

        it("stops watching when unwatched", () => {
            detector.watchAgent("agent-1", "conv-1", "alpha");
            detector.unwatchAgent("agent-1");
            expect(detector.getWatches()).toHaveLength(0);
        });
    });

    describe("shouldRetry", () => {
        it("recommends retry when attempts remain", () => {
            detector.watchAgent("agent-1", "conv-1", "alpha", 1);
            const decision = detector.shouldRetry("agent-1");
            expect(decision.retry).toBe(true);
            expect(decision.attempt).toBe(2);
            expect(decision.delay).toBeGreaterThan(0);
        });

        it("no retry for unwatched agent", () => {
            const decision = detector.shouldRetry("nonexistent");
            expect(decision.retry).toBe(false);
            expect(decision.reason).toContain("not being watched");
        });

        it("no retry when max retries exhausted", () => {
            detector.watchAgent("agent-1", "conv-1", "alpha", 3); // already at max
            const decision = detector.shouldRetry("agent-1");
            expect(decision.retry).toBe(false);
            expect(decision.reason).toContain("Max retries");
        });

        it("uses exponential backoff for delays", () => {
            detector.watchAgent("agent-1", "conv-1", "alpha", 1);
            const d1 = detector.shouldRetry("agent-1");
            detector.watchAgent("agent-2", "conv-2", "alpha", 2);
            const d2 = detector.shouldRetry("agent-2");
            expect(d2.delay).toBeGreaterThan(d1.delay);
        });
    });

    describe("containsError (static)", () => {
        it("detects known error patterns", () => {
            expect(ErrorDetector.containsError("Agent terminated unexpectedly")).toBe(true);
            expect(ErrorDetector.containsError("Error: something went wrong")).toBe(true);
            expect(ErrorDetector.containsError("context window exceeded")).toBe(true);
            expect(ErrorDetector.containsError("rate limit reached")).toBe(true);
            expect(ErrorDetector.containsError("RESOURCE_EXHAUSTED")).toBe(true);
        });

        it("returns false for clean text", () => {
            expect(ErrorDetector.containsError("Task completed successfully")).toBe(false);
            expect(ErrorDetector.containsError("Processing your request")).toBe(false);
        });

        it("is case-insensitive", () => {
            expect(ErrorDetector.containsError("QUOTA EXCEEDED")).toBe(true);
            expect(ErrorDetector.containsError("connection RESET")).toBe(true);
        });
    });

    describe("getWatch", () => {
        it("returns specific watch", () => {
            detector.watchAgent("agent-1", "conv-1", "alpha");
            const w = detector.getWatch("agent-1");
            expect(w).toBeDefined();
            expect(w!.conversationId).toBe("conv-1");
        });

        it("returns undefined for unknown agent", () => {
            expect(detector.getWatch("unknown")).toBeUndefined();
        });
    });

    describe("dispose", () => {
        it("clears all watches and stops polling", () => {
            detector.watchAgent("a", "c1", "alpha");
            detector.watchAgent("b", "c2", "alpha");
            detector.dispose();
            expect(detector.getWatches()).toHaveLength(0);
        });
    });
});
