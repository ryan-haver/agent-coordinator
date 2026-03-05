/**
 * Swarm tool handlers: get_swarm_status, complete_swarm, list_active_swarms, rollup_agent_progress
 */
import path from "path";
import fs from "fs";
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString,
    readManifest,
    withManifestLock
} from "../utils/manifest.js";
import {
    readAllAgentProgress,
    cleanupAgentFiles,
    extractSessionId
} from "../utils/agent-progress.js";
import {
    listActiveSwarms,
    deregisterSwarm,
    getEvents,
    cleanupEvents
} from "../utils/swarm-registry.js";
import { writeSwarmStatus } from "./shared.js";

export async function handleGetSwarmStatus(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const md = readManifest(wsRoot);
    const agents = getTableFromSection(md, "Agents")?.rows || [];
    const manifestIssues = getTableFromSection(md, "Issues")?.rows || [];

    const sessionId = extractSessionId(md);
    const agentFiles = readAllAgentProgress(wsRoot, sessionId);
    for (const ap of agentFiles) {
        const row = agents.find(a => a["ID"] === ap.agent_id);
        if (row) {
            row["Status"] = ap.status;
            if (ap.phase) row["Phase"] = ap.phase;
        }
    }

    const agentIssues = agentFiles.flatMap(ap =>
        ap.issues.map(i => ({ "Severity": i.severity, "File/Area": i.area, "Description": i.description, "Reported By": ap.agent_id }))
    );
    const issues = [...manifestIssues, ...agentIssues.filter(ai =>
        !manifestIssues.some(mi => mi["Description"] === ai["Description"] && mi["Reported By"] === ai["Reported By"])
    )];

    const gatesMatch = md.match(/## Phase Gates\s*\n+([\s\S]*?)(?:\n##\s|$)/);
    const gates: { phase: string; complete: boolean }[] = [];
    if (gatesMatch) {
        const gateLines = gatesMatch[1].split('\n');
        for (const line of gateLines) {
            const m = line.match(/^\s*-\s*\[(x| )\]\s*(.+)/);
            if (m) {
                gates.push({ phase: m[2].trim(), complete: m[1] === 'x' });
            }
        }
    }

    const handoffNotes: string[] = [];
    for (const ap of agentFiles) {
        if (ap.handoff_notes?.trim()) {
            handoffNotes.push(...ap.handoff_notes.split('\n').filter((l: string) => l.trim()));
        }
    }

    let events: any[] = [];
    try { events = getEvents(wsRoot, sessionId); } catch { /* non-fatal */ }

    const scopeRequests = agentFiles.flatMap(ap =>
        ap.issues.filter(i => i.severity?.includes('SCOPE_REQUEST') || i.severity?.includes('SCOPE_GRANTED') || i.severity?.includes('SCOPE_DENIED')).map(i => ({
            agent_id: ap.agent_id,
            file_path: i.area,
            reason: i.description?.replace('Scope expansion requested: ', '').replace(/\s*\[DENIED:.*\]$/, ''),
            status: i.severity?.includes('GRANTED') ? 'granted' : i.severity?.includes('DENIED') ? 'denied' : 'pending'
        }))
    );

    return { toolResult: JSON.stringify({ agents, gates, issues, handoff_notes: handoffNotes, events, scope_requests: scopeRequests }), content: [{ type: "text", text: JSON.stringify({ agents, gates, issues, handoff_notes: handoffNotes, events: events.length, scope_requests: scopeRequests }, null, 2) }] };
}

export async function handleCompleteSwarm(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);

    const { sessionId, allProgress } = await withManifestLock(wsRoot, (md) => {
        const sid = extractSessionId(md);
        const progress = readAllAgentProgress(wsRoot, sid);
        const agentsTable = getTableFromSection(md, "Agents");
        if (agentsTable) {
            for (const ap of progress) {
                const row = agentsTable.rows.find(r => r["ID"] === ap.agent_id);
                if (row) row["Status"] = ap.status;
            }
            const u = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
            if (u) md = u;
        }
        return { content: md, result: { sessionId: sid, allProgress: progress } };
    });

    const md = readManifest(wsRoot);
    const agentsTable = getTableFromSection(md, "Agents");
    const totalAgents = agentsTable?.rows.length || 0;
    const completedAgents = allProgress.filter(a => a.status?.includes("Complete") || a.status?.includes("Done")).length;
    const failedAgents = allProgress.filter(a => a.status?.includes("Failed")).length;

    const archiveDir = path.join(wsRoot, '.swarm-archives');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const archiveName = `swarm-manifest-${sessionId.replace(/[:.]/g, '-')}.md`;
    fs.copyFileSync(path.join(wsRoot, 'swarm-manifest.md'), path.join(archiveDir, archiveName));

    writeSwarmStatus(wsRoot, md, "Swarm completed");

    try {
        const missionMatch = md.match(/## Mission\s*\n+([\s\S]*?)(?:\n## |$)/);
        const mission = missionMatch ? missionMatch[1].trim().slice(0, 200) : 'Unknown';
        const report = [
            `# Swarm Report — ${sessionId}`,
            '',
            `**Mission:** ${mission}`,
            `**Completed:** ${new Date().toISOString()}`,
            `**Result:** ${completedAgents}/${totalAgents} agents succeeded, ${failedAgents} failed`,
            '',
            '## Agent Summary',
            '',
            '| Agent | Role | Status |',
            '|-------|------|--------|',
            ...allProgress.map(a => `| ${a.agent_id} | ${a.role} | ${a.status} |`),
            '',
            '## Issues',
            '',
            ...(allProgress.flatMap(a => a.issues).length > 0
                ? ['| Severity | Area | Description | Reporter |',
                    '|----------|------|-------------|----------|',
                    ...allProgress.flatMap(a => a.issues.map(i => `| ${i.severity} | ${i.area} | ${i.description} | ${a.agent_id} |`))]
                : ['(No issues reported)']),
            '',
            '## File Claims',
            '',
            '| File | Agent | Status |',
            '|------|-------|--------|',
            ...allProgress.flatMap(a => a.file_claims.map(c => `| ${c.file} | ${a.agent_id} | ${c.status} |`)),
            '',
            `---`,
            `_Archived manifest: ${archiveName}_`
        ].join('\n');
        fs.writeFileSync(path.join(wsRoot, 'swarm-report.md'), report, 'utf8');
    } catch { /* report generation is non-fatal */ }

    const cleaned = cleanupAgentFiles(wsRoot);

    try { cleanupEvents(wsRoot, sessionId); } catch { /* non-fatal */ }

    try { await deregisterSwarm(wsRoot); } catch { /* non-fatal */ }

    return { toolResult: "Swarm completed", content: [{ type: "text", text: `Swarm completed. ${completedAgents}/${totalAgents} agents succeeded, ${failedAgents} failed. Archived to ${archiveName}. Report: swarm-report.md. Cleaned ${cleaned} agent files.` }] };
}

export async function handleListActiveSwarms(_args: Record<string, unknown>): Promise<ToolResponse> {
    const swarms = listActiveSwarms();
    return { toolResult: JSON.stringify(swarms), content: [{ type: "text", text: swarms.length > 0 ? JSON.stringify(swarms, null, 2) : "(No active swarms)" }] };
}

export async function handleRollupAgentProgress(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);

    const mdForSession = readManifest(wsRoot);
    const sessionId = extractSessionId(mdForSession);
    const allProgress = readAllAgentProgress(wsRoot, sessionId);
    if (allProgress.length === 0) {
        return { toolResult: "No agent progress files found.", content: [{ type: "text", text: "No agent progress files found." }] };
    }

    const rollupResult = await withManifestLock(wsRoot, (md) => {
        // 1. Update Agents table
        const agentsTable = getTableFromSection(md, "Agents");
        if (agentsTable) {
            for (const ap of allProgress) {
                const row = agentsTable.rows.find(r => r["ID"] === ap.agent_id);
                if (row) row["Status"] = ap.status;
            }
            const u = replaceTableInSection(md, "Agents", serializeTableToString(agentsTable.headers, agentsTable.rows));
            if (u) md = u;
        }

        // 2. Merge file claims
        const claimsTable = getTableFromSection(md, "File Claims");
        if (claimsTable) {
            const mergedClaims: Array<{ File: string; "Claimed By": string; Status: string }> = [];
            for (const ap of allProgress) {
                for (const c of ap.file_claims) {
                    mergedClaims.push({ "File": c.file, "Claimed By": ap.agent_id, "Status": c.status });
                }
            }
            claimsTable.rows = mergedClaims.map(c => ({ "File": c.File, "Claimed By": c["Claimed By"], "Status": c.Status }));
            const u = replaceTableInSection(md, "File Claims", serializeTableToString(claimsTable.headers, claimsTable.rows));
            if (u) md = u;
        }

        // 3. Merge issues
        const issuesTable = getTableFromSection(md, "Issues");
        if (issuesTable) {
            const mergedIssues: Array<Record<string, string>> = [];
            for (const ap of allProgress) {
                for (const issue of ap.issues) {
                    mergedIssues.push({ "Severity": issue.severity, "File/Area": issue.area, "Description": issue.description, "Reported By": ap.agent_id });
                }
            }
            const existingIssues = issuesTable.rows.filter(existing =>
                !mergedIssues.some(mi => mi["Description"] === existing["Description"] && mi["Reported By"] === existing["Reported By"])
            );
            issuesTable.rows = [...existingIssues, ...mergedIssues];
            const u = replaceTableInSection(md, "Issues", serializeTableToString(issuesTable.headers, issuesTable.rows));
            if (u) md = u;
        }

        // 4. Merge handoff notes (exact-line dedup)
        const handoffIdx = md.indexOf('## Handoff Notes');
        if (handoffIdx !== -1) {
            const existingNotesMatch = md.slice(handoffIdx).match(/## Handoff Notes\s*\n(?:<!--[\s\S]*?-->\s*\n)?([\s\S]*?)(?:\n## |$)/);
            const existingLines = new Set(
                (existingNotesMatch?.[1] || '').split('\n').map(l => l.trim()).filter(Boolean)
            );

            for (const ap of allProgress) {
                if (ap.handoff_notes?.trim()) {
                    const notes = ap.handoff_notes.split('\n').filter(l => l.trim());
                    for (const note of notes) {
                        if (!existingLines.has(note.trim())) {
                            existingLines.add(note.trim());
                            let insertPos = md.indexOf('\n', handoffIdx);
                            if (insertPos === -1) insertPos = md.length;
                            else insertPos++;
                            const rest = md.slice(insertPos);
                            const commentMatch = rest.match(/^<!--[\s\S]*?-->\s*\n/);
                            if (commentMatch) insertPos += commentMatch[0].length;
                            md = md.slice(0, insertPos) + note + '\n' + md.slice(insertPos);
                        }
                    }
                }
            }
        }

        // 5. Auto-check phase gates
        const agentsTableForGates = getTableFromSection(md, "Agents");
        if (agentsTableForGates) {
            const terminal = ["Complete", "Done"];
            const phaseNumbers = [...new Set(agentsTableForGates.rows.map(r => r["Phase"]?.trim()).filter(Boolean))];
            for (const ph of phaseNumbers) {
                const phaseRows = agentsTableForGates.rows.filter(r => r["Phase"]?.trim() === ph);
                const allPhaseComplete = phaseRows.every(r => {
                    const ap = allProgress.find(a => a.agent_id === r["ID"]);
                    const status = ap ? ap.status : r["Status"];
                    return terminal.some(t => status?.includes(t));
                });
                if (allPhaseComplete) {
                    const gateRegex = new RegExp(`(- \\[)( )(\\]\\s*Phase ${ph}\\b)`, 'i');
                    md = md.replace(gateRegex, '$1x$3');
                }
            }
        }

        return { content: md, result: allProgress.map(ap => `${ap.agent_id} (${ap.role}): ${ap.status}`).join(", ") };
    });

    writeSwarmStatus(wsRoot, readManifest(wsRoot), `Rolled up progress from ${allProgress.length} agents`);
    return { toolResult: `Rollup complete: ${rollupResult}`, content: [{ type: "text", text: `Rollup complete for ${allProgress.length} agents: ${rollupResult}` }] };
}
