/**
 * Event tool handlers: broadcast_event, get_events, post_handoff_note, get_handoff_notes, report_issue
 */
import {
    replaceTableInSection,
    serializeTableToString
} from "../utils/manifest.js";
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import {
    readManifest,
    withManifestLock
} from "../utils/manifest.js";
import {
    readAgentProgress,
    writeAgentProgress,
    createAgentProgress,
    readAllAgentProgress,
    extractSessionId
} from "../utils/agent-progress.js";
import {
    getTableFromSection
} from "../utils/manifest.js";
import {
    broadcastEvent,
    getEvents
} from "../utils/swarm-registry.js";

export async function handleBroadcastEvent(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, event_type, message } = args as any;
    if (!agent_id || !event_type || !message) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const md = readManifest(wsRoot);
    const sessionId = extractSessionId(md);

    try {
        await broadcastEvent({
            timestamp: new Date().toISOString(),
            agent_id,
            event_type,
            message,
            workspace: wsRoot,
            session_id: sessionId
        });
    } catch { /* event write is non-fatal */ }

    const timestamp = new Date().toISOString().slice(0, 19);
    const noteText = `[${timestamp}] [EVENT:${event_type.toUpperCase()}] ${agent_id}: ${message}`;
    let progress = readAgentProgress(wsRoot, agent_id);
    if (progress) {
        progress.handoff_notes = progress.handoff_notes ? progress.handoff_notes + '\n' + noteText : noteText;
        writeAgentProgress(wsRoot, progress);
    }

    return { toolResult: `Event broadcast: ${event_type}`, content: [{ type: "text", text: `Event [${event_type}] broadcast by ${agent_id}: ${message}` }] };
}

export async function handleGetEvents(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const md = readManifest(wsRoot);
    const sessionId = extractSessionId(md);
    const eventType = args?.event_type as string | undefined;
    const events = getEvents(wsRoot, sessionId, eventType);
    return { toolResult: JSON.stringify(events), content: [{ type: "text", text: events.length > 0 ? JSON.stringify(events, null, 2) : "(No events found)" }] };
}

export async function handlePostHandoffNote(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const note = args?.note as string;
    if (!agent_id || !note) throw new Error("Missing required arguments: agent_id, note");
    const wsRoot = resolveWorkspaceRoot(args);

    let progress = readAgentProgress(wsRoot, agent_id);
    if (!progress) {
        const md = readManifest(wsRoot);
        const sessionId = extractSessionId(md);
        const res = getTableFromSection(md, "Agents");
        const row = res?.rows.find(r => r["ID"] === agent_id);
        progress = createAgentProgress(agent_id, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
    }
    const timestamp = new Date().toISOString().slice(0, 19);
    const formattedNote = `[${timestamp}] ${agent_id}: ${note}`;
    progress.handoff_notes = progress.handoff_notes
        ? progress.handoff_notes + '\n' + formattedNote
        : formattedNote;
    writeAgentProgress(wsRoot, progress);

    try {
        await withManifestLock(wsRoot, (md) => {
            const handoffIdx = md.indexOf('## Handoff Notes');
            if (handoffIdx !== -1) {
                let insertIdx = md.indexOf('\n', handoffIdx);
                if (insertIdx === -1) insertIdx = md.length;
                else insertIdx++;
                const rest = md.slice(insertIdx);
                const commentMatch = rest.match(/^<!--[\s\S]*?-->\s*\n/);
                if (commentMatch) insertIdx += commentMatch[0].length;
                const newMd = md.slice(0, insertIdx) + formattedNote + '\n' + md.slice(insertIdx);
                return { content: newMd, result: null };
            }
            return { content: null, result: null };
        });
    } catch { /* manifest write failure is non-fatal */ }

    return { toolResult: `Note posted by ${agent_id}`, content: [{ type: "text", text: `Note posted: ${formattedNote}` }] };
}

export async function handleGetHandoffNotes(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const notes: string[] = [];

    try {
        const md = readManifest(wsRoot);
        const notesMatch = md.match(/## Handoff Notes\s*\n(?:<!-- .*?-->\s*\n)?([\s\S]*?)(?:\n## |$)/);
        if (notesMatch && notesMatch[1].trim()) {
            notes.push(...notesMatch[1].trim().split('\n').filter(l => l.trim()));
        }

        const sessionId = extractSessionId(md);
        const allProgress = readAllAgentProgress(wsRoot, sessionId);
        for (const ap of allProgress) {
            if (ap.handoff_notes?.trim()) {
                const agentNotes = ap.handoff_notes.split('\n').filter(l => l.trim());
                for (const n of agentNotes) {
                    if (!notes.includes(n)) notes.push(n);
                }
            }
        }
    } catch { /* agent files may not exist */ }

    const result = notes.length > 0 ? notes.join('\n') : '(No handoff notes found)';
    return { toolResult: result, content: [{ type: "text", text: result }] };
}

export async function handleReportIssue(args: Record<string, unknown>): Promise<ToolResponse> {
    const severity = args?.severity as string;
    const description = args?.description as string;
    const reporter = args?.reporter as string;
    if (!severity || !description || !reporter) throw new Error("Missing required arguments: severity, description, reporter");
    const area = (args?.area as string) || "";
    const wsRoot = resolveWorkspaceRoot(args);

    // 1. Write to agent progress file
    const md = readManifest(wsRoot);
    const sessionId = extractSessionId(md);
    let progress = readAgentProgress(wsRoot, reporter);
    if (!progress) {
        const res = getTableFromSection(md, "Agents");
        const row = res?.rows.find(r => r["ID"] === reporter);
        progress = createAgentProgress(reporter, row?.["Role"] || "unknown", row?.["Phase"] || "1", sessionId);
    }
    progress.issues.push({ severity, area, description });
    writeAgentProgress(wsRoot, progress);

    // 2. Also write to manifest Issues section
    try {
        await withManifestLock(wsRoot, (mdLocked) => {
            const issuesTable = getTableFromSection(mdLocked, "Issues");
            if (issuesTable) {
                issuesTable.rows.push({ "Severity": severity, "File/Area": area, "Description": description, "Reported By": reporter });
                const updated = replaceTableInSection(mdLocked, "Issues", serializeTableToString(issuesTable.headers, issuesTable.rows));
                return { content: updated || mdLocked, result: null };
            }
            return { content: null, result: null };
        });
    } catch { /* manifest write is non-fatal */ }

    return { toolResult: `Issue reported: ${severity}`, content: [{ type: "text", text: `Issue reported by ${reporter}: ${severity} — ${description}` }] };
}
