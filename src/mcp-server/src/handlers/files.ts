/**
 * File claim tool handlers: claim_file, check_file_claim, release_file_claim
 *
 * Uses StorageAdapter for manifest reads and agent progress operations.
 * Scope enforcement and lock-file logic remain in the handler (business logic).
 */
import path from "path";
import fs from "fs";
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import { getStorage } from "../storage/singleton.js";
import { getTableFromSection } from "../utils/manifest.js";

export async function handleClaimFile(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const file_path = args?.file_path as string;
    if (!agent_id || !file_path) throw new Error("Missing required arguments: agent_id, file_path");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    // Enforce scope checking
    const agent = storage.getAgent(wsRoot, agent_id);
    if (agent && agent.scope) {
        const normalizedFile = file_path.replace(/\\/g, '/');
        const normalizedScope = agent.scope.replace(/\\/g, '/');
        const scopeParts = normalizedScope.split(',').map((s: string) => s.trim());
        const inScope = scopeParts.some((s: string) => normalizedFile.startsWith(s) || s === '*' || s === 'all');
        if (!inScope) {
            throw new Error(`File ${file_path} is outside agent ${agent_id}'s scope (${agent.scope}). Use request_scope_expansion to request access.`);
        }
    }

    // Atomic claim: use lock file to prevent TOCTOU race
    const lockFileName = `.claim-lock-${file_path.replace(/[\/\\:]/g, '_')}`;
    const lockFilePath = path.join(wsRoot, lockFileName);
    try {
        fs.writeFileSync(lockFilePath, agent_id, { flag: 'wx' });
    } catch {
        throw new Error(`File ${file_path} is being claimed by another agent (lock exists)`);
    }

    try {
        const md = storage.readManifest(wsRoot);
        const sessionId = storage.extractSessionId(md);
        const allProgress = storage.readAllAgentProgress(wsRoot, sessionId);
        for (const ap of allProgress) {
            const activeClaim = ap.file_claims.find(c => c.file === file_path && !c.status.includes("Done") && !c.status.includes("Abandoned"));
            if (activeClaim) {
                throw new Error(`File ${file_path} is currently claimed by agent ${ap.agent_id} with status ${activeClaim.status}`);
            }
        }

        let progress = storage.readAgentProgress(wsRoot, agent_id);
        if (!progress) {
            const agentRow = storage.getAgent(wsRoot, agent_id);
            progress = {
                agent_id,
                role: agentRow?.role || "unknown",
                phase: agentRow?.phase || "1",
                status: "🔄 Active",
                detail: "",
                session_id: sessionId,
                file_claims: [],
                issues: [],
                handoff_notes: "",
                last_updated: new Date().toISOString()
            };
        }
        progress.file_claims.push({ file: file_path, status: "🔄 Active" });
        storage.writeAgentProgress(wsRoot, progress);

        return { toolResult: `File ${file_path} claimed by ${agent_id}`, content: [{ type: "text", text: `File ${file_path} claimed by ${agent_id} (written to agent progress file)` }] };
    } finally {
        try { fs.unlinkSync(lockFilePath); } catch { /* lock already removed */ }
    }
}

export async function handleCheckFileClaim(args: Record<string, unknown>): Promise<ToolResponse> {
    const file_path = args?.file_path as string;
    if (!file_path) throw new Error("Missing required argument: file_path");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const claims: Array<{ agent_id: string; file: string; status: string; source: string }> = [];

    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);
    const allProgress = storage.readAllAgentProgress(wsRoot, sessionId);
    for (const ap of allProgress) {
        for (const c of ap.file_claims) {
            if (c.file === file_path) {
                claims.push({ agent_id: ap.agent_id, file: c.file, status: c.status, source: "agent_file" });
            }
        }
    }

    try {
        const res = getTableFromSection(md, "File Claims");
        if (res) {
            const manifestClaims = res.rows.filter(r => r["File"] === file_path);
            for (const mc of manifestClaims) {
                if (!claims.some(c => c.agent_id === mc["Claimed By"])) {
                    claims.push({ agent_id: mc["Claimed By"], file: mc["File"], status: mc["Status"], source: "manifest" });
                }
            }
        }
    } catch { /* manifest may not exist yet */ }

    return { toolResult: JSON.stringify(claims), content: [{ type: "text", text: JSON.stringify(claims, null, 2) }] };
}

export async function handleReleaseFileClaim(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const file_path = args?.file_path as string;
    const status = args?.status as string;
    if (!agent_id || !file_path || !status) throw new Error("Missing required arguments: agent_id, file_path, status");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    let progress = storage.readAgentProgress(wsRoot, agent_id);
    if (!progress) throw new Error(`Agent progress file for ${agent_id} not found`);

    const claim = progress.file_claims.find(c => c.file === file_path && !c.status.includes("Done"));
    if (!claim) throw new Error(`Active claim for ${file_path} by ${agent_id} not found`);
    claim.status = status;
    storage.writeAgentProgress(wsRoot, progress);

    return { toolResult: `File ${file_path} claim released with status ${status}`, content: [{ type: "text", text: `File ${file_path} claim released with status ${status} (written to agent progress file)` }] };
}
