/**
 * Phase tool handlers: check_phase_gates, advance_phase, update_phase_gate, poll_agent_completion
 *
 * Uses StorageAdapter for manifest, progress, and registry operations.
 */
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import { getStorage } from "../storage/singleton.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString
} from "../utils/manifest.js";

export async function handleCheckPhaseGates(args: Record<string, unknown>): Promise<ToolResponse> {
    const phaseNum = args?.phase_number as string;
    if (!phaseNum) throw new Error("Missing required argument: phase_number");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);
    const agentFiles = storage.readAllAgentProgress(wsRoot, sessionId);
    const phaseFromFiles = agentFiles.filter(a => a.phase === String(phaseNum).trim());

    let phaseAgents: Array<{ id: string; status: string }>;
    if (phaseFromFiles.length > 0) {
        phaseAgents = phaseFromFiles.map(a => ({ id: a.agent_id, status: a.status }));
    } else {
        const agents = storage.listAgents(wsRoot);
        const rows = agents.filter(a => a.phase?.trim() === String(phaseNum).trim());
        phaseAgents = rows.map(r => ({ id: r.id, status: r.status }));
    }

    if (phaseAgents.length === 0) return { content: [{ type: "text", text: "No agents in this phase." }] };

    const terminal = ["Complete", "Done", "Blocked", "Failed"];
    const allDone = phaseAgents.every(a => terminal.some(t => a.status?.includes(t)));
    const summary = phaseAgents.map(a => `${a.id}: ${a.status}`).join("\n");

    const resultText = `All agents complete: ${allDone}\nDetails:\n${summary}`;
    return { toolResult: resultText, content: [{ type: "text", text: resultText }] };
}

export async function handleAdvancePhase(args: Record<string, unknown>): Promise<ToolResponse> {
    const { from_phase, to_phase } = args as any;
    if (!from_phase || !to_phase) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const advanceResult = await storage.withManifestLock(wsRoot, (md) => {
        const sessionId = storage.extractSessionId(md);
        const allProgress = storage.readAllAgentProgress(wsRoot, sessionId);

        const agentsTable = getTableFromSection(md, "Agents");
        const fromPhaseAgents = (agentsTable?.rows || []).filter(r => r["Phase"]?.trim() === from_phase);
        const terminal = ["Complete", "Done", "Failed"];
        const allDone = fromPhaseAgents.every(r => {
            const ap = allProgress.find(a => a.agent_id === r["ID"]);
            const status = ap ? ap.status : r["Status"];
            return terminal.some(t => status?.includes(t));
        });

        if (!allDone) {
            const pending = fromPhaseAgents.filter(r => {
                const ap = allProgress.find(a => a.agent_id === r["ID"]);
                const status = ap ? ap.status : r["Status"];
                return !terminal.some(t => status?.includes(t));
            }).map(r => r["ID"]);
            throw new Error(`Phase ${from_phase} not complete. Pending agents: ${pending.join(", ")}`);
        }

        if (agentsTable) {
            for (const ap of allProgress) {
                const row = agentsTable.rows.find(r => r["ID"] === ap.agent_id);
                if (row) row["Status"] = ap.status;
            }
            const u = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
            if (u) md = u;
        }

        const gateRegex = new RegExp(`(- \\[)( )(\\]\\s*Phase ${from_phase}\\b)`, 'i');
        md = md.replace(gateRegex, '$1x$3');

        const nextPhaseAgents = (agentsTable?.rows || []).filter(r => r["Phase"]?.trim() === to_phase);
        const failedInPhase = fromPhaseAgents.filter(r => {
            const ap2 = allProgress.find(a => a.agent_id === r["ID"]);
            const st = ap2 ? ap2.status : r["Status"];
            return st?.includes("Failed");
        }).length;

        storage.writeSwarmStatus(wsRoot, `Phase ${from_phase} → ${to_phase}`);

        return {
            content: md,
            result: { nextPhaseAgents, failedInPhase }
        };
    });

    try { await storage.updateSwarmRegistry(wsRoot, { phase: to_phase }); } catch { /* non-fatal */ }

    return { toolResult: `Advanced to phase ${to_phase}`, content: [{ type: "text", text: `Phase ${from_phase} complete ✅${advanceResult.failedInPhase > 0 ? ` (⚠️ ${advanceResult.failedInPhase} agent(s) failed)` : ''}. Advanced to Phase ${to_phase}. Next agents: ${advanceResult.nextPhaseAgents.map((a: any) => `${a["ID"]} (${a["Role"]})`).join(", ") || "none"}` }] };
}

export async function handleUpdatePhaseGate(args: Record<string, unknown>): Promise<ToolResponse> {
    const { phase_number, complete } = args as any;
    if (phase_number === undefined || complete === undefined) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    await storage.withManifestLock(wsRoot, (md) => {
        const checkChar = complete ? 'x' : ' ';
        const uncheckedRegex = new RegExp(`(- \\[)[ x](\\]\\s*Phase ${phase_number}\\b)`, 'i');
        const newMd = md.replace(uncheckedRegex, `$1${checkChar}$2`);
        if (newMd === md) throw new Error(`Phase gate ${phase_number} not found in manifest`);
        return { content: newMd, result: null };
    });

    storage.writeSwarmStatus(wsRoot, `Phase gate ${phase_number} ${complete ? 'checked' : 'unchecked'}`);

    return { toolResult: `Phase gate ${phase_number} updated`, content: [{ type: "text", text: `Phase gate ${phase_number} ${complete ? '✅ checked' : '⬜ unchecked'}` }] };
}

export async function handlePollAgentCompletion(args: Record<string, unknown>): Promise<ToolResponse> {
    const phaseNum = args?.phase_number as string;
    if (!phaseNum) throw new Error("Missing required argument: phase_number");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);
    const allProgress = storage.readAllAgentProgress(wsRoot, sessionId);
    const phaseAgents = allProgress.filter(a => a.phase === String(phaseNum).trim());

    const agents = storage.listAgents(wsRoot);
    const expectedInPhase = agents.filter(a => a.phase?.trim() === String(phaseNum).trim());
    const agentsNotStarted = expectedInPhase
        .filter(e => !phaseAgents.some(a => a.agent_id === e.id))
        .map(e => e.id);

    const terminal = ["Complete", "Done", "Blocked", "Failed"];
    const allDone = expectedInPhase.length > 0 &&
        agentsNotStarted.length === 0 &&
        phaseAgents.every(a => terminal.some(t => a.status?.includes(t)));

    const result: any = {
        all_complete: allDone,
        total_agents: phaseAgents.length,
        expected_agents: expectedInPhase.length,
        agents_not_started: agentsNotStarted,
        agents: phaseAgents.map(a => ({
            id: a.agent_id,
            role: a.role,
            status: a.status,
            detail: a.detail || '',
            last_updated: a.last_updated
        }))
    };

    const staleThreshold = args?.stale_threshold_minutes as number | undefined;
    if (staleThreshold && typeof staleThreshold === 'number') {
        const now = Date.now();
        result.stale_agents = phaseAgents
            .filter(a => {
                if (terminal.some(t => a.status?.includes(t))) return false;
                const updated = new Date(a.last_updated).getTime();
                return (now - updated) > staleThreshold * 60 * 1000;
            })
            .map(a => ({
                id: a.agent_id,
                last_updated: a.last_updated,
                minutes_stale: Math.round((now - new Date(a.last_updated).getTime()) / 60000)
            }));
    }

    return { toolResult: JSON.stringify(result), content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
