import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeadlessProvider } from "../src/bridge/headless-provider.js";

describe("HeadlessProvider", () => {
    let mockFetch: any;
    let provider: HeadlessProvider;

    beforeEach(() => {
        mockFetch = vi.fn();
        provider = new HeadlessProvider({
            endpoint: "http://localhost:11434/v1",
            apiKey: "test-key",
            defaultModel: "llama3"
        }, mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should initialize with correct models", () => {
        expect(provider.name).toBe("headless");
        expect(provider.models).toEqual(["llama3"]);
        expect(provider.capabilities).toContain("chat");
    });

    it("should ping successfully when endpoint responds ok", async () => {
        mockFetch.mockResolvedValue({ ok: true });
        const health = await provider.ping();
        expect(health.online).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/v1/models", {
            headers: { "Authorization": "Bearer test-key" }
        });
    });

    it("should fail ping when endpoint returns non-ok", async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 404 });
        const health = await provider.ping();
        expect(health.online).toBe(false);
        expect(health.error).toContain("404");
    });

    it("should spawn and register a session", async () => {
        mockFetch.mockResolvedValue({ ok: true });
        const result = await provider.spawn("Hello world");
        expect(result.success).toBe(true);
        expect(result.conversationId).toMatch(/^headless-/);

        // check session status
        const status = await provider.getAgentStatus(result.conversationId!);
        // Since runBackground is async and not awaited by spawn directly, it might still be running or completed depending on microtask timing
        expect(["running", "completed"]).toContain(status.state);
        expect(status.conversationId).toBe(result.conversationId);
    });

    it("should return unknown status for missing session", async () => {
        const status = await provider.getAgentStatus("fake-id");
        expect(status.state).toBe("unknown");
    });

    it("should list active sessions", async () => {
        mockFetch.mockResolvedValue({ ok: true });
        const res1 = await provider.spawn("Prompt 1");
        const res2 = await provider.spawn("Prompt 2");
        
        const sessions = await provider.listSessions();
        expect(sessions.length).toBe(2);
        expect(sessions.map(s => s.conversationId)).toContain(res1.conversationId);
        expect(sessions.map(s => s.conversationId)).toContain(res2.conversationId);
    });

    it("should stop a session", async () => {
        mockFetch.mockResolvedValue({ ok: true });
        const res = await provider.spawn("Prompt");
        await provider.stop(res.conversationId!);
        const status = await provider.getAgentStatus(res.conversationId!);
        expect(status.state).toBe("stopped");
    });
});
