/**
 * Shared helper used by multiple handler modules.
 * Kept separate to avoid circular imports.
 */
import fs from "fs";
import path from "path";
import {
    getTableFromSection,
    readManifest
} from "../utils/manifest.js";
import {
    readAllAgentProgress,
    extractSessionId
} from "../utils/agent-progress.js";

export function writeSwarmStatus(rootDir: string, md: string, lastEvent: string) {
    try {
        const modeSection = md.match(/Supervision:\s*(.+)/);
        const supervision = modeSection ? modeSection[1].trim() : "unknown";

        const missionMatch = md.match(/## Mission\s*\n+(.+)/);
        const task = missionMatch ? missionMatch[1].trim() : "";

        const sessionId = extractSessionId(md);
        const agentFiles = readAllAgentProgress(rootDir, sessionId);

        let active: number, complete: number, pending: number, phase: string;
        if (agentFiles.length > 0) {
            active = agentFiles.filter(a => a.status?.includes("Active")).length;
            complete = agentFiles.filter(a => a.status?.includes("Complete") || a.status?.includes("Done")).length;
            pending = agentFiles.filter(a => a.status?.includes("Pending")).length;
            const activeAgent = agentFiles.find(a => a.status?.includes("Active"));
            phase = activeAgent?.phase || (complete === agentFiles.length ? "done" : "0");
        } else {
            const agentsTable = getTableFromSection(md, "Agents");
            const agents = agentsTable?.rows || [];
            active = agents.filter(a => a["Status"]?.includes("Active")).length;
            complete = agents.filter(a => a["Status"]?.includes("Complete")).length;
            pending = agents.filter(a => a["Status"]?.includes("Pending")).length;
            const activeAgent = agents.find(a => a["Status"]?.includes("Active"));
            phase = activeAgent?.["Phase"] || (complete === agents.length ? "done" : "0");
        }

        let allPhaseAgentsDone = false;
        if (agentFiles.length > 0) {
            const phaseAgentFiles = agentFiles.filter(a => a.phase === phase);
            allPhaseAgentsDone = phaseAgentFiles.length > 0 && phaseAgentFiles.every(a => a.status?.includes("Complete") || a.status?.includes("Done"));
        } else {
            const agentsTable2 = getTableFromSection(md, "Agents");
            const phaseManifestAgents = (agentsTable2?.rows || []).filter(a => a["Phase"]?.trim() === phase);
            allPhaseAgentsDone = phaseManifestAgents.length > 0 && phaseManifestAgents.every(a => a["Status"]?.includes("Complete") || a["Status"]?.includes("Done"));
        }
        const needsAction = (supervision.toLowerCase().includes("gate") || supervision === "2") && allPhaseAgentsDone && phase !== "done";

        const statusObj = {
            task,
            phase,
            supervision,
            agents_active: active,
            agents_complete: complete,
            agents_pending: pending,
            last_event: lastEvent,
            needs_user_action: needsAction,
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(path.join(rootDir, "swarm_status.json"), JSON.stringify(statusObj, null, 2));
    } catch (e) {
        console.error("[agent-coordinator] Failed to write swarm_status.json:", e);
    }
}
