/**
 * Journal tool handlers: journal_write, journal_read, journal_promote, journal_search
 *
 * Personal journal entries are stored in SQLite (workspace DB).
 * Promoted entries are additionally embedded into the Qdrant `shared_journal` collection
 * for cross-agent semantic search.
 */
import { getMemory, type MemoryEntry } from "../memory/client.js";
import type { ToolResponse } from "./context.js";
import { resolveWorkspaceRoot } from "./context.js";
import { getStorage } from "../storage/singleton.js";

const VALID_ENTRY_TYPES = [
    "decision", "dead_end", "discovery", "assumption", "question", "idea", "blocker"
] as const;
type EntryType = typeof VALID_ENTRY_TYPES[number];

// ── journal_write ────────────────────────────────────────────────────

export async function handleJournalWrite(args: Record<string, unknown>): Promise<ToolResponse> {
    const content = args?.content as string;
    if (!content) throw new Error("Missing required argument: content");

    const entryType = args?.entry_type as string;
    if (!entryType || !VALID_ENTRY_TYPES.includes(entryType as EntryType)) {
        throw new Error(`Invalid entry_type. Must be one of: ${VALID_ENTRY_TYPES.join(", ")}`);
    }

    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const db = (storage as any).getDb(wsRoot);

    let sessionId = "";
    try { sessionId = storage.extractSessionId(storage.readManifest(wsRoot)); } catch { /* non-fatal */ }

    const agentId = (args?.agent_id as string) || "unknown";
    const role = (args?.role as string) || "unknown";
    const context = (args?.context as string) || "";
    const tags = (args?.tags as string) || "";

    db.prepare(`
        INSERT INTO journal_entries (agent_id, role, entry_type, visibility, context, content, tags, session_id, workspace)
        VALUES (?, ?, ?, 'personal', ?, ?, ?, ?, ?)
    `).run(agentId, role, entryType, context, content, tags, sessionId, wsRoot);

    const id = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

    return {
        content: [{ type: "text", text: `✅ Journal entry #${id} written (${entryType}, personal)\n\nTo promote to shared layer: call journal_promote with entry_id=${id}` }]
    };
}

// ── journal_read ─────────────────────────────────────────────────────

export async function handleJournalRead(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const db = (storage as any).getDb(wsRoot);

    const scope = (args?.scope as string) || "personal";
    const agentId = args?.agent_id as string;
    const role = args?.role as string;
    const entryType = args?.entry_type as string;
    const limit = Math.min(Number(args?.limit ?? 20), 100);

    // Build dynamic query
    const conditions: string[] = [];
    const params: any[] = [];

    if (scope === "personal" && agentId) {
        conditions.push("agent_id = ?");
        params.push(agentId);
    } else if (scope === "shared") {
        conditions.push("visibility IN ('shared', 'promoted')");
    } else if (scope === "role" && role) {
        conditions.push("role = ?");
        params.push(role);
    }
    // scope === "all" → no visibility filter

    if (entryType) {
        if (!VALID_ENTRY_TYPES.includes(entryType as EntryType)) {
            throw new Error(`Invalid entry_type filter. Must be one of: ${VALID_ENTRY_TYPES.join(", ")}`);
        }
        conditions.push("entry_type = ?");
        params.push(entryType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = db.prepare(
        `SELECT id, agent_id, role, entry_type, visibility, context, content, tags, created_at
         FROM journal_entries ${where}
         ORDER BY created_at DESC LIMIT ?`
    ).all(...params) as Array<{
        id: number; agent_id: string; role: string; entry_type: string;
        visibility: string; context: string; content: string; tags: string; created_at: string;
    }>;

    if (rows.length === 0) {
        return { content: [{ type: "text", text: `No journal entries found (scope=${scope})` }] };
    }

    const formatted = rows.map(r =>
        `**#${r.id}** [${r.entry_type}] ${r.visibility === "promoted" ? "🌐" : "🔒"} — ${r.agent_id} (${r.role}) @ ${r.created_at}\n` +
        (r.context ? `  Context: ${r.context}\n` : "") +
        (r.tags ? `  Tags: ${r.tags}\n` : "") +
        `  ${r.content}`
    ).join("\n\n---\n\n");

    return {
        content: [{ type: "text", text: `${rows.length} journal entries (scope=${scope}):\n\n${formatted}` }]
    };
}

// ── journal_promote ──────────────────────────────────────────────────

export async function handleJournalPromote(args: Record<string, unknown>): Promise<ToolResponse> {
    const entryId = Number(args?.entry_id);
    if (!entryId || isNaN(entryId)) throw new Error("Missing required argument: entry_id (integer)");

    const reason = (args?.reason as string) || "";

    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const db = (storage as any).getDb(wsRoot);

    // Fetch the entry
    const entry = db.prepare(
        "SELECT id, agent_id, role, entry_type, visibility, context, content, tags, session_id FROM journal_entries WHERE id = ?"
    ).get(entryId) as {
        id: number; agent_id: string; role: string; entry_type: string;
        visibility: string; context: string; content: string; tags: string; session_id: string;
    } | undefined;

    if (!entry) throw new Error(`Journal entry #${entryId} not found`);
    if (entry.visibility === "promoted") {
        return { content: [{ type: "text", text: `Entry #${entryId} is already promoted to shared layer` }] };
    }

    // Update visibility in SQLite
    db.prepare("UPDATE journal_entries SET visibility = 'promoted' WHERE id = ?").run(entryId);

    // Embed into Qdrant shared_journal collection
    const memory = getMemory();
    let qdrantStored = false;
    if (memory?.isReady()) {
        const text = `[${entry.entry_type}] ${entry.content}${reason ? `\n\nPromotion reason: ${reason}` : ""}`;
        const memEntry: MemoryEntry = {
            collection: "shared_journal",
            text,
            payload: {
                agent_id: entry.agent_id,
                session_id: entry.session_id,
                workspace: wsRoot,
                phase: entry.role,
                timestamp: new Date().toISOString()
            }
        };
        await memory.store(memEntry);
        qdrantStored = true;
    }

    return {
        content: [{
            type: "text",
            text: `✅ Entry #${entryId} promoted to shared layer\n` +
                `  Type: ${entry.entry_type}\n` +
                `  Author: ${entry.agent_id} (${entry.role})\n` +
                `  Semantic index: ${qdrantStored ? "✅ stored in Qdrant" : "⚠️ Qdrant unavailable — SQLite only"}\n` +
                (reason ? `  Reason: ${reason}` : "")
        }]
    };
}

// ── journal_search ───────────────────────────────────────────────────

export async function handleJournalSearch(args: Record<string, unknown>): Promise<ToolResponse> {
    const query = args?.query as string;
    if (!query) throw new Error("Missing required argument: query");

    const memory = getMemory();
    const limit = Math.min(Number(args?.limit ?? 5), 20);

    // Try semantic search first (Qdrant)
    if (memory?.isReady()) {
        const results = await memory.search(query, "shared_journal", limit);

        if (results.length > 0) {
            const formatted = results.map((r, i) =>
                `[${i + 1}] score=${r.score.toFixed(3)}${r.payload.agent_id ? ` | ${r.payload.agent_id}` : ""}${r.payload.phase ? ` | role:${r.payload.phase}` : ""}\n${r.text}`
            ).join("\n\n---\n\n");

            return { content: [{ type: "text", text: `${results.length} shared journal entries found:\n\n${formatted}` }] };
        }
    }

    // Fallback: text search in SQLite promoted entries
    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    const db = (storage as any).getDb(wsRoot);

    const rows = db.prepare(
        `SELECT id, agent_id, role, entry_type, content, created_at
         FROM journal_entries
         WHERE visibility = 'promoted' AND content LIKE ?
         ORDER BY created_at DESC LIMIT ?`
    ).all(`%${query}%`, limit) as Array<{
        id: number; agent_id: string; role: string; entry_type: string; content: string; created_at: string;
    }>;

    if (rows.length === 0) {
        return { content: [{ type: "text", text: `No shared journal entries found for: "${query}"\n\nTip: Agents can promote personal entries with journal_promote` }] };
    }

    const formatted = rows.map((r, i) =>
        `[${i + 1}] #${r.id} [${r.entry_type}] ${r.agent_id} (${r.role}) @ ${r.created_at}\n${r.content}`
    ).join("\n\n---\n\n");

    return { content: [{ type: "text", text: `${rows.length} shared journal entries (text search fallback):\n\n${formatted}` }] };
}
