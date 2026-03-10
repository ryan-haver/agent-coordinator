/**
 * Tests for bridge barrel exports (index.ts) and provider interface contracts.
 *
 * Validates:
 *   - Every named export from the barrel resolves to a real value
 *   - Provider interface contracts are structurally correct
 *   - Singleton factories return consistent instances
 *   - Type re-exports don't break at runtime
 */
import { describe, it, expect } from "vitest";

// ════════════════════════════════════════════════════════════════════════
// Barrel export completeness — each module section
// ════════════════════════════════════════════════════════════════════════
describe("Bridge barrel exports — completeness", () => {
    it("exports BridgeClient and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.BridgeClient).toBeDefined();
        expect(typeof mod.getBridgeClient).toBe("function");
    });

    it("exports RateLimiter and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.RateLimiter).toBeDefined();
        expect(typeof mod.getRateLimiter).toBe("function");
    });

    it("exports ErrorDetector and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.ErrorDetector).toBeDefined();
        expect(typeof mod.getErrorDetector).toBe("function");
    });

    it("exports Verifier and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.Verifier).toBeDefined();
        expect(typeof mod.getVerifier).toBe("function");
    });

    it("exports Orchestrator and helpers", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.Orchestrator).toBeDefined();
        expect(typeof mod.getOrchestrator).toBe("function");
        expect(typeof mod.parseManifestPhases).toBe("function");
        expect(typeof mod.buildExecutionPlan).toBe("function");
    });

    it("exports ProviderRegistry and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.ProviderRegistry).toBeDefined();
        expect(typeof mod.getProviderRegistry).toBe("function");
        expect(typeof mod.resetProviderRegistry).toBe("function");
    });

    it("exports AntigravityProvider and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.AntigravityProvider).toBeDefined();
        expect(typeof mod.getAntigravityProvider).toBe("function");
    });

    it("exports ModelCatalog and helpers", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.ModelCatalog).toBeDefined();
        expect(typeof mod.getModelCatalog).toBe("function");
        expect(typeof mod.resetModelCatalog).toBe("function");
        expect(typeof mod.readModelCredits).toBe("function");
    });

    it("exports QuotaMonitor and singleton", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.QuotaMonitor).toBeDefined();
        expect(typeof mod.getQuotaMonitor).toBe("function");
        expect(typeof mod.resetQuotaMonitor).toBe("function");
    });

    it("exports TaskBoard and helpers", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.TaskBoard).toBeDefined();
        expect(typeof mod.getTaskBoard).toBe("function");
        expect(typeof mod.buildTaskBoard).toBe("function");
    });

    it("exports template engine functions", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(typeof mod.getPopulatedPrompt).toBe("function");
        expect(typeof mod.interpolate).toBe("function");
        expect(typeof mod.buildVariableMap).toBe("function");
        expect(typeof mod.getTurnLimit).toBe("function");
        expect(typeof mod.listAvailableRoles).toBe("function");
    });

    it("exports AutoApprover and singletons", async () => {
        const mod = await import("../src/bridge/index.js");
        expect(mod.AutoApprover).toBeDefined();
        expect(mod.LanguageServerClient).toBeDefined();
        expect(typeof mod.getAutoApprover).toBe("function");
        expect(typeof mod.getLanguageServerClient).toBe("function");
    });
});

// ════════════════════════════════════════════════════════════════════════
// Singleton consistency
// ════════════════════════════════════════════════════════════════════════
describe("Bridge barrel exports — singleton consistency", () => {
    it("getBridgeClient returns same instance", async () => {
        const { getBridgeClient } = await import("../src/bridge/index.js");
        const a = getBridgeClient();
        const b = getBridgeClient();
        expect(a).toBe(b);
    });

    it("getOrchestrator returns same instance", async () => {
        const { getOrchestrator } = await import("../src/bridge/index.js");
        const a = getOrchestrator();
        const b = getOrchestrator();
        expect(a).toBe(b);
    });

    it("getAutoApprover returns same instance", async () => {
        const { getAutoApprover } = await import("../src/bridge/index.js");
        const a = getAutoApprover();
        const b = getAutoApprover();
        expect(a).toBe(b);
    });

    it("getLanguageServerClient returns same instance", async () => {
        const { getLanguageServerClient } = await import("../src/bridge/index.js");
        const a = getLanguageServerClient();
        const b = getLanguageServerClient();
        expect(a).toBe(b);
    });
});

// ════════════════════════════════════════════════════════════════════════
// Provider interface — structural contract validation
// ════════════════════════════════════════════════════════════════════════
describe("Provider interface contracts", () => {
    it("AntigravityProvider satisfies AgentProvider shape", async () => {
        const { AntigravityProvider } = await import("../src/bridge/index.js");
        const provider = new AntigravityProvider();

        // Required readonly properties
        expect(typeof provider.name).toBe("string");
        expect(provider.name).toBe("antigravity");
        expect(typeof provider.displayName).toBe("string");
        expect(Array.isArray(provider.models)).toBe(true);
        expect(Array.isArray(provider.capabilities)).toBe(true);

        // Required methods
        expect(typeof provider.ping).toBe("function");
        expect(typeof provider.spawn).toBe("function");
        expect(typeof provider.getAgentStatus).toBe("function");
        expect(typeof provider.listSessions).toBe("function");
        expect(typeof provider.stop).toBe("function");
    });

    it("AntigravityProvider has expected capabilities", async () => {
        const { AntigravityProvider } = await import("../src/bridge/index.js");
        const provider = new AntigravityProvider();

        // Should advertise standard capabilities
        expect(provider.capabilities).toContain("file-edit");
        expect(provider.capabilities).toContain("terminal");
    });

    it("AntigravityProvider has non-empty models list", async () => {
        const { AntigravityProvider } = await import("../src/bridge/index.js");
        const provider = new AntigravityProvider();
        expect(provider.models.length).toBeGreaterThan(0);
    });

    it("ProviderRegistry can register AntigravityProvider", async () => {
        const { ProviderRegistry, AntigravityProvider } = await import("../src/bridge/index.js");
        const registry = new ProviderRegistry();
        const provider = new AntigravityProvider();

        registry.register(provider, { enabled: true, priority: 1, maxConcurrent: 5 });

        const registered = registry.listProviders();
        expect(registered).toHaveLength(1);
        expect(registered[0].name).toBe("antigravity");
        expect(registered[0].enabled).toBe(true);
    });

    it("ProviderRegistry.select returns matching provider", async () => {
        const { ProviderRegistry, AntigravityProvider } = await import("../src/bridge/index.js");
        const registry = new ProviderRegistry();
        const provider = new AntigravityProvider();

        registry.register(provider, { enabled: true, priority: 1, maxConcurrent: 5 });

        const selection = registry.selectProvider({ capabilities: ["file-edit"] });
        expect(selection).not.toBeNull();
        expect(selection!.provider.name).toBe("antigravity");
    });

    it("ProviderRegistry.select returns null for unmet requirements", async () => {
        const { ProviderRegistry, AntigravityProvider } = await import("../src/bridge/index.js");
        const registry = new ProviderRegistry();
        const provider = new AntigravityProvider();

        registry.register(provider, { enabled: true, priority: 1, maxConcurrent: 5 });

        const selection = registry.selectProvider({ capabilities: ["quantum-teleportation"] });
        expect(selection).toBeNull();
    });
});
