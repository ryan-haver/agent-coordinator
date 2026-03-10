import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CodexProvider } from "../src/bridge/codex-provider.js";
import type { SpawnFn } from "../src/bridge/codex-provider.js";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import os from "os";

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

describe("CodexProvider", () => {
    let mockSpawn: ReturnType<typeof vi.fn>;
    let provider: CodexProvider;

    beforeEach(() => {
        mockSpawn = vi.fn(createMockSpawn(9999));
        provider = new CodexProvider({ command: "test-codex" }, mockSpawn as unknown as SpawnFn);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should initialize with correct capabilities and models", () => {
        expect(provider.name).toBe("codex");
        expect(provider.models).toContain("o3");
        expect(provider.capabilities).toContain("file-edit");
    });

    it("should ping successfully when cli is available", async () => {
        const spawnFn = createCallbackSpawn(null, "Codex CLI v1.0.0", "");
        provider = new CodexProvider({ command: "test-codex" }, spawnFn);
        
        const health = await provider.ping();
        expect(health.online).toBe(true);
        expect(health.version).toBe("Codex CLI v1.0.0");
    });

    it("should fail ping when cli is missing", async () => {
        const spawnFn = createCallbackSpawn(new Error("ENOENT"), "", "");
        provider = new CodexProvider({ command: "test-codex" }, spawnFn);
        
        const health = await provider.ping();
        expect(health.online).toBe(false);
        expect(health.error).toContain("ENOENT");
    });

    it("should spawn successfully with background false", async () => {
        const result = await provider.spawn("Test codex spawn", {
            background: false
        });
        
        expect(result.success).toBe(true);
        expect(result.conversationId).toBeDefined();
        
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toBe("test-codex");
        expect(call[1]).toContain("Test codex spawn");
    });
});
