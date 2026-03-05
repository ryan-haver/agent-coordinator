/**
 * Quota tool handler: check_quota
 */
import path from "path";
import os from "os";
import fs from "fs";
import { type ToolResponse } from "./context.js";

export async function handleCheckQuota(_args: Record<string, unknown>): Promise<ToolResponse> {
    const quotaPath = path.join(os.homedir(), '.antigravity-configs', 'quota_snapshot.json');
    try {
        if (fs.existsSync(quotaPath)) {
            const quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
            return { toolResult: JSON.stringify(quota), content: [{ type: "text", text: JSON.stringify(quota, null, 2) }] };
        }
        return { toolResult: "(No quota snapshot found)", content: [{ type: "text", text: "No quota_snapshot.json found. Run quota_check.ps1 or .sh first." }] };
    } catch (e: any) {
        return { toolResult: `Quota check failed: ${e.message}`, content: [{ type: "text", text: `Error reading quota: ${e.message}` }] };
    }
}
