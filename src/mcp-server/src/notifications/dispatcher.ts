/**
 * Notification dispatcher — push events to external webhooks.
 *
 * Supports Slack, Discord, and raw JSON formats.
 * Config stored at ~/.antigravity-configs/notification_config.json
 */
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_PATH = path.join(os.homedir(), '.antigravity-configs', 'notification_config.json');

export interface WebhookConfig {
    url: string;
    events: string[];        // "swarm_complete", "agent_failed", "phase_advance", "*"
    format: "slack" | "discord" | "json";
    label?: string;          // friendly name
}

interface NotificationPayload {
    event: string;
    message: string;
    timestamp: string;
    data?: object;
}

/**
 * Read notification configs from disk.
 */
export function loadConfigs(): WebhookConfig[] {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return [];
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return [];
    }
}

/**
 * Save notification configs to disk.
 */
export function saveConfigs(configs: WebhookConfig[]): void {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

/**
 * Format payload for the target platform.
 */
function formatPayload(config: WebhookConfig, payload: NotificationPayload): object {
    switch (config.format) {
        case "slack":
            return {
                text: `[${payload.event}] ${payload.message}`,
                blocks: [
                    { type: "header", text: { type: "plain_text", text: payload.event } },
                    { type: "section", text: { type: "mrkdwn", text: payload.message } },
                    { type: "context", elements: [{ type: "mrkdwn", text: `_${payload.timestamp}_` }] }
                ]
            };
        case "discord":
            return {
                content: `**${payload.event}**`,
                embeds: [{
                    title: payload.event,
                    description: payload.message,
                    timestamp: payload.timestamp,
                    color: payload.event.includes("failed") ? 0xff0000 : 0x00ff00
                }]
            };
        case "json":
        default:
            return payload;
    }
}

/**
 * Emit a notification to all matching webhook configs.
 * Fire-and-forget: errors are logged, never thrown.
 */
export async function emitNotification(event: string, message: string, data?: object): Promise<number> {
    const configs = loadConfigs();
    const matching = configs.filter(c =>
        c.events.includes("*") || c.events.includes(event)
    );

    if (matching.length === 0) return 0;

    const payload: NotificationPayload = {
        event,
        message,
        timestamp: new Date().toISOString(),
        data
    };

    let sent = 0;
    for (const config of matching) {
        try {
            const body = formatPayload(config, payload);
            await fetch(config.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(5000)
            });
            sent++;
        } catch (e: any) {
            console.error(`[notifications] Failed to send to ${config.label ?? config.url}: ${e.message}`);
        }
    }

    return sent;
}
