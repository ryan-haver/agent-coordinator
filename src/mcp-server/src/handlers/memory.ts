/**
 * Memory tool handlers: store_memory, semantic_search, find_similar_code, find_past_solutions
 *
 * All tools gracefully degrade when Qdrant is unavailable (QDRANT_URL not set
 * or connection failed). They return an informational text response, not isError.
 */
import { getMemory, type MemoryEntry } from "../memory/client.js";
import type { ToolResponse } from "./context.js";
import { resolveWorkspaceRoot } from "./context.js";
import { getStorage } from "../storage/singleton.js";

const DISABLED_MSG = "Semantic memory is not configured (QDRANT_URL not set). Set QDRANT_URL and restart the server to enable.";

// ── store_memory ──────────────────────────────────────────────────────

export async function handleStoreMemory(args: Record<string, unknown>): Promise<ToolResponse> {
    const text = args?.text as string;
    if (!text) throw new Error("Missing required argument: text");

    // Validate collection before checking Qdrant availability — always reject bad input
    const collection = (args?.collection as MemoryEntry["collection"]) ?? "agent_notes";
    const validCollections = ["agent_notes", "code_snippets", "project_docs", "issues"];
    if (!validCollections.includes(collection)) {
        throw new Error(`Invalid collection. Must be one of: ${validCollections.join(", ")}`);
    }

    const memory = getMemory();
    if (!memory?.isReady()) {
        return { content: [{ type: "text", text: DISABLED_MSG }] };
    }

    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();
    let session_id = "";
    try { session_id = storage.extractSessionId(storage.readManifest(wsRoot)); } catch { /* non-fatal */ }

    const entry: MemoryEntry = {
        collection,
        text,
        payload: {
            agent_id: args?.agent_id as string | undefined,
            session_id,
            workspace: wsRoot,
            phase: args?.phase as string | undefined,
            file_path: args?.file_path as string | undefined,
            timestamp: new Date().toISOString()
        }
    };

    await memory.store(entry);

    return {
        toolResult: `Stored to ${collection}`,
        content: [{ type: "text", text: `✅ Stored to \`${collection}\` collection (${text.length} chars)` }]
    };
}

// ── semantic_search ───────────────────────────────────────────────────

export async function handleSemanticSearch(args: Record<string, unknown>): Promise<ToolResponse> {
    const query = args?.query as string;
    if (!query) throw new Error("Missing required argument: query");

    const memory = getMemory();
    if (!memory?.isReady()) {
        return { content: [{ type: "text", text: DISABLED_MSG }] };
    }

    const collection = (args?.collection as string) ?? "all";
    const limit = Math.min(Number(args?.limit ?? 5), 20);

    const results = await memory.search(query, collection as any, limit);

    if (results.length === 0) {
        return { content: [{ type: "text", text: `No results found for: "${query}"` }] };
    }

    const formatted = results.map((r, i) =>
        `[${i + 1}] score=${r.score.toFixed(3)}${r.payload.file_path ? ` | ${r.payload.file_path}` : ""}${r.payload.agent_id ? ` | agent:${r.payload.agent_id}` : ""}\n${r.text}`
    ).join("\n\n---\n\n");

    return {
        toolResult: JSON.stringify(results),
        content: [{ type: "text", text: formatted }]
    };
}

// ── find_similar_code ─────────────────────────────────────────────────

export async function handleFindSimilarCode(args: Record<string, unknown>): Promise<ToolResponse> {
    const query = args?.query as string;
    if (!query) throw new Error("Missing required argument: query");

    const memory = getMemory();
    if (!memory?.isReady()) {
        return { content: [{ type: "text", text: DISABLED_MSG }] };
    }

    const limit = Math.min(Number(args?.limit ?? 5), 20);
    const results = await memory.search(query, "code_snippets", limit);

    if (results.length === 0) {
        return { content: [{ type: "text", text: `No similar code found for: "${query}"\n\nTip: Index code first with store_memory (collection: code_snippets)` }] };
    }

    const formatted = results.map((r, i) =>
        `[${i + 1}] score=${r.score.toFixed(3)} | ${r.payload.file_path ?? "unknown file"}\n\`\`\`\n${r.text}\n\`\`\``
    ).join("\n\n");

    return {
        toolResult: JSON.stringify(results),
        content: [{ type: "text", text: formatted }]
    };
}

// ── find_past_solutions ───────────────────────────────────────────────

export async function handleFindPastSolutions(args: Record<string, unknown>): Promise<ToolResponse> {
    const query = args?.query as string;
    if (!query) throw new Error("Missing required argument: query");

    const memory = getMemory();
    if (!memory?.isReady()) {
        return { content: [{ type: "text", text: DISABLED_MSG }] };
    }

    const limit = Math.min(Number(args?.limit ?? 5), 20);

    // Search both issues and agent_notes
    const [issueResults, noteResults] = await Promise.all([
        memory.search(query, "issues", limit),
        memory.search(query, "agent_notes", limit)
    ]);

    const combined = [...issueResults, ...noteResults]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    if (combined.length === 0) {
        return { content: [{ type: "text", text: `No past solutions found for: "${query}"` }] };
    }

    const formatted = combined.map((r, i) =>
        `[${i + 1}] score=${r.score.toFixed(3)}${r.payload.agent_id ? ` | ${r.payload.agent_id}` : ""}${r.payload.phase ? ` | phase ${r.payload.phase}` : ""}\n${r.text}`
    ).join("\n\n---\n\n");

    return {
        toolResult: JSON.stringify(combined),
        content: [{ type: "text", text: formatted }]
    };
}
