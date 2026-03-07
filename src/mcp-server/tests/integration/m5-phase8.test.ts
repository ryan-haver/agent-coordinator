/**
 * Phase 8 Integration Tests — Dashboard, Routing & Notifications.
 *
 * Part A: Runs locally (no external services required).
 * Validates get_dashboard_data, configure_notifications,
 * send_notification, and get_routing_recommendation through
 * real MCP Server+Client via InMemoryTransport.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServer, TestServer } from "./helpers/server.js";
import { createFixture, Fixture } from "./helpers/fixtures.js";
import fs from "fs";
import path from "path";
import os from "os";

let server: TestServer;
let fixture: Fixture;

const CONFIG_DIR = path.join(os.homedir(), '.antigravity-configs');
const NOTIFICATION_CONFIG_PATH = path.join(CONFIG_DIR, 'notification_config.json');

// Backup and restore notification config around tests
let originalNotificationConfig: string | null = null;

beforeEach(async () => {
    fixture = createFixture("m5-");
    server = await createTestServer(fixture.tmpDir, { backend: "file" });

    // Backup existing notification config
    try {
        if (fs.existsSync(NOTIFICATION_CONFIG_PATH)) {
            originalNotificationConfig = fs.readFileSync(NOTIFICATION_CONFIG_PATH, 'utf8');
        }
    } catch { /* no config to backup */ }
    // Clear notifications for clean test
    try { fs.writeFileSync(NOTIFICATION_CONFIG_PATH, '[]', 'utf8'); } catch { /* ignore */ }
});

afterEach(async () => {
    await server.close();
    fixture.cleanup();

    // Restore original notification config
    try {
        if (originalNotificationConfig !== null) {
            fs.writeFileSync(NOTIFICATION_CONFIG_PATH, originalNotificationConfig, 'utf8');
        } else if (fs.existsSync(NOTIFICATION_CONFIG_PATH)) {
            fs.unlinkSync(NOTIFICATION_CONFIG_PATH);
        }
    } catch { /* ignore */ }
    originalNotificationConfig = null;
});

// ── Tool registration ────────────────────────────────────────────────

describe("Phase 8 tool registration", () => {
    it("all 4 Phase 8 tools are registered", async () => {
        const tools = await server.listTools();
        expect(tools).toContain("get_dashboard_data");
        expect(tools).toContain("get_routing_recommendation");
        expect(tools).toContain("configure_notifications");
        expect(tools).toContain("send_notification");
        expect(tools.length).toBeGreaterThanOrEqual(45);
    });
});

// ── Dashboard ────────────────────────────────────────────────────────

describe("get_dashboard_data", () => {
    it("returns valid JSON with all expected sections", async () => {
        const result = await server.callTool("get_dashboard_data", {});
        expect(result.isError).toBe(false);

        // The response text includes both a human-readable summary and JSON
        expect(result.text).toContain("Dashboard Snapshot");
        expect(result.text).toContain("Active swarms:");
        expect(result.text).toContain("Total tool calls:");

        // Parse JSON from the response
        const jsonStart = result.text.indexOf('{');
        const data = JSON.parse(result.text.slice(jsonStart));

        expect(data).toHaveProperty("swarms");
        expect(data).toHaveProperty("telemetry");
        expect(data).toHaveProperty("quota");
        expect(data).toHaveProperty("file_conflicts");
        expect(data).toHaveProperty("recent_events");
        expect(data).toHaveProperty("timestamp");

        expect(Array.isArray(data.swarms)).toBe(true);
        expect(data.telemetry).toHaveProperty("total_calls");
        expect(data.telemetry).toHaveProperty("failure_rate_pct");
        expect(Array.isArray(data.file_conflicts)).toBe(true);
        expect(Array.isArray(data.recent_events)).toBe(true);
    });

    it("telemetry section has numeric values", async () => {
        const result = await server.callTool("get_dashboard_data", {});
        const jsonStart = result.text.indexOf('{');
        const data = JSON.parse(result.text.slice(jsonStart));

        expect(typeof data.telemetry.total_calls).toBe("number");
        expect(typeof data.telemetry.avg_duration_ms).toBe("number");
        expect(typeof data.telemetry.total_failures).toBe("number");
        expect(typeof data.telemetry.active_agents).toBe("number");
        expect(typeof data.telemetry.failure_rate_pct).toBe("number");
    });
});

// ── Notifications ────────────────────────────────────────────────────

describe("configure_notifications", () => {
    it("list returns empty array initially", async () => {
        const result = await server.callTool("configure_notifications", { action: "list" });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("No notification webhooks configured");
    });

    it("add creates a webhook config", async () => {
        const result = await server.callTool("configure_notifications", {
            action: "add",
            url: "https://hooks.example.com/test",
            events: ["swarm_complete", "agent_failed"],
            format: "slack",
            label: "Test Hook"
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("Added webhook: Test Hook");
        expect(result.text).toContain("slack");

        // Verify it persisted
        const list = await server.callTool("configure_notifications", { action: "list" });
        expect(list.text).toContain("hooks.example.com");
        expect(list.text).toContain("swarm_complete");
    });

    it("remove deletes a webhook config by index", async () => {
        await server.callTool("configure_notifications", {
            action: "add", url: "https://hooks.example.com/a", format: "json"
        });
        await server.callTool("configure_notifications", {
            action: "add", url: "https://hooks.example.com/b", format: "discord"
        });

        const remove = await server.callTool("configure_notifications", { action: "remove", index: 0 });
        expect(remove.isError).toBe(false);
        expect(remove.text).toContain("Removed webhook");

        const list = await server.callTool("configure_notifications", { action: "list" });
        expect(list.text).not.toContain("hooks.example.com/a");
        expect(list.text).toContain("hooks.example.com/b");
    });

    it("clear removes all configs", async () => {
        await server.callTool("configure_notifications", {
            action: "add", url: "https://hooks.example.com/c", format: "json"
        });
        const clear = await server.callTool("configure_notifications", { action: "clear" });
        expect(clear.text).toContain("cleared");

        const list = await server.callTool("configure_notifications", { action: "list" });
        expect(list.text).toContain("No notification webhooks configured");
    });

    it("add without url returns error", async () => {
        const result = await server.callTool("configure_notifications", { action: "add" });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("url is required");
    });

    it("remove with invalid index returns error", async () => {
        const result = await server.callTool("configure_notifications", { action: "remove", index: 99 });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("Invalid index");
    });
});

describe("send_notification", () => {
    it("returns 'no matching webhooks' when none configured", async () => {
        const result = await server.callTool("send_notification", {
            event: "test_event",
            message: "Hello from tests"
        });
        expect(result.isError).toBe(false);
        expect(result.text).toContain("No matching webhooks");
    });

    it("returns error when message is missing", async () => {
        const result = await server.callTool("send_notification", { event: "test" });
        expect(result.isError).toBe(true);
        expect(result.text).toContain("message is required");
    });
});

// ── Routing Recommendation ───────────────────────────────────────────

describe("get_routing_recommendation", () => {
    it("returns recommendation with fallback chain", async () => {
        const result = await server.callTool("get_routing_recommendation", {});
        expect(result.isError).toBe(false);

        // Should contain routing info even if model_fallback.json isn't found at CWD
        expect(result.text).toMatch(/Routing Recommendation|No model_fallback/);
    });

    it("accepts task_type parameter", async () => {
        const result = await server.callTool("get_routing_recommendation", {
            task_type: "deep_debugging"
        });
        expect(result.isError).toBe(false);
        // Either routes by task type or reports no fallback config found
        expect(result.text).toMatch(/deep_debugging|No model_fallback/);
    });
});
