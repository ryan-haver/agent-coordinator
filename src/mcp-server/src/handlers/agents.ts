/**
 * Agent tool handlers: update_agent_status, add_agent_to_manifest, mark_agent_failed,
 * reassign_agent, get_my_assignment, get_agent_progress, remove_agent_from_manifest,
 * update_agent_in_manifest, get_agent_prompt
 *
 * Uses StorageAdapter for all manifest and progress operations.
 */
import path from "path";
import fs from "fs";
import { resolveWorkspaceRoot, globalConfigPath, type ToolResponse } from "./context.js";
import { getStorage } from "../storage/singleton.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString
} from "../utils/manifest.js";

export async function handleUpdateAgentStatus(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const status = args?.status as string;
    if (!agent_id || !status) throw new Error("Missing required arguments: agent_id, status");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    let progress = storage.readAgentProgress(wsRoot, agent_id);
    if (!progress) {
        const md = storage.readManifest(wsRoot);
        const sessionId = storage.extractSessionId(md);
        const agent = storage.getAgent(wsRoot, agent_id);
        progress = {
            agent_id,
            role: agent?.role || "unknown",
            phase: agent?.phase || "1",
            status: "⏳ Pending",
            detail: "",
            session_id: sessionId,
            file_claims: [],
            issues: [],
            handoff_notes: "",
            last_updated: new Date().toISOString()
        };
    }
    progress.status = status;
    const detail = args?.detail as string | undefined;
    if (detail) progress.detail = detail;
    const phase = args?.phase as string | undefined;
    if (phase) progress.phase = phase;
    storage.writeAgentProgress(wsRoot, progress);

    return { toolResult: `Agent ${agent_id} status updated to ${status}`, content: [{ type: "text", text: `Agent ${agent_id} status updated to ${status}${detail ? ` (${detail})` : ''} (written to agent progress file)` }] };
}

export async function handleAddAgentToManifest(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, role, model, phase, scope } = args as any;
    if (!agent_id || !role || !model || !phase || !scope) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    await storage.withManifestLock(wsRoot, (md) => {
        const agentsTable = getTableFromSection(md, "Agents");
        if (!agentsTable) throw new Error("No ## Agents table found in manifest");
        if (agentsTable.rows.some(r => r["ID"] === agent_id)) {
            throw new Error(`Agent ${agent_id} already exists in the manifest`);
        }
        agentsTable.rows.push({ "ID": agent_id, "Role": role, "Model": model, "Phase": phase, "Scope": scope, "Status": "⏳ Pending" });
        const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
        return { content: updated || md, result: agentsTable.rows.length };
    });

    try {
        const agents = storage.listAgents(wsRoot);
        await storage.updateSwarmRegistry(wsRoot, { agents_total: agents.length });
    } catch { /* non-fatal */ }

    return { toolResult: `Agent ${agent_id} added`, content: [{ type: "text", text: `Added agent ${agent_id} (${role}) to Phase ${phase}` }] };
}

export async function handleMarkAgentFailed(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, reason } = args as any;
    if (!agent_id || !reason) throw new Error("Missing required arguments");
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
    progress.status = "❌ Failed";
    progress.detail = reason;

    const releasedFiles: string[] = [];
    for (const claim of progress.file_claims) {
        if (claim.status !== "✅ Done") {
            claim.status = "⚠️ Abandoned";
            releasedFiles.push(claim.file);
        }
    }

    const timestamp = new Date().toISOString().slice(0, 19);
    const failNote = `[${timestamp}] [SYSTEM] Agent ${agent_id} failed: ${reason}. Released files: ${releasedFiles.join(", ") || "none"}`;
    progress.handoff_notes = progress.handoff_notes ? progress.handoff_notes + '\n' + failNote : failNote;
    storage.writeAgentProgress(wsRoot, progress);

    try {
        await storage.withManifestLock(wsRoot, (mdUpdated) => {
            const agentsTable = getTableFromSection(mdUpdated, "Agents");
            if (agentsTable) {
                const row = agentsTable.rows.find(r => r["ID"] === agent_id);
                if (row) row["Status"] = "❌ Failed";
                const t = replaceTableInSection(mdUpdated, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
                return { content: t || mdUpdated, result: null };
            }
            return { content: null, result: null };
        });
    } catch { /* non-fatal */ }

    // Clean up lock files
    try {
        const lockFiles = fs.readdirSync(wsRoot).filter(f => f.startsWith('.claim-lock-'));
        for (const lf of lockFiles) {
            const content = fs.readFileSync(path.join(wsRoot, lf), 'utf8');
            if (content.trim() === agent_id) {
                fs.unlinkSync(path.join(wsRoot, lf));
            }
        }
    } catch { /* non-fatal */ }

    return { toolResult: `Agent ${agent_id} marked as failed`, content: [{ type: "text", text: `Agent ${agent_id} marked ❌ Failed. Released ${releasedFiles.length} file claims. Reason: ${reason}` }] };
}

export async function handleReassignAgent(args: Record<string, unknown>): Promise<ToolResponse> {
    const { from_agent_id, to_agent_id, to_role, to_model } = args as any;
    if (!from_agent_id || !to_agent_id) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const fromProgress = storage.readAgentProgress(wsRoot, from_agent_id);
    const pendingClaims = fromProgress?.file_claims.filter(c => c.status !== "✅ Done") || [];

    const { newRow, sessionId } = await storage.withManifestLock(wsRoot, (md) => {
        const sid = storage.extractSessionId(md);
        const agentsTable = getTableFromSection(md, "Agents");
        if (!agentsTable) throw new Error("No Agents table in manifest");
        const fromRow = agentsTable.rows.find(r => r["ID"] === from_agent_id);
        if (!fromRow) throw new Error(`Agent ${from_agent_id} not found in manifest`);

        const nr = {
            "ID": to_agent_id,
            "Role": to_role || fromRow["Role"],
            "Model": to_model || fromRow["Model"],
            "Phase": fromRow["Phase"],
            "Scope": fromRow["Scope"],
            "Status": "⏳ Pending"
        };
        agentsTable.rows.push(nr);
        fromRow["Status"] = "🔄 Reassigned → " + to_agent_id;
        const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
        return { content: updated || md, result: { newRow: nr, sessionId: sid } };
    });

    const newProgress = {
        agent_id: to_agent_id,
        role: newRow["Role"],
        phase: newRow["Phase"],
        status: "⏳ Pending",
        detail: `Reassigned from ${from_agent_id}`,
        session_id: sessionId,
        file_claims: pendingClaims.map(c => ({ file: c.file, status: "📋 Transferred" })),
        issues: [],
        handoff_notes: `Reassigned from ${from_agent_id}. Pending files: ${pendingClaims.map(c => c.file).join(", ") || "none"}`,
        last_updated: new Date().toISOString()
    };
    storage.writeAgentProgress(wsRoot, newProgress);

    if (fromProgress) {
        const ts = new Date().toISOString().slice(0, 19);
        fromProgress.handoff_notes = (fromProgress.handoff_notes || '') + `\n[${ts}] [SYSTEM] ${from_agent_id} reassigned to ${to_agent_id}`;
        storage.writeAgentProgress(wsRoot, fromProgress);
    }

    return { toolResult: `Reassigned ${from_agent_id} → ${to_agent_id}`, content: [{ type: "text", text: `Reassigned ${from_agent_id} → ${to_agent_id}. Transferred ${pendingClaims.length} pending file claims.` }] };
}

export async function handleGetMyAssignment(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id } = args as any;
    if (!agent_id) throw new Error("Missing required argument: agent_id");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const agent = storage.getAgent(wsRoot, agent_id);
    if (!agent) throw new Error(`Agent ${agent_id} not found in manifest`);

    return { toolResult: JSON.stringify(agent), content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
}

export async function handleGetAgentProgress(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id } = args as any;
    if (!agent_id) throw new Error("Missing required argument: agent_id");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const progress = storage.readAgentProgress(wsRoot, agent_id);
    if (!progress) throw new Error(`No progress file found for agent ${agent_id}`);

    return { toolResult: JSON.stringify(progress), content: [{ type: "text", text: JSON.stringify(progress, null, 2) }] };
}

export async function handleRemoveAgentFromManifest(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id } = args as any;
    if (!agent_id) throw new Error("Missing required argument: agent_id");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    await storage.withManifestLock(wsRoot, (md) => {
        const agentsTable = getTableFromSection(md, "Agents");
        if (!agentsTable) throw new Error("No Agents table in manifest");
        const idx = agentsTable.rows.findIndex(r => r["ID"] === agent_id);
        if (idx === -1) throw new Error(`Agent ${agent_id} not found in manifest`);
        agentsTable.rows.splice(idx, 1);
        const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
        return { content: updated || md, result: agentsTable.rows.length };
    });

    try {
        const agents = storage.listAgents(wsRoot);
        await storage.updateSwarmRegistry(wsRoot, { agents_total: agents.length });
    } catch { /* non-fatal */ }

    return { toolResult: `Agent ${agent_id} removed`, content: [{ type: "text", text: `Removed agent ${agent_id} from manifest` }] };
}

export async function handleUpdateAgentInManifest(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, role, model, scope } = args as any;
    if (!agent_id) throw new Error("Missing required argument: agent_id");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const changes = await storage.withManifestLock(wsRoot, (md) => {
        const agentsTable = getTableFromSection(md, "Agents");
        if (!agentsTable) throw new Error("No Agents table in manifest");
        const row = agentsTable.rows.find(r => r["ID"] === agent_id);
        if (!row) throw new Error(`Agent ${agent_id} not found in manifest`);

        const ch: string[] = [];
        if (role) { row["Role"] = role; ch.push(`role=${role}`); }
        if (model) { row["Model"] = model; ch.push(`model=${model}`); }
        if (scope) { row["Scope"] = scope; ch.push(`scope=${scope}`); }
        if (ch.length === 0) throw new Error("No fields to update. Provide at least one of: role, model, scope");

        const updated = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
        return { content: updated || md, result: ch.join(", ") };
    });

    return { toolResult: `Agent ${agent_id} updated`, content: [{ type: "text", text: `Updated agent ${agent_id}: ${changes}` }] };
}

export async function handleGetAgentPrompt(args: Record<string, unknown>): Promise<ToolResponse> {
    const role = args?.role as string;
    const mission = args?.mission as string;
    const scope = args?.scope as string;
    const agent_id = args?.agent_id as string;
    if (!role || !mission || !scope || !agent_id) throw new Error("Missing required arguments: role, mission, scope, agent_id");

    if (!/^[a-z0-9-]+$/i.test(role)) throw new Error(`Invalid role name: ${role}`);

    const promptPath = path.join(globalConfigPath, "templates", "agent-prompts", `${role}.md`);
    if (!fs.existsSync(promptPath)) throw new Error(`Prompt template for ${role} not found`);

    let prompt = fs.readFileSync(promptPath, "utf8");
    prompt = prompt.split("$MISSION").join(mission);
    prompt = prompt.split("$SCOPE").join(scope);
    prompt = prompt.split("$AGENT_ID").join(agent_id);
    prompt = prompt.split("$WORKSPACE_ROOT").join(resolveWorkspaceRoot(args));

    let fbProfile = "";
    const fbAccountsPath = path.join(globalConfigPath, "fusebase_accounts.json");
    if (fs.existsSync(fbAccountsPath)) {
        try {
            const fbConfig = JSON.parse(fs.readFileSync(fbAccountsPath, "utf8"));
            const profileEntry = fbConfig?.fusebase_profiles?.[role];
            if (profileEntry?.profile) {
                fbProfile = profileEntry.profile;
            }
        } catch { /* ignore parse errors */ }
    }
    prompt = prompt.split("$PROFILE").join(fbProfile);

    return { toolResult: prompt, content: [{ type: "text", text: prompt }] };
}
