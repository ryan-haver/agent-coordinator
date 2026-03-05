/**
 * Scope expansion tool handlers: request_scope_expansion, grant_scope_expansion, deny_scope_expansion
 *
 * Uses StorageAdapter for manifest and progress operations.
 */
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import { getStorage } from "../storage/singleton.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString
} from "../utils/manifest.js";

export async function handleRequestScopeExpansion(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, file_path, reason } = args as any;
    if (!agent_id || !file_path || !reason) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);

    let progress = storage.readAgentProgress(wsRoot, agent_id);
    if (!progress) {
        progress = {
            agent_id,
            role: "unknown",
            phase: "0",
            status: "⏳ Pending",
            detail: "",
            session_id: sessionId,
            file_claims: [],
            issues: [],
            handoff_notes: "",
            last_updated: new Date().toISOString()
        };
    }
    progress.issues.push({
        severity: "🟠 SCOPE_REQUEST",
        area: file_path,
        description: `Scope expansion requested: ${reason}`
    });
    const ts = new Date().toISOString().slice(0, 19);
    progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_REQUEST] ${agent_id} requests access to ${file_path}: ${reason}`;
    storage.writeAgentProgress(wsRoot, progress);

    return { toolResult: `Scope expansion requested`, content: [{ type: "text", text: `${agent_id} requested scope expansion for ${file_path}. PM/Coordinator will see this in get_swarm_status.` }] };
}

export async function handleGrantScopeExpansion(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, file_path } = args as any;
    if (!agent_id || !file_path) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    await storage.withManifestLock(wsRoot, (md) => {
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

    let progress = storage.readAgentProgress(wsRoot, agent_id);
    if (progress) {
        for (const issue of progress.issues) {
            if (issue.severity?.includes('SCOPE_REQUEST') && issue.area === file_path) {
                issue.severity = "✅ SCOPE_GRANTED";
            }
        }
        const ts = new Date().toISOString().slice(0, 19);
        progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_GRANTED] ${agent_id} approved for ${file_path}`;
        storage.writeAgentProgress(wsRoot, progress);
    }

    return { toolResult: `Scope expansion granted`, content: [{ type: "text", text: `${agent_id} granted access to ${file_path}. Scope updated in manifest.` }] };
}

export async function handleDenyScopeExpansion(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, file_path, reason } = args as any;
    if (!agent_id || !file_path) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    let progress = storage.readAgentProgress(wsRoot, agent_id);
    if (progress) {
        for (const issue of progress.issues) {
            if (issue.severity?.includes('SCOPE_REQUEST') && issue.area === file_path) {
                issue.severity = "❌ SCOPE_DENIED";
                issue.description = `${issue.description} [DENIED: ${reason || 'No reason given'}]`;
            }
        }
        const ts = new Date().toISOString().slice(0, 19);
        progress.handoff_notes = (progress.handoff_notes || '') + `\n[${ts}] [SCOPE_DENIED] ${agent_id} denied for ${file_path}: ${reason || 'No reason'}`;
        storage.writeAgentProgress(wsRoot, progress);
    }

    return { toolResult: `Scope expansion denied`, content: [{ type: "text", text: `${agent_id} denied access to ${file_path}. Reason: ${reason || 'No reason given'}` }] };
}
