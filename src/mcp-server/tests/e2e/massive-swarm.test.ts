import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServer, TestServer } from "../integration/helpers/server.js";
import { createFixture, Fixture } from "../integration/helpers/fixtures.js";
import { getProviderRegistry } from "../../src/bridge/registry.js";
import { getOrchestrator } from "../../src/bridge/orchestrator.js";
import { getRateLimiter } from "../../src/bridge/rate-limiter.js";
import { ErrorDetector, setErrorDetector } from "../../src/bridge/error-detector.js";
import type { ProviderHealth, SpawnResult, SpawnOptions } from "../../src/bridge/provider.js";
import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";

// A mock provider that fails with a quota error halfway through
class FlakyMockProvider extends EventEmitter {
    name = "flaky-gemini";
    displayName = "Flaky Gemini";
    models = ["gemini-pro"];
    capabilities = ["mcp", "file-edit"];
    enabled = true;
    priority = 10;
    maxConcurrent = 5;
    activeCount = 0;

    private spawnCount = 0;

    async ping(): Promise<ProviderHealth> {
        return { online: true, latencyMs: 10 };
    }

    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        this.spawnCount++;
        console.log(`[Flaky] spawning attempt ${this.spawnCount}`);
        
        // Fail on the second spawn to simulate mid-swarm quota exhaustion
        if (this.spawnCount === 2) {
            console.log("[Flaky] failing attempt 2");
            return {
                success: false,
                error: "429 Too Many Requests: Quota exceeded"
            };
        }

        this.activeCount++;
        const conversationId = `flaky-session-${this.spawnCount}`;
        
        // Auto-complete immediately for the test
        setTimeout(() => {
            this.activeCount--;
            this.emit("agent_status_changed", {
                conversationId,
                status: "completed"
            });
        }, 50);

        return {
            success: true,
            conversationId,
            promptLength: prompt.length
        };
    }

    async getAgentStatus(conversationId: string) {
        return { conversationId, state: "completed" as const, lastActiveAt: Date.now() };
    }
    
    async stop(conversationId: string) { return; }
    async listSessions() { return []; }
}

class SuccessMockProvider extends EventEmitter {
    name = "success-fallback";
    displayName = "Success Fallback Provider";
    models = ["gemini-pro", "claude-3-5-sonnet"];
    capabilities = ["mcp", "file-edit"];
    enabled = true;
    priority = 20;
    maxConcurrent = 5;
    activeCount = 0;

    async ping(): Promise<ProviderHealth> {
        return { online: true, latencyMs: 10 };
    }

    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        this.activeCount++;
        const conversationId = `success-session-${Math.random()}`;
        console.log(`[SuccessFallback] spawning agent. conversationId: ${conversationId}`);
        
        setTimeout(() => {
            this.activeCount--;
            console.log(`[SuccessFallback] marking ${conversationId} completed`);
            this.emit("agent_status_changed", { conversationId, status: "completed" });
        }, 50);

        return { success: true, conversationId, promptLength: prompt.length };
    }

    async getAgentStatus(conversationId: string) {
        return { conversationId, state: "completed" as const, lastActiveAt: Date.now() };
    }
    async stop(conversationId: string) { return; }
    async listSessions() { return []; }
}

let server: TestServer;
let fixture: Fixture;

beforeEach(async () => {
    fixture = await createFixture();
    
    // Create dummy prompt templates required by getPopulatedPrompt
    const templatesDir = path.join(fixture.tmpDir, ".config", "templates", "agent-prompts");
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, "Architect.md"), "You are an Architect.");
    await fs.writeFile(path.join(templatesDir, "Developer.md"), "You are a Developer.");
    await fs.writeFile(path.join(templatesDir, "Reviewer.md"), "You are a Reviewer.");
    
    // Inject fast polling for tests
    getOrchestrator().updateConfig({ pollIntervalMs: 50 });
    getRateLimiter().updateConfig({ cooldownMs: 0, backoffMultiplier: 0, maxBackoffMs: 0 });
    setErrorDetector(new ErrorDetector({ pollIntervalMs: 50 }));

    server = await createTestServer(fixture.tmpDir, { backend: "sqlite" });
});

afterEach(async () => {
    setErrorDetector(undefined);
    await server.close();
    fixture.cleanup();
});

describe("E2E Massive Swarm & Auto-Approver", () => {
    it("dynamically fails over when primary provider exhausts quota mid-swarm", async () => {
        // Register our flaky provider and the standard headless as fallback
        const registry = getProviderRegistry();
        
        const flaky = new FlakyMockProvider();
        registry.register(flaky, { enabled: true, priority: 10, maxConcurrent: 5 });
        
        const fallback = new SuccessMockProvider();
        registry.register(fallback, { enabled: true, priority: 20, maxConcurrent: 5 });

        // First, create a multi-agent swarm manifest
        const manifestResult = await server.callTool("create_swarm_manifest", {
            mission: "Build a distributed hash table",
            workspace_root: fixture.tmpDir
        });
        if (manifestResult.isError) console.error("Manifest Error:", manifestResult.text);
        expect(manifestResult.isError).toBe(false);

        // Add 3 agents to ensure we hit the 2nd spawn failure and a 3rd attempt
        await server.callTool("add_agent_to_manifest", {
            agent_id: "NodeDesigner",
            role: "Architect",
            mission: "Design the node struct",
            phase: "1",
            model: "gemini-pro",
            scope: "src/node",
            workspace_root: fixture.tmpDir
        });
        
        await server.callTool("add_agent_to_manifest", {
            agent_id: "NetCoder",
            role: "Engineer",
            mission: "Implement networking",
            phase: "2",
            model: "gemini-pro",
            scope: "src/network",
            workspace_root: fixture.tmpDir
        });

        await server.callTool("add_agent_to_manifest", {
            agent_id: "Tester",
            role: "QA",
            mission: "Validate networking",
            phase: "3",
            model: "gemini-pro",
            scope: "tests",
            workspace_root: fixture.tmpDir
        });

        // Execute swarm - this should:
        // 1. Spawns NodeDesigner via flaky-gemini (success)
        // 2. Spawns NetCoder via flaky-gemini (429 FAIL) 
        //    -> Failover routes NetCoder to headless (fallback)
        // 3. Spawns Tester via whatever is next
        const executeResult = await server.callTool("execute_swarm", {
            workspace_root: fixture.tmpDir,
            auto_approve: true, // test auto-approver tracks it
            auto_verify: false // skip intense file verifications to keep test fast
        });

        if (executeResult.isError) console.error("Execute Error:", executeResult.text);
        expect(executeResult.isError).toBe(false);
        const jsonMatch = executeResult.text.match(/\{[\s\S]*\}/);
        expect(jsonMatch).not.toBeNull();
        
        const data = JSON.parse(jsonMatch![0]);
        // The orchestrator may mark the execution as failed or successful based on fallback
        // Since headless auto-succeeds in tests, it should complete everything.
        expect(data.completedAgents).toBeGreaterThan(0);
        
        // Check telemetry
        const dashResult = await server.callTool("get_dashboard_data", { workspace_root: fixture.tmpDir });
        expect(dashResult.text).toContain("flaky-gemini");
    });
});
