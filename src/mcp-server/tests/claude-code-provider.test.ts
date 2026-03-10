/**
 * Claude Code Provider Tests — unit tests with injectable execFile.
 *
 * Uses the _execFile constructor injection to avoid needing to mock
 * child_process at the ESM module level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { ClaudeCodeProvider, resetClaudeCodeProvider } from "../src/bridge/claude-code-provider.js";
import type { SpawnFn } from "../src/bridge/claude-code-provider.js";

vi.mock("fs", () => ({
    default: {
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
}));

/**
 * Creates a fake spawn that returns a mock child process with the given PID.
 * The close event is not emitted automatically, simulating a running process.
 */
function createMockSpawn(pid: number | undefined): SpawnFn {
    return ((_cmd: string, _args: unknown, _opts: unknown) => {
        const mockProcess: any = new EventEmitter();
        mockProcess.pid = pid;
        mockProcess.unref = vi.fn();
        mockProcess.exitCode = null;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        return mockProcess as ChildProcess;
    }) as unknown as SpawnFn;
}

/**
 * Creates a fake spawn that immediately invokes its callback.
 */
function createCallbackSpawn(
    err: Error | null,
    stdout: string,
    stderr: string,
): SpawnFn {
    return ((_cmd: string, _args: unknown, _opts: unknown) => {
        const mockProcess: any = new EventEmitter();
        mockProcess.pid = 1234;
        mockProcess.unref = vi.fn();
        mockProcess.exitCode = err ? 1 : 0;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        
        setTimeout(() => {
            if (err) {
                mockProcess.emit("error", err);
            }
            if (stdout) mockProcess.stdout.emit("data", stdout);
            if (stderr) mockProcess.stderr.emit("data", stderr);
            mockProcess.emit("close", mockProcess.exitCode);
        }, 10);
        
        return mockProcess as ChildProcess;
    }) as unknown as SpawnFn;
}

let provider: ClaudeCodeProvider;
let mockSpawn: ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetClaudeCodeProvider();
    mockSpawn = vi.fn(createMockSpawn(9999));
    provider = new ClaudeCodeProvider({
        command: "claude",
        _spawn: mockSpawn as unknown as SpawnFn,
    });
});

afterEach(() => {
    resetClaudeCodeProvider();
});

// ── Interface compliance ────────────────────────────────────────────

describe("ClaudeCodeProvider interface", () => {
    it("has correct name", () => {
        expect(provider.name).toBe("claude-code");
    });

    it("has correct displayName", () => {
        expect(provider.displayName).toBe("Claude Code (CLI)");
    });

    it("exposes supported models", () => {
        expect(provider.models).toContain("claude-sonnet-4-20250514");
        expect(provider.models).toContain("claude-opus-4-20250514");
    });

    it("exposes capabilities", () => {
        expect(provider.capabilities).toContain("file-edit");
        expect(provider.capabilities).toContain("terminal");
        expect(provider.capabilities).toContain("mcp");
        expect(provider.capabilities).toContain("git");
    });

    it("implements all AgentProvider methods", () => {
        expect(typeof provider.ping).toBe("function");
        expect(typeof provider.spawn).toBe("function");
        expect(typeof provider.getAgentStatus).toBe("function");
        expect(typeof provider.listSessions).toBe("function");
        expect(typeof provider.stop).toBe("function");
    });
});

// ── ping() ──────────────────────────────────────────────────────────

describe("ping()", () => {
    it("returns online when claude --version succeeds", async () => {
        const p = new ClaudeCodeProvider({
            command: "claude",
            _spawn: createCallbackSpawn(null, "claude-code 1.0.0\n", ""),
        });

        const health = await p.ping();
        expect(health.online).toBe(true);
        expect(health.latencyMs).toBeGreaterThanOrEqual(0);
        expect(health.version).toBe("claude-code 1.0.0");
    });

    it("returns offline when CLI not found", async () => {
        const p = new ClaudeCodeProvider({
            command: "claude",
            _spawn: createCallbackSpawn(
                new Error("ENOENT: command not found"),
                "",
                "",
            ),
        });

        const health = await p.ping();
        expect(health.online).toBe(false);
        expect(health.error).toContain("not found");
    });

    it("calls claude --version", async () => {
        const _spawn = vi.fn(createCallbackSpawn(null, "1.0.0", ""));
        const p = new ClaudeCodeProvider({
            command: "claude",
            _spawn: _spawn as unknown as SpawnFn,
        });

        await p.ping();
        expect(_spawn).toHaveBeenCalledWith(
            "claude",
            ["--version"],
            expect.any(Object)
        );
    });
});

// ── spawn() ─────────────────────────────────────────────────────────

describe("spawn()", () => {
    it("builds correct CLI args and returns PID", async () => {
        const result = await provider.spawn("Test prompt", {
            newConversation: true,
            background: true,
        });

        expect(result.success).toBe(true);
        expect(result.conversationId).toBe("9999");
        expect(result.promptLength).toBe("Test prompt".length);

        // Verify CLI args
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toBe("claude");
        const args = call[1] as string[];
        expect(args).toContain("--print");
        expect(args).toContain("json");
        expect(args).toContain("-p");
        expect(args).toContain("Test prompt");
    });

    it("returns failure when PID is undefined", async () => {
        const p = new ClaudeCodeProvider({
            command: "claude",
            _spawn: createMockSpawn(undefined),
        });

        const result = await p.spawn("Test prompt");
        expect(result.success).toBe(false);
        expect(result.error).toContain("Failed to spawn");
    });

    it("respects custom config", async () => {
        const _spawn = vi.fn(createMockSpawn(8888));
        const p = new ClaudeCodeProvider({
            command: "/usr/local/bin/claude",
            maxTurns: 10,
            allowedTools: "Edit,Write",
            _spawn: _spawn as unknown as SpawnFn,
        });

        await p.spawn("Custom prompt");

        const call = _spawn.mock.calls[0];
        expect(call[0]).toBe("/usr/local/bin/claude");
        const args = call[1] as string[];
        expect(args).toContain("10"); // maxTurns
        expect(args).toContain("Edit,Write"); // allowedTools
    });
});

// ── getAgentStatus() ────────────────────────────────────────────────

describe("getAgentStatus()", () => {
    it("returns unknown for untracked session", async () => {
        const status = await provider.getAgentStatus("nonexistent");
        expect(status.state).toBe("unknown");
        expect(status.error).toContain("No session");
    });

    it("returns running for active session", async () => {
        await provider.spawn("Active prompt");

        // Mock process.kill(pid, 0) to indicate process is running
        const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

        const status = await provider.getAgentStatus("9999");
        expect(status.state).toBe("running");
        expect(status.conversationId).toBe("9999");

        killSpy.mockRestore();
    });
});

// ── listSessions() ──────────────────────────────────────────────────

describe("listSessions()", () => {
    it("returns empty array initially", async () => {
        const sessions = await provider.listSessions();
        expect(sessions).toEqual([]);
    });

    it("returns tracked sessions after spawn", async () => {
        await provider.spawn("Session test");

        const sessions = await provider.listSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].conversationId).toBe("9999");
        expect(sessions[0].state).toBe("running");
    });
});

// ── stop() ──────────────────────────────────────────────────────────

describe("stop()", () => {
    it("does nothing for unknown session", async () => {
        await expect(provider.stop("nonexistent")).resolves.toBeUndefined();
    });

    it("marks session as failed after stop", async () => {
        await provider.spawn("Stop test");

        // Mock process.kill to indicate process is NOT running (throws on signal 0)
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
            throw new Error("ESRCH: no such process");
        });

        await provider.stop("9999");

        const status = await provider.getAgentStatus("9999");
        expect(status.state).toBe("failed");

        killSpy.mockRestore();
    });
});

// ── Barrel exports ──────────────────────────────────────────────────

describe("barrel exports claude-code-provider", () => {
    it("re-exports from bridge barrel", async () => {
        const barrel = await import("../src/bridge/index.js");
        expect(barrel.ClaudeCodeProvider).toBeDefined();
        expect(barrel.getClaudeCodeProvider).toBeDefined();
        expect(barrel.resetClaudeCodeProvider).toBeDefined();
    });
});

// ── Provider loader integration ─────────────────────────────────────

describe("provider-loader creates ClaudeCodeProvider", () => {
    it("createProvider returns ClaudeCodeProvider for claude-code", async () => {
        const { createProvider } = await import("../src/bridge/provider-loader.js");
        const p = createProvider("claude-code", {
            enabled: true,
            type: "cli",
            command: "claude",
            priority: 2,
            maxConcurrent: 2,
        });
        expect(p).not.toBeNull();
        expect(p!.name).toBe("claude-code");
    });
});
