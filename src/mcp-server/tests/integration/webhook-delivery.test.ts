/**
 * Webhook live delivery integration test.
 *
 * Spins up an ephemeral HTTP server, configures a webhook pointing
 * at it, sends a notification, and verifies the payload arrives.
 * 
 * Tests all 3 format modes: json, slack, discord.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { emitNotification, loadConfigs, saveConfigs, type WebhookConfig } from "../../src/notifications/dispatcher.js";

const CONFIG_DIR = path.join(os.homedir(), '.antigravity-configs');
const CONFIG_PATH = path.join(CONFIG_DIR, 'notification_config.json');

let originalConfig: string | null = null;

/** Create a one-shot HTTP server that captures the first POST body. */
function createCaptureServer(): Promise<{
    server: http.Server;
    port: number;
    getPayload: () => Promise<object>;
}> {
    return new Promise((resolve) => {
        let capturedResolve: (val: object) => void;
        const payloadPromise = new Promise<object>((r) => { capturedResolve = r; });

        const server = http.createServer((req, res) => {
            if (req.method === "POST") {
                let body = "";
                req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                req.on("end", () => {
                    res.writeHead(200);
                    res.end("OK");
                    try {
                        capturedResolve(JSON.parse(body));
                    } catch {
                        capturedResolve({ raw: body });
                    }
                });
            } else {
                res.writeHead(405);
                res.end();
            }
        });

        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as { port: number };
            resolve({
                server,
                port: addr.port,
                getPayload: () => payloadPromise
            });
        });
    });
}

beforeEach(() => {
    // Backup existing config
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            originalConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
        }
    } catch { /* ignore */ }
});

afterEach(() => {
    // Restore original config
    try {
        if (originalConfig !== null) {
            fs.writeFileSync(CONFIG_PATH, originalConfig, 'utf8');
        } else if (fs.existsSync(CONFIG_PATH)) {
            fs.unlinkSync(CONFIG_PATH);
        }
    } catch { /* ignore */ }
    originalConfig = null;
});

// ── Live webhook delivery ────────────────────────────────────────────

describe("Webhook live delivery", () => {
    it("delivers JSON payload to a real HTTP endpoint", async () => {
        const { server, port, getPayload } = await createCaptureServer();

        try {
            const config: WebhookConfig[] = [{
                url: `http://127.0.0.1:${port}/hook`,
                events: ["*"],
                format: "json",
                label: "test-json"
            }];
            saveConfigs(config);

            const sent = await emitNotification("test_event", "Hello from live test", { key: "value" });
            expect(sent).toBe(1);

            const payload = await getPayload() as any;
            expect(payload.event).toBe("test_event");
            expect(payload.message).toBe("Hello from live test");
            expect(payload.timestamp).toBeTruthy();
            expect(payload.data).toEqual({ key: "value" });
        } finally {
            server.close();
        }
    });

    it("delivers Slack-formatted payload with blocks", async () => {
        const { server, port, getPayload } = await createCaptureServer();

        try {
            saveConfigs([{
                url: `http://127.0.0.1:${port}/slack`,
                events: ["*"],
                format: "slack",
                label: "test-slack"
            }]);

            const sent = await emitNotification("swarm_complete", "All agents done");
            expect(sent).toBe(1);

            const payload = await getPayload() as any;
            expect(payload.text).toContain("[swarm_complete]");
            expect(payload.text).toContain("All agents done");
            expect(payload.blocks).toBeDefined();
            expect(payload.blocks.length).toBe(3);
            expect(payload.blocks[0].type).toBe("header");
            expect(payload.blocks[1].type).toBe("section");
            expect(payload.blocks[2].type).toBe("context");
        } finally {
            server.close();
        }
    });

    it("delivers Discord-formatted payload with embeds", async () => {
        const { server, port, getPayload } = await createCaptureServer();

        try {
            saveConfigs([{
                url: `http://127.0.0.1:${port}/discord`,
                events: ["agent_failed"],
                format: "discord",
                label: "test-discord"
            }]);

            const sent = await emitNotification("agent_failed", "Agent-2 crashed");
            expect(sent).toBe(1);

            const payload = await getPayload() as any;
            expect(payload.content).toContain("agent_failed");
            expect(payload.embeds).toBeDefined();
            expect(payload.embeds[0].title).toBe("agent_failed");
            expect(payload.embeds[0].description).toBe("Agent-2 crashed");
            expect(payload.embeds[0].color).toBe(0xff0000); // red for "failed" events
        } finally {
            server.close();
        }
    });

    it("skips webhook when event doesn't match", async () => {
        const { server, port } = await createCaptureServer();

        try {
            saveConfigs([{
                url: `http://127.0.0.1:${port}/narrow`,
                events: ["phase_advance"],
                format: "json"
            }]);

            const sent = await emitNotification("swarm_complete", "Should not match");
            expect(sent).toBe(0);
        } finally {
            server.close();
        }
    });

    it("delivers to multiple webhooks", async () => {
        const cap1 = await createCaptureServer();
        const cap2 = await createCaptureServer();

        try {
            saveConfigs([
                { url: `http://127.0.0.1:${cap1.port}/a`, events: ["*"], format: "json" },
                { url: `http://127.0.0.1:${cap2.port}/b`, events: ["*"], format: "slack" }
            ]);

            const sent = await emitNotification("multi_test", "Both should fire");
            expect(sent).toBe(2);

            const p1 = await cap1.getPayload() as any;
            const p2 = await cap2.getPayload() as any;

            expect(p1.event).toBe("multi_test");
            expect(p2.text).toContain("[multi_test]");
        } finally {
            cap1.server.close();
            cap2.server.close();
        }
    });
});
