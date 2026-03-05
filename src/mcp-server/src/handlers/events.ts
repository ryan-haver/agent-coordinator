/**
 * Event tool handlers: broadcast_event, get_events, post_handoff_note, get_handoff_notes, report_issue
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

export async function handleBroadcastEvent(args: Record<string, unknown>): Promise<ToolResponse> {
    const { agent_id, event_type, message } = args as any;
    if (!agent_id || !event_type || !message) throw new Error("Missing required arguments");
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);

    try {
        await storage.broadcastEvent({
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
    let progress = storage.readAgentProgress(wsRoot, agent_id);
    if (progress) {
        progress.handoff_notes = progress.handoff_notes ? progress.handoff_notes + '\n' + noteText : noteText;
        storage.writeAgentProgress(wsRoot, progress);
    }

    return { toolResult: `Event broadcast: ${event_type}`, content: [{ type: "text", text: `Event [${event_type}] broadcast by ${agent_id}: ${message}` }] };
}

export async function handleGetEvents(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);
    const eventType = args?.event_type as string | undefined;
    const events = storage.getEvents(wsRoot, sessionId, eventType);
    return { toolResult: JSON.stringify(events), content: [{ type: "text", text: events.length > 0 ? JSON.stringify(events, null, 2) : "(No events found)" }] };
}

export async function handlePostHandoffNote(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const note = args?.note as string;
    if (!agent_id || !note) throw new Error("Missing required arguments: agent_id, note");
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
    const timestamp = new Date().toISOString().slice(0, 19);
    const formattedNote = `[${timestamp}] ${agent_id}: ${note}`;
    progress.handoff_notes = progress.handoff_notes
        ? progress.handoff_notes + '\n' + formattedNote
        : formattedNote;
    storage.writeAgentProgress(wsRoot, progress);

    try {
        await storage.withManifestLock(wsRoot, (md) => {
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
    const storage = getStorage();
    const notes: string[] = [];

    try {
        const md = storage.readManifest(wsRoot);
        const notesMatch = md.match(/## Handoff Notes\s*\n(?:<!-- .*?-->\s*\n)?([\s\S]*?)(?:\n## |$)/);
        if (notesMatch && notesMatch[1].trim()) {
            notes.push(...notesMatch[1].trim().split('\n').filter(l => l.trim()));
        }

        const sessionId = storage.extractSessionId(md);
        const allProgress = storage.readAllAgentProgress(wsRoot, sessionId);
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
    const storage = getStorage();

    // 1. Write to agent progress file
    const md = storage.readManifest(wsRoot);
    const sessionId = storage.extractSessionId(md);
    let progress = storage.readAgentProgress(wsRoot, reporter);
    if (!progress) {
        const agent = storage.getAgent(wsRoot, reporter);
        progress = {
            agent_id: reporter,
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
    progress.issues.push({ severity, area, description });
    storage.writeAgentProgress(wsRoot, progress);

    // 2. Also write to manifest Issues section
    try {
        await storage.withManifestLock(wsRoot, (mdLocked) => {
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
