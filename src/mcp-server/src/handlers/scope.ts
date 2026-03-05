/**
 * Scope expansion tool handlers: request_scope_expansion, grant_scope_expansion, deny_scope_expansion
 */
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString,
    readManifest,
    withManifestLock
} from "../utils/manifest.js";
import {
    readAgentProgress,
    writeAgentProgress,
    createAgentProgress,
    extractSessionId
} from "../utils/agent-progress.js";

export async function handleRequestScopeExpansion(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, file_path, reason } = args as any;
    if (!agent_id || !file_path || !reason) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const md = readManifest(wsRoot);
    const sessionId = extractSessionId(md);

    let progress = readAgentProgress(wsRoot, agent_id);
    if (!progress) {
        progress = createAgentProgress(agent_id, "unknown", "0", sessionId);
    }
    progress.issues.push({
        severity: "🟠 SCOPE_REQUEST",
        area: file_path,
        description: `Scope expansion requested: ${reason}`
    });
    const ts = new Date().toISOString().slice(0, 19);
    progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_REQUEST] ${agent_id} requests access to ${file_path}: ${reason}`;
    writeAgentProgress(wsRoot, progress);

    return { toolResult: `Scope expansion requested`, content: [{ type: "text", text: `${agent_id} requested scope expansion for ${file_path}. PM/Coordinator will see this in get_swarm_status.` }] };
}

export async function handleGrantScopeExpansion(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, file_path } = args as any;
    if (!agent_id || !file_path) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);

    await withManifestLock(wsRoot, (md) => {
        const agentsTable = getTableFromSection(md, "Agents");
        if (agentsTable) {
            const row = agentsTable.rows.find(r => r["ID"] === agent_id);
            if (row) {
                const currentScope = row["Scope"] || '';
                row["Scope"] = currentScope ? `${currentScope}, ${file_path}` : file_path;
                const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
                return { content: updated || md, result: null };
            }
        }
        return { content: null, result: null };
    });

    let progress = readAgentProgress(wsRoot, agent_id);
    if (progress) {
        for (const issue of progress.issues) {
            if (issue.severity?.includes('SCOPE_REQUEST') && issue.area === file_path) {
                issue.severity = "✅ SCOPE_GRANTED";
            }
        }
        const ts = new Date().toISOString().slice(0, 19);
        progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_GRANTED] ${agent_id} approved for ${file_path}`;
        writeAgentProgress(wsRoot, progress);
    }

    return { toolResult: `Scope expansion granted`, content: [{ type: "text", text: `${agent_id} granted access to ${file_path}. Scope updated in manifest.` }] };
}

export async function handleDenyScopeExpansion(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, file_path, reason } = args as any;
    if (!agent_id || !file_path) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);

    let progress = readAgentProgress(wsRoot, agent_id);
    if (progress) {
        for (const issue of progress.issues) {
            if (issue.severity?.includes('SCOPE_REQUEST') && issue.area === file_path) {
                issue.severity = "❌ SCOPE_DENIED";
                issue.description = `${issue.description} [DENIED: ${reason || 'No reason given'}]`;
            }
        }
        const ts = new Date().toISOString().slice(0, 19);
        progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_DENIED] ${agent_id} denied for ${file_path}: ${reason || 'No reason'}`;
        writeAgentProgress(wsRoot, progress);
    }

    return { toolResult: `Scope expansion denied`, content: [{ type: "text", text: `${agent_id} denied access to ${file_path}. Reason: ${reason || 'No reason given'}` }] };
}
