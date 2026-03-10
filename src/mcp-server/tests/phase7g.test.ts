/**
 * Tests for Phase 7G: AutoApprover and LanguageServerClient.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    AutoApprover,
    LanguageServerClient,
    type InteractionApproval,
} from "../src/bridge/auto-approver.js";

// ════════════════════════════════════════════════════════════════════════
// LanguageServerClient
// ════════════════════════════════════════════════════════════════════════
describe("LanguageServerClient", () => {
    it("starts with no connection", () => {
        const client = new LanguageServerClient();
        expect(client.getConnection()).toBeNull();
    });

    it("disconnect clears connection", () => {
        const client = new LanguageServerClient();
        client.disconnect();
        expect(client.getConnection()).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// AutoApprover — lifecycle
// ════════════════════════════════════════════════════════════════════════
describe("AutoApprover — lifecycle", () => {
    let approver: AutoApprover;
    let mockClient: LanguageServerClient;

    beforeEach(() => {
        mockClient = new LanguageServerClient();
        approver = new AutoApprover(mockClient, { pollIntervalMs: 50 });
    });

    afterEach(() => {
        approver.stop();
    });

    it("starts in stopped state", () => {
        const status = approver.getStatus();
        expect(status.running).toBe(false);
        expect(status.trackedCascades).toBe(0);
        expect(status.totalApprovals).toBe(0);
    });

    it("start sets running to true", () => {
        approver.start();
        expect(approver.getStatus().running).toBe(true);
    });

    it("stop sets running to false", () => {
        approver.start();
        approver.stop();
        expect(approver.getStatus().running).toBe(false);
    });

    it("double start is idempotent", () => {
        approver.start();
        approver.start();
        expect(approver.getStatus().running).toBe(true);
    });

    it("stop clears tracked cascades", () => {
        approver.trackCascade("c1");
        approver.trackCascade("c2");
        expect(approver.getStatus().trackedCascades).toBe(2);
        approver.stop();
        expect(approver.getStatus().trackedCascades).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// AutoApprover — cascade tracking
// ════════════════════════════════════════════════════════════════════════
describe("AutoApprover — cascade tracking", () => {
    let approver: AutoApprover;

    beforeEach(() => {
        approver = new AutoApprover(new LanguageServerClient(), { pollIntervalMs: 50, maxCascades: 3 });
    });

    afterEach(() => {
        approver.stop();
    });

    it("tracks cascades", () => {
        approver.trackCascade("c1");
        expect(approver.isTracked("c1")).toBe(true);
        expect(approver.isTracked("c2")).toBe(false);
    });

    it("untracks cascades", () => {
        approver.trackCascade("c1");
        approver.untrackCascade("c1");
        expect(approver.isTracked("c1")).toBe(false);
    });

    it("evicts oldest cascade when maxCascades exceeded", () => {
        approver.trackCascade("c1");
        approver.trackCascade("c2");
        approver.trackCascade("c3");
        // At max, adding c4 should evict c1
        approver.trackCascade("c4");
        expect(approver.isTracked("c1")).toBe(false);
        expect(approver.isTracked("c4")).toBe(true);
        expect(approver.getStatus().trackedCascades).toBe(3);
    });
});

// ════════════════════════════════════════════════════════════════════════
// AutoApprover — approval logic
// ════════════════════════════════════════════════════════════════════════
describe("AutoApprover — approve()", () => {
    let approver: AutoApprover;
    let mockClient: LanguageServerClient;

    beforeEach(() => {
        mockClient = new LanguageServerClient();
        approver = new AutoApprover(mockClient);
    });

    afterEach(() => {
        approver.stop();
    });

    it("returns error when file writes are disabled", async () => {
        approver.updateConfig({ approveFileWrites: false });
        const interaction: InteractionApproval = {
            cascadeId: "c1",
            trajectoryId: "t1",
            stepIndex: 0,
            type: "filePermission",
            target: "/path/to/file.ts",
        };
        const result = await approver.approve(interaction);
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled");
    });

    it("returns error when commands are disabled", async () => {
        approver.updateConfig({ approveCommands: false });
        const interaction: InteractionApproval = {
            cascadeId: "c1",
            trajectoryId: "t1",
            stepIndex: 0,
            type: "runCommand",
            target: "npm test",
        };
        const result = await approver.approve(interaction);
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled");
    });

    it("logs approvals", async () => {
        // Mock the client methods to avoid actual network calls
        vi.spyOn(mockClient, "approveFilePermission").mockResolvedValue({});
        
        const interaction: InteractionApproval = {
            cascadeId: "c1",
            trajectoryId: "t1",
            stepIndex: 0,
            type: "filePermission",
            target: "/path/to/file.ts",
        };
        await approver.approve(interaction);
        const log = approver.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].cascadeId).toBe("c1");
        expect(log[0].type).toBe("filePermission");
        expect(log[0].success).toBe(true);
    });

    it("handles approval errors gracefully", async () => {
        vi.spyOn(mockClient, "approveCommand").mockRejectedValue(new Error("RPC failed"));

        const interaction: InteractionApproval = {
            cascadeId: "c1",
            trajectoryId: "t1",
            stepIndex: 0,
            type: "runCommand",
            target: "rm -rf /",
        };
        const result = await approver.approve(interaction);
        expect(result.success).toBe(false);
        expect(result.error).toContain("RPC failed");
        expect(approver.getLog()).toHaveLength(1);
    });
});

// ════════════════════════════════════════════════════════════════════════
// AutoApprover — config
// ════════════════════════════════════════════════════════════════════════
describe("AutoApprover — config", () => {
    it("uses default config", () => {
        const approver = new AutoApprover(new LanguageServerClient());
        const status = approver.getStatus();
        expect(status.config.pollIntervalMs).toBe(2000);
        expect(status.config.approveFileWrites).toBe(true);
        expect(status.config.approveCommands).toBe(true);
        expect(status.config.maxCascades).toBe(20);
        approver.stop();
    });

    it("accepts partial config overrides", () => {
        const approver = new AutoApprover(new LanguageServerClient(), {
            pollIntervalMs: 500,
            approveCommands: false,
        });
        const status = approver.getStatus();
        expect(status.config.pollIntervalMs).toBe(500);
        expect(status.config.approveCommands).toBe(false);
        expect(status.config.approveFileWrites).toBe(true); // default preserved
        approver.stop();
    });

    it("updateConfig merges correctly", () => {
        const approver = new AutoApprover(new LanguageServerClient());
        approver.updateConfig({ pollIntervalMs: 100 });
        expect(approver.getStatus().config.pollIntervalMs).toBe(100);
        expect(approver.getStatus().config.approveFileWrites).toBe(true); // preserved
        approver.stop();
    });
});
