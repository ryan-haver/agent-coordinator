/**
 * FileStorageAdapter — Implements StorageAdapter using the existing
 * file-based utilities (manifest.ts, agent-progress.ts, swarm-registry.ts).
 *
 * This is a thin wrapper that delegates to the existing utils.
 * It exists so handlers can be progressively migrated to use the
 * StorageAdapter interface, then later swapped to SqliteStorageAdapter.
 */
import type {
    StorageAdapter,
    AgentRow,
    FileClaim,
    Issue,
    PhaseGate,
    AgentProgressData,
    SwarmEvent,
    SwarmInfo
} from "./adapter.js";

import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString,
    readManifest as fsReadManifest,
    writeManifest as fsWriteManifest,
    withManifestLock as fsWithManifestLock
} from "../utils/manifest.js";

import {
    readAgentProgress as fsReadAgentProgress,
    writeAgentProgress as fsWriteAgentProgress,
    createAgentProgress as fsCreateAgentProgress,
    readAllAgentProgress as fsReadAllAgentProgress,
    cleanupAgentFiles as fsCleanupAgentFiles,
    extractSessionId as fsExtractSessionId,
    generateSessionId as fsGenerateSessionId,
    type AgentProgress
} from "../utils/agent-progress.js";

import {
    registerSwarm as fsRegisterSwarm,
    updateSwarmRegistry as fsUpdateSwarmRegistry,
    deregisterSwarm as fsDeregisterSwarm,
    listActiveSwarms as fsListActiveSwarms,
    broadcastEvent as fsBroadcastEvent,
    getEvents as fsGetEvents,
    cleanupEvents as fsCleanupEvents
} from "../utils/swarm-registry.js";

import { writeSwarmStatus as fsWriteSwarmStatus } from "../handlers/shared.js";

import fs from "fs";
import path from "path";

// ── Conversion helpers ────────────────────────────────────────────────

function progressToData(p: AgentProgress): AgentProgressData {
    return {
        agent_id: p.agent_id,
        role: p.role,
        phase: p.phase,
        status: p.status,
        detail: p.detail || "",
        session_id: p.swarm_session_id,
        file_claims: p.file_claims,
        issues: p.issues,
        handoff_notes: p.handoff_notes || "",
        last_updated: p.last_updated
    };
}

function dataToProgress(d: AgentProgressData): AgentProgress {
    return {
        agent_id: d.agent_id,
        role: d.role,
        phase: d.phase,
        status: d.status,
        detail: d.detail,
        swarm_session_id: d.session_id,
        file_claims: d.file_claims,
        issues: d.issues,
        handoff_notes: d.handoff_notes,
        last_updated: d.last_updated
    };
}

// ── Implementation ────────────────────────────────────────────────────

export class FileStorageAdapter implements StorageAdapter {

    // ── Manifest ─────────────────────────────────────────────────────

    readManifest(wsRoot: string): string {
        return fsReadManifest(wsRoot);
    }

    writeManifest(wsRoot: string, content: string): void {
        fsWriteManifest(wsRoot, content);
    }

    async withManifestLock<T>(
        wsRoot: string,
        fn: (md: string) => { content: string | null; result: T }
    ): Promise<T> {
        return fsWithManifestLock(wsRoot, fn);
    }

    // ── Agents ───────────────────────────────────────────────────────

    listAgents(wsRoot: string): AgentRow[] {
        const md = fsReadManifest(wsRoot);
        const table = getTableFromSection(md, "Agents");
        if (!table) return [];
        return table.rows.map(r => ({
            id: r["ID"],
            role: r["Role"],
            model: r["Model"],
            phase: r["Phase"],
            scope: r["Scope"],
            status: r["Status"]
        }));
    }

    getAgent(wsRoot: string, agentId: string): AgentRow | null {
        const agents = this.listAgents(wsRoot);
        return agents.find(a => a.id === agentId) || null;
    }

    addAgent(wsRoot: string, agent: AgentRow): void {
        const md = fsReadManifest(wsRoot);
        const table = getTableFromSection(md, "Agents");
        if (!table) throw new Error("No Agents table in manifest");
        if (table.rows.some(r => r["ID"] === agent.id)) {
            throw new Error(`Agent ${agent.id} already exists`);
        }
        table.rows.push({
            "ID": agent.id,
            "Role": agent.role,
            "Model": agent.model,
            "Phase": agent.phase,
            "Scope": agent.scope,
            "Status": agent.status
        });
        const updated = replaceTableInSection(md, "Agents", serializeTableToString(table.headers, table.rows));
        if (updated) fsWriteManifest(wsRoot, updated);
    }

    updateAgent(wsRoot: string, agentId: string, fields: Partial<Omit<AgentRow, 'id'>>): void {
        const md = fsReadManifest(wsRoot);
        const table = getTableFromSection(md, "Agents");
        if (!table) throw new Error("No Agents table in manifest");
        const row = table.rows.find(r => r["ID"] === agentId);
        if (!row) throw new Error(`Agent ${agentId} not found`);
        if (fields.role) row["Role"] = fields.role;
        if (fields.model) row["Model"] = fields.model;
        if (fields.phase) row["Phase"] = fields.phase;
        if (fields.scope) row["Scope"] = fields.scope;
        if (fields.status) row["Status"] = fields.status;
        const updated = replaceTableInSection(md, "Agents", serializeTableToString(table.headers, table.rows));
        if (updated) fsWriteManifest(wsRoot, updated);
    }

    removeAgent(wsRoot: string, agentId: string): void {
        const md = fsReadManifest(wsRoot);
        const table = getTableFromSection(md, "Agents");
        if (!table) throw new Error("No Agents table in manifest");
        const idx = table.rows.findIndex(r => r["ID"] === agentId);
        if (idx === -1) throw new Error(`Agent ${agentId} not found`);
        table.rows.splice(idx, 1);
        const updated = replaceTableInSection(md, "Agents", serializeTableToString(table.headers, table.rows));
        if (updated) fsWriteManifest(wsRoot, updated);
    }

    // ── Agent Progress ───────────────────────────────────────────────

    readAgentProgress(wsRoot: string, agentId: string): AgentProgressData | null {
        const p = fsReadAgentProgress(wsRoot, agentId);
        return p ? progressToData(p) : null;
    }

    writeAgentProgress(wsRoot: string, progress: AgentProgressData): void {
        fsWriteAgentProgress(wsRoot, dataToProgress(progress));
    }

    readAllAgentProgress(wsRoot: string, sessionId: string): AgentProgressData[] {
        return fsReadAllAgentProgress(wsRoot, sessionId).map(progressToData);
    }

    cleanupAgentFiles(wsRoot: string): number {
        return fsCleanupAgentFiles(wsRoot);
    }

    // ── File Claims ──────────────────────────────────────────────────

    claimFile(wsRoot: string, agentId: string, filePath: string): boolean {
        const lockFileName = `.claim-lock-${filePath.replace(/[\/\\:]/g, '_')}`;
        const lockFilePath = path.join(wsRoot, lockFileName);
        try {
            fs.writeFileSync(lockFilePath, agentId, { flag: 'wx' });
        } catch {
            throw new Error(`File ${filePath} is being claimed by another agent`);
        }
        try {
            const md = fsReadManifest(wsRoot);
            const sessionId = fsExtractSessionId(md);
            const allProgress = fsReadAllAgentProgress(wsRoot, sessionId);
            for (const ap of allProgress) {
                const existing = ap.file_claims.find(c =>
                    c.file === filePath && !c.status.includes("Done") && !c.status.includes("Abandoned")
                );
                if (existing) {
                    throw new Error(`File ${filePath} already claimed by ${ap.agent_id}`);
                }
            }
            let progress = fsReadAgentProgress(wsRoot, agentId);
            if (!progress) {
                progress = fsCreateAgentProgress(agentId, "unknown", "0", sessionId);
            }
            progress.file_claims.push({ file: filePath, status: "🔄 Active" });
            fsWriteAgentProgress(wsRoot, progress);
            return true;
        } finally {
            try { fs.unlinkSync(lockFilePath); } catch { /* already removed */ }
        }
    }

    checkFileClaim(wsRoot: string, filePath: string): FileClaim[] {
        const claims: FileClaim[] = [];
        const md = fsReadManifest(wsRoot);
        const sessionId = fsExtractSessionId(md);
        const allProgress = fsReadAllAgentProgress(wsRoot, sessionId);
        for (const ap of allProgress) {
            for (const c of ap.file_claims) {
                if (c.file === filePath) {
                    claims.push({ file: c.file, agent_id: ap.agent_id, status: c.status });
                }
            }
        }
        return claims;
    }

    releaseFileClaim(wsRoot: string, agentId: string, filePath: string, status: string): void {
        const progress = fsReadAgentProgress(wsRoot, agentId);
        if (!progress) throw new Error(`Agent ${agentId} progress not found`);
        const claim = progress.file_claims.find(c => c.file === filePath && !c.status.includes("Done"));
        if (!claim) throw new Error(`Active claim for ${filePath} by ${agentId} not found`);
        claim.status = status;
        fsWriteAgentProgress(wsRoot, progress);
    }

    releaseAllClaims(wsRoot: string, agentId: string): string[] {
        const progress = fsReadAgentProgress(wsRoot, agentId);
        if (!progress) return [];
        const released: string[] = [];
        for (const claim of progress.file_claims) {
            if (!claim.status.includes("Done")) {
                claim.status = "⚠️ Abandoned";
                released.push(claim.file);
            }
        }
        fsWriteAgentProgress(wsRoot, progress);
        return released;
    }

    // ── Issues ────────────────────────────────────────────────────────

    addIssue(wsRoot: string, issue: Issue): void {
        const md = fsReadManifest(wsRoot);
        const table = getTableFromSection(md, "Issues");
        if (table) {
            table.rows.push({
                "Severity": issue.severity,
                "File/Area": issue.area,
                "Description": issue.description,
                "Reported By": issue.reporter
            });
            const updated = replaceTableInSection(md, "Issues", serializeTableToString(table.headers, table.rows));
            if (updated) fsWriteManifest(wsRoot, updated);
        }
    }

    listIssues(wsRoot: string): Issue[] {
        const issues: Issue[] = [];
        const md = fsReadManifest(wsRoot);

        const table = getTableFromSection(md, "Issues");
        if (table) {
            for (const r of table.rows) {
                issues.push({
                    severity: r["Severity"],
                    area: r["File/Area"],
                    description: r["Description"],
                    reporter: r["Reported By"]
                });
            }
        }

        const sessionId = fsExtractSessionId(md);
        const allProgress = fsReadAllAgentProgress(wsRoot, sessionId);
        for (const ap of allProgress) {
            for (const i of ap.issues) {
                if (!issues.some(e => e.description === i.description && e.reporter === ap.agent_id)) {
                    issues.push({
                        severity: i.severity,
                        area: i.area,
                        description: i.description,
                        reporter: ap.agent_id
                    });
                }
            }
        }

        return issues;
    }

    // ── Phase Gates ──────────────────────────────────────────────────

    getPhaseGates(wsRoot: string): PhaseGate[] {
        const md = fsReadManifest(wsRoot);
        const gates: PhaseGate[] = [];
        const gatesMatch = md.match(/## Phase Gates\s*\n+([\s\S]*?)(?:\n##\s|$)/);
        if (gatesMatch) {
            for (const line of gatesMatch[1].split('\n')) {
                const m = line.match(/^\s*-\s*\[(x| )\]\s*(.+)/);
                if (m) {
                    gates.push({ phase: m[2].trim(), complete: m[1] === 'x' });
                }
            }
        }
        return gates;
    }

    setPhaseGate(wsRoot: string, phase: string, complete: boolean): void {
        const md = fsReadManifest(wsRoot);
        const checkChar = complete ? 'x' : ' ';
        const regex = new RegExp(`(- \\[)[ x](\\]\\s*Phase ${phase}\\b)`, 'i');
        const newMd = md.replace(regex, `$1${checkChar}$2`);
        if (newMd === md) throw new Error(`Phase gate ${phase} not found`);
        fsWriteManifest(wsRoot, newMd);
    }

    // ── Events ────────────────────────────────────────────────────────

    async broadcastEvent(event: SwarmEvent): Promise<void> {
        await fsBroadcastEvent(event);
    }

    getEvents(wsRoot: string, sessionId: string, eventType?: string): SwarmEvent[] {
        return fsGetEvents(wsRoot, sessionId, eventType);
    }

    cleanupEvents(wsRoot: string, sessionId: string): void {
        fsCleanupEvents(wsRoot, sessionId);
    }

    // ── Swarm Registry ───────────────────────────────────────────────

    async registerSwarm(info: SwarmInfo): Promise<void> {
        await fsRegisterSwarm(info);
    }

    async updateSwarmRegistry(wsRoot: string, fields: Partial<SwarmInfo>): Promise<void> {
        await fsUpdateSwarmRegistry(wsRoot, fields);
    }

    async deregisterSwarm(wsRoot: string): Promise<void> {
        await fsDeregisterSwarm(wsRoot);
    }

    listActiveSwarms(): SwarmInfo[] {
        return fsListActiveSwarms();
    }

    // ── Session ──────────────────────────────────────────────────────

    extractSessionId(md: string): string {
        return fsExtractSessionId(md);
    }

    generateSessionId(): string {
        return fsGenerateSessionId();
    }

    // ── Status ────────────────────────────────────────────────────────

    writeSwarmStatus(wsRoot: string, lastEvent: string): void {
        const md = fsReadManifest(wsRoot);
        fsWriteSwarmStatus(wsRoot, md, lastEvent);
    }
}
