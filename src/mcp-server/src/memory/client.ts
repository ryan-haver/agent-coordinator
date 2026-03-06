/**
 * Memory Client — Qdrant-backed semantic memory with local embedding.
 *
 * Architecture:
 *   store(entry)   → embed(text) → upsert to Qdrant collection
 *   search(query)  → embed(query) → search Qdrant → return top-K results
 *
 * Soft dependency:
 *   - QDRANT_URL not set → all operations are silent no-ops
 *   - Qdrant connection fails → logged, then no-op (does not throw)
 *   - @xenova/transformers lazy-loaded on first embed call (~1s first use)
 *
 * Embedding model: Xenova/all-MiniLM-L6-v2 (384-dim, cosine)
 * Pinned to avoid vector space drift between versions.
 */
import crypto from "crypto";
import {
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    SCORE_THRESHOLD,
    ALL_COLLECTIONS,
    type CollectionName
} from "./collections.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface MemoryEntry {
    collection: CollectionName;
    text: string;
    payload: {
        agent_id?: string;
        session_id?: string;
        workspace?: string;
        phase?: string;
        file_path?: string;
        timestamp: string;
    };
}

export interface SearchResult {
    text: string;
    score: number;
    payload: MemoryEntry["payload"];
}

// ── Embedding pipeline (lazy singleton) ───────────────────────────────

let _embedPipeline: any = null;

async function getEmbedPipeline(): Promise<any> {
    if (_embedPipeline) return _embedPipeline;
    // Dynamic import to avoid loading transformers at startup
    const { pipeline } = await import("@xenova/transformers");
    _embedPipeline = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        quantized: false
    });
    return _embedPipeline;
}

async function embed(text: string): Promise<number[]> {
    const pipe = await getEmbedPipeline();
    const result = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(result.data) as number[];
}

// ── ID generation ─────────────────────────────────────────────────────

function makeId(text: string, collection: string): string {
    // Deterministic ID — allows safe re-upsert of same content
    const hash = crypto.createHash("sha256").update(`${collection}:${text}`).digest("hex");
    // Qdrant unsigned integer IDs: use first 15 hex digits as BigInt, then Number
    return hash.slice(0, 15);
}

// ── Memory Client ─────────────────────────────────────────────────────

export class MemoryClient {
    private qdrantUrl: string;
    private client: any = null;
    private ready = false;

    constructor(qdrantUrl: string) {
        this.qdrantUrl = qdrantUrl;
    }

    async init(): Promise<void> {
        try {
            const { QdrantClient } = await import("@qdrant/js-client-rest");
            this.client = new QdrantClient({ url: this.qdrantUrl });
            await this.ensureCollections();
            this.ready = true;
            console.error(`[memory] Connected to Qdrant at ${this.qdrantUrl}`);
        } catch (e: any) {
            console.error(`[memory] Qdrant init failed (running without semantic memory): ${e?.message}`);
            this.ready = false;
        }
    }

    private async ensureCollections(): Promise<void> {
        const existing = await this.client.getCollections();
        const existingNames = new Set(existing.collections.map((c: any) => c.name));

        for (const name of ALL_COLLECTIONS) {
            if (!existingNames.has(name)) {
                await this.client.createCollection(name, {
                    vectors: {
                        size: EMBEDDING_DIM,
                        distance: "Cosine"
                    }
                });
                console.error(`[memory] Created Qdrant collection: ${name}`);
            }
        }
    }

    async store(entry: MemoryEntry): Promise<void> {
        if (!this.ready) return;
        try {
            const vector = await embed(entry.text);
            const id = parseInt(makeId(entry.text, entry.collection), 16) % Number.MAX_SAFE_INTEGER;

            await this.client.upsert(entry.collection, {
                points: [{
                    id,
                    vector,
                    payload: {
                        text: entry.text,
                        ...entry.payload
                    }
                }]
            });
        } catch (e: any) {
            console.error(`[memory] store() failed: ${e?.message}`);
        }
    }

    async search(
        query: string,
        collection: CollectionName | "all",
        limit: number = 5
    ): Promise<SearchResult[]> {
        if (!this.ready) return [];
        try {
            const vector = await embed(query);
            const collections = collection === "all" ? ALL_COLLECTIONS : [collection];

            const allResults: SearchResult[] = [];
            for (const col of collections) {
                const res = await this.client.search(col, {
                    vector,
                    limit,
                    score_threshold: SCORE_THRESHOLD,
                    with_payload: true
                });
                for (const hit of res) {
                    allResults.push({
                        text: hit.payload?.text as string ?? "",
                        score: hit.score,
                        payload: {
                            agent_id: hit.payload?.agent_id as string,
                            session_id: hit.payload?.session_id as string,
                            workspace: hit.payload?.workspace as string,
                            phase: hit.payload?.phase as string,
                            file_path: hit.payload?.file_path as string,
                            timestamp: hit.payload?.timestamp as string
                        }
                    });
                }
            }

            // Sort by score descending, return top `limit`
            allResults.sort((a, b) => b.score - a.score);
            return allResults.slice(0, limit);
        } catch (e: any) {
            console.error(`[memory] search() failed: ${e?.message}`);
            return [];
        }
    }

    isReady(): boolean {
        return this.ready;
    }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _instance: MemoryClient | null = null;

export async function initMemory(): Promise<void> {
    const url = process.env.QDRANT_URL;
    if (!url) {
        // Silent no-op — Qdrant not configured
        return;
    }
    _instance = new MemoryClient(url);
    await _instance.init();
}

export function getMemory(): MemoryClient | null {
    return _instance;
}
