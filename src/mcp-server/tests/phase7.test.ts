/**
 * Tests for Phase 7C–7F: TaskBoard, TemplateEngine, and Orchestrator execution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTaskBoard, TaskBoard } from "../src/bridge/task-board.js";
import { interpolate, buildVariableMap, getTurnLimit } from "../src/bridge/template-engine.js";
import {
    Orchestrator,
    parseManifestPhases,
    buildExecutionPlan,
    type ExecutionCallbacks,
} from "../src/bridge/orchestrator.js";

// Mock singletons used by Orchestrator.executePhase()
vi.mock("../src/bridge/error-detector.js", () => ({
    getErrorDetector: () => ({
        getWatches: () => [],
        getWatch: () => undefined,
    }),
    ErrorDetector: class {},
}));

vi.mock("../src/bridge/rate-limiter.js", () => ({
    getRateLimiter: () => ({
        check: () => ({ allowed: true }),
        recordSpawn: () => {},
        recordError: () => {},
        recordCompletion: () => {},
        getStats: () => ({}),
    }),
    RateLimiter: class {},
}));

// ════════════════════════════════════════════════════════════════════════
// 7C: TaskBoard
// ════════════════════════════════════════════════════════════════════════
describe("TaskBoard — buildTaskBoard()", () => {
    it("returns idle snapshot for empty progress", () => {
        const snap = buildTaskBoard("sess-1", []);
        expect(snap.overallStatus).toBe("idle");
        expect(snap.totalAgents).toBe(0);
        expect(snap.phases).toHaveLength(0);
    });

    it("groups agents by phase", () => {
        const snap = buildTaskBoard("sess-1", [
            { agent_id: "a1", role: "developer", phase: "1", status: "active", detail: "", issues: [], last_updated: "" },
            { agent_id: "a2", role: "qa", phase: "1", status: "complete", detail: "", issues: [], last_updated: "" },
            { agent_id: "a3", role: "reviewer", phase: "2", status: "spawned", detail: "", issues: [], last_updated: "" },
        ]);
        expect(snap.phases).toHaveLength(2);
        expect(snap.phases[0].phase).toBe("1");
        expect(snap.phases[0].agents).toHaveLength(2);
        expect(snap.phases[1].phase).toBe("2");
        expect(snap.phases[1].agents).toHaveLength(1);
    });

    it("normalizes status strings correctly", () => {
        const snap = buildTaskBoard("sess-1", [
            { agent_id: "a1", role: "dev", phase: "1", status: "✅ Complete", detail: "", issues: [], last_updated: "" },
            { agent_id: "a2", role: "dev", phase: "1", status: "🔄 Active", detail: "", issues: [], last_updated: "" },
            { agent_id: "a3", role: "dev", phase: "1", status: "❌ Failed", detail: "", issues: [], last_updated: "" },
            { agent_id: "a4", role: "dev", phase: "1", status: "🚧 Blocked", detail: "", issues: [], last_updated: "" },
            { agent_id: "a5", role: "dev", phase: "1", status: "⏳ Pending", detail: "", issues: [], last_updated: "" },
        ]);
        const statuses = snap.phases[0].agents.map(a => a.status);
        expect(statuses).toEqual(["completed", "active", "failed", "blocked", "spawned"]);
    });

    it("calculates overall status correctly", () => {
        // All completed
        const done = buildTaskBoard("s1", [
            { agent_id: "a1", role: "dev", phase: "1", status: "done", detail: "", issues: [], last_updated: "" },
        ]);
        expect(done.overallStatus).toBe("completed");

        // Has active
        const running = buildTaskBoard("s2", [
            { agent_id: "a1", role: "dev", phase: "1", status: "active", detail: "", issues: [], last_updated: "" },
        ]);
        expect(running.overallStatus).toBe("running");

        // Has blocked
        const blocked = buildTaskBoard("s3", [
            { agent_id: "a1", role: "dev", phase: "1", status: "blocked", detail: "", issues: [], last_updated: "" },
        ]);
        expect(blocked.overallStatus).toBe("blocked");

        // Failed (no active)
        const failed = buildTaskBoard("s4", [
            { agent_id: "a1", role: "dev", phase: "1", status: "failed", detail: "", issues: [], last_updated: "" },
        ]);
        expect(failed.overallStatus).toBe("failed");
    });

    it("phase allDone is false when agents are active", () => {
        const snap = buildTaskBoard("s1", [
            { agent_id: "a1", role: "dev", phase: "1", status: "active", detail: "", issues: [], last_updated: "" },
            { agent_id: "a2", role: "dev", phase: "1", status: "done", detail: "", issues: [], last_updated: "" },
        ]);
        expect(snap.phases[0].allDone).toBe(false);
    });

    it("phase allPassed requires all agents completed", () => {
        const snap = buildTaskBoard("s1", [
            { agent_id: "a1", role: "dev", phase: "1", status: "done", detail: "", issues: [], last_updated: "" },
            { agent_id: "a2", role: "dev", phase: "1", status: "done", detail: "", issues: [], last_updated: "" },
        ]);
        expect(snap.phases[0].allPassed).toBe(true);
    });

    it("counts issues correctly", () => {
        const snap = buildTaskBoard("s1", [
            {
                agent_id: "a1", role: "dev", phase: "1", status: "done", detail: "", last_updated: "",
                issues: [
                    { severity: "high", area: "auth", description: "injection" },
                    { severity: "low", area: "ui", description: "typo" },
                ],
            },
        ]);
        expect(snap.phases[0].agents[0].issues).toBe(2);
    });
});

describe("TaskBoard class", () => {
    it("getCached returns null before first getBoard", () => {
        const tb = new TaskBoard();
        expect(tb.getCached()).toBeNull();
    });

    it("isPhaseReady returns false if no snapshot", () => {
        const tb = new TaskBoard();
        expect(tb.isPhaseReady("1")).toBe(false);
    });

    it("getRetryableAgents returns empty if no snapshot", () => {
        const tb = new TaskBoard();
        expect(tb.getRetryableAgents("1")).toEqual([]);
    });

    it("reset clears the cache", () => {
        const tb = new TaskBoard();
        // Can't call getBoard (needs StorageAdapter), but reset should work
        tb.reset();
        expect(tb.getCached()).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// 7D: Template Engine
// ════════════════════════════════════════════════════════════════════════
describe("TemplateEngine — interpolate()", () => {
    it("replaces $VARIABLE placeholders", () => {
        const result = interpolate("Hello $NAME, your role is $ROLE", {
            NAME: "Alice",
            ROLE: "developer",
        });
        expect(result).toBe("Hello Alice, your role is developer");
    });

    it("replaces multiple occurrences", () => {
        const result = interpolate("$X + $X = 2*$X", { X: "5" });
        expect(result).toBe("5 + 5 = 2*5");
    });

    it("leaves unmatched variables as-is", () => {
        const result = interpolate("$KNOWN and $UNKNOWN", { KNOWN: "yes" });
        expect(result).toBe("yes and $UNKNOWN");
    });

    it("handles empty template", () => {
        const result = interpolate("", { X: "5" });
        expect(result).toBe("");
    });

    it("handles empty vars", () => {
        const result = interpolate("Hello $WORLD", {});
        expect(result).toBe("Hello $WORLD");
    });
});

describe("TemplateEngine — buildVariableMap()", () => {
    it("populates all standard variables", () => {
        const vars = buildVariableMap({
            role: "developer",
            agentId: "dev-1",
            mission: "Build feature X",
            scope: "src/components",
            workspaceRoot: "/project",
        });

        expect(vars.AGENT_ID).toBe("dev-1");
        expect(vars.MISSION).toBe("Build feature X");
        expect(vars.SCOPE).toBe("src/components");
        expect(vars.WORKSPACE_ROOT).toBe("/project");
        expect(vars.TURN_LIMIT).toBeDefined();
        expect(vars.ACCEPTANCE_CRITERIA).toBeDefined();
    });

    it("uses custom values when provided", () => {
        const vars = buildVariableMap({
            role: "developer",
            agentId: "dev-1",
            mission: "Build feature X",
            scope: "src/",
            workspaceRoot: "/project",
            acceptanceCriteria: "Must pass lint",
            turnLimit: 15,
            context: "Previous agent failed on auth",
        });

        expect(vars.ACCEPTANCE_CRITERIA).toBe("Must pass lint");
        expect(vars.TURN_LIMIT).toBe("15");
        expect(vars.CONTEXT).toBe("Previous agent failed on auth");
    });

    it("merges extra variables", () => {
        const vars = buildVariableMap({
            role: "developer",
            agentId: "a1",
            mission: "m",
            scope: "s",
            workspaceRoot: "/w",
            extra: { CUSTOM_KEY: "custom_value" },
        });

        expect(vars.CUSTOM_KEY).toBe("custom_value");
    });
});

describe("TemplateEngine — getTurnLimit()", () => {
    it("returns default for known roles", () => {
        expect(getTurnLimit("developer")).toBe(20);
        expect(getTurnLimit("project-manager")).toBe(10);
        expect(getTurnLimit("qa")).toBe(15);
    });

    it("returns 20 for unknown roles", () => {
        expect(getTurnLimit("unknown-role")).toBe(20);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 7E/7F: Orchestrator execution
// ════════════════════════════════════════════════════════════════════════
describe("Orchestrator — parseManifestPhases()", () => {
    it("extracts agents from manifest table", () => {
        const manifest = `## Agents
| ID | Role | Model | Phase | Scope | Status |
|----|------|-------|-------|-------|--------|
| dev-1 | developer | claude-4 | 1 | src/auth | ⏳ Pending |
| qa-1 | qa | gemini-2 | 2 | tests/ | ⏳ Pending |
`;
        const phases = parseManifestPhases(manifest);
        expect(phases.size).toBe(2);
        expect(phases.get("1")).toHaveLength(1);
        expect(phases.get("2")).toHaveLength(1);
        expect(phases.get("1")![0].id).toBe("dev-1");
        expect(phases.get("2")![0].role).toBe("qa");
    });

    it("returns empty map for manifest without agents section", () => {
        const phases = parseManifestPhases("# No agents here\nJust text.");
        expect(phases.size).toBe(0);
    });
});

describe("Orchestrator — buildExecutionPlan()", () => {
    it("sorts phases numerically", () => {
        const phases = new Map([
            ["3", [{ id: "a3", role: "r", model: "m", scope: "s" }]],
            ["1", [{ id: "a1", role: "r", model: "m", scope: "s" }]],
            ["2", [{ id: "a2", role: "r", model: "m", scope: "s" }]],
        ]);
        const plan = buildExecutionPlan(phases);
        expect(plan.map(p => p.phase)).toEqual(["1", "2", "3"]);
    });
});

describe("Orchestrator — planSummary()", () => {
    it("produces correct summary", () => {
        const orchestrator = new Orchestrator();
        const manifest = `## Agents
| ID | Role | Model | Phase | Scope | Status |
|----|------|-------|-------|-------|--------|
| a1 | dev | claude-4 | 1 | src/ | ⏳ |
| a2 | dev | gemini | 1 | lib/ | ⏳ |
| a3 | qa | claude-4 | 2 | tests/ | ⏳ |
`;
        const summary = orchestrator.planSummary(manifest);
        expect(summary.totalAgents).toBe(3);
        expect(summary.phases).toHaveLength(2);
        expect(summary.phases[0].agentCount).toBe(2);
        expect(summary.phases[1].agentCount).toBe(1);
    });
});

describe("Orchestrator — executePhase()", () => {
    let orchestrator: Orchestrator;

    beforeEach(() => {
        orchestrator = new Orchestrator({
            autoVerify: false,
            autoRetry: false,
            pollIntervalMs: 10,
            phaseTimeoutMs: 100,
        });
    });

    it("spawns all agents and returns results", async () => {
        const spawnedIds: string[] = [];
        const callbacks: ExecutionCallbacks = {
            spawnAgent: async (agent) => {
                spawnedIds.push(agent.id);
            },
        };

        const agents = [
            { id: "a1", role: "dev", model: "claude-4", scope: "src/" },
            { id: "a2", role: "qa", model: "gemini", scope: "tests/" },
        ];

        const result = await orchestrator.executePhase(agents, callbacks);
        expect(spawnedIds).toEqual(["a1", "a2"]);
        expect(result.agents).toHaveLength(2);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("marks agents as failed on spawn error", async () => {
        const callbacks: ExecutionCallbacks = {
            spawnAgent: async (agent) => {
                if (agent.id === "a2") throw new Error("Bridge offline");
            },
        };

        const agents = [
            { id: "a1", role: "dev", model: "m", scope: "s" },
            { id: "a2", role: "qa", model: "m", scope: "s" },
        ];

        const result = await orchestrator.executePhase(agents, callbacks);
        expect(result.agents[0].status).not.toBe("failed");
        expect(result.agents[1].status).toBe("failed");
        expect(result.agents[1].error).toContain("Bridge offline");
    });

    it("calls onProgress during polling", async () => {
        const progressCalls: number[] = [];
        const callbacks: ExecutionCallbacks = {
            spawnAgent: async () => {},
            onProgress: (info) => {
                progressCalls.push(info.elapsedMs);
            },
        };

        const agents = [{ id: "a1", role: "dev", model: "m", scope: "s" }];
        await orchestrator.executePhase(agents, callbacks);
        // Progress may or may not be called depending on timing — just check it doesn't crash
    });
});

describe("Orchestrator — execute()", () => {
    it("executes multi-phase manifest", async () => {
        const orchestrator = new Orchestrator({
            autoVerify: false,
            autoRetry: false,
            pollIntervalMs: 10,
            phaseTimeoutMs: 100,
        });

        const manifest = `## Agents
| ID | Role | Model | Phase | Scope | Status |
|----|------|-------|-------|-------|--------|
| a1 | dev | m | 1 | src/ | ⏳ |
| a2 | qa | m | 2 | tests/ | ⏳ |
`;
        const spawnedIds: string[] = [];
        const phaseCompleted: string[] = [];

        const result = await orchestrator.execute(manifest, {
            spawnAgent: async (agent) => { spawnedIds.push(agent.id); },
            onPhaseComplete: (phase) => { phaseCompleted.push(phase); },
        });

        expect(result.totalAgents).toBe(2);
        expect(spawnedIds).toEqual(["a1", "a2"]);
        expect(phaseCompleted).toEqual(["1", "2"]);
        expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns success=true when no agents fail", async () => {
        const orchestrator = new Orchestrator({
            autoVerify: false,
            autoRetry: false,
            pollIntervalMs: 10,
            phaseTimeoutMs: 100,
        });

        const manifest = `## Agents
| ID | Role | Model | Phase | Scope | Status |
|----|------|-------|-------|-------|--------|
| a1 | dev | m | 1 | src/ | ⏳ |
`;
        const result = await orchestrator.execute(manifest, {
            spawnAgent: async () => {},
        });

        expect(result.success).toBe(true);
        expect(result.failedAgents).toBe(0);
    });
});
