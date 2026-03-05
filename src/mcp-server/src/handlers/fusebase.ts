/**
 * Fusebase sync tool handlers: log_fusebase_pending, sync_fusebase_pending, get_fusebase_sync_status
 */
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import {
    appendPendingWrite,
    resolvePendingWrite,
    getPendingSummary
} from "../utils/fusebase-sync.js";

export async function handleLogFusebasePending(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = args?.action as string;
    if (!action) throw new Error("Missing required argument: action");
    const localFile = args?.local_file as string;
    if (!localFile) throw new Error("Missing required argument: local_file");
    const rootDir = resolveWorkspaceRoot(args);

    if (action === "resolve") {
        const resolved = await resolvePendingWrite(rootDir, localFile);
        return {
            content: [{
                type: "text", text: resolved
                    ? `Resolved pending write for ${localFile}`
                    : `No pending write found for ${localFile}`
            }]
        };
    } else {
        const agentId = (args?.agent_id as string) || "unknown";
        const fusebasePage = (args?.fusebase_page as string) || "";
        const fusebaseFolderId = (args?.fusebase_folder_id as string) || "";
        const error = (args?.error as string) || "Unknown error";

        await appendPendingWrite(rootDir, {
            agent_id: agentId,
            local_file: localFile,
            fusebase_page: fusebasePage,
            fusebase_folder_id: fusebaseFolderId,
            failed_at: new Date().toISOString(),
            error: error
        });

        return {
            content: [{ type: "text", text: `Logged pending Fusebase write: ${fusebasePage} (local: ${localFile}). Will be retried at next phase gate or swarm completion.` }]
        };
    }
}

export async function handleSyncFusebasePending(args: Record<string, unknown>): Promise<ToolResponse> {
    const rootDir = resolveWorkspaceRoot(args);
    const agentFilter = args?.agent_id as string | undefined;
    const summary = getPendingSummary(rootDir);

    let items = summary.items;
    if (agentFilter) {
        items = items.filter(w => w.agent_id === agentFilter);
    }

    if (items.length === 0) {
        return {
            content: [{ type: "text", text: "No pending Fusebase writes to sync." }]
        };
    }

    const itemList = items.map((w, i) =>
        `${i + 1}. [${w.agent_id}] ${w.fusebase_page} ← ${w.local_file} (failed: ${w.failed_at}, retries: ${w.retries}, error: ${w.error})`
    ).join("\n");

    return {
        content: [{ type: "text", text: `Pending Fusebase writes (${items.length}):\n${itemList}\n\nFor each item: 1) Read the local file, 2) Write to Fusebase page, 3) Call log_fusebase_pending with action='resolve' and local_file to clear it.` }]
    };
}

export async function handleGetFusebaseSyncStatus(args: Record<string, unknown>): Promise<ToolResponse> {
    const rootDir = resolveWorkspaceRoot(args);
    const summary = getPendingSummary(rootDir);

    if (summary.total === 0) {
        return {
            content: [{ type: "text", text: "✅ All Fusebase writes are in sync. No pending items." }]
        };
    }

    const agentBreakdown = Object.entries(summary.by_agent)
        .map(([agent, count]) => `  ${agent}: ${count} pending`)
        .join("\n");

    return {
        content: [{ type: "text", text: `⚠️ ${summary.total} pending Fusebase write(s):\n${agentBreakdown}\n\nRun sync_fusebase_pending to get the list and retry each one.` }]
    };
}
