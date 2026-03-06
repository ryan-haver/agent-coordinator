/**
 * Memory Collections — Qdrant collection definitions.
 *
 * Collections:
 *   agent_notes   — handoff notes, decisions, observations
 *   code_snippets — code fragments with file/function context
 *   project_docs  — specs, plans, walkthroughs
 *   issues        — issues and resolutions
 *
 * All collections use:
 *   - 384-dimensional float vectors (all-MiniLM-L6-v2)
 *   - Cosine distance
 */

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;
export const SCORE_THRESHOLD = 0.5;

export type CollectionName =
    | "agent_notes"
    | "code_snippets"
    | "project_docs"
    | "issues";

export const ALL_COLLECTIONS: CollectionName[] = [
    "agent_notes",
    "code_snippets",
    "project_docs",
    "issues"
];

export const COLLECTION_DESCRIPTIONS: Record<CollectionName, string> = {
    agent_notes: "Agent handoff notes, observations, and decisions",
    code_snippets: "Code fragments with file path and function context",
    project_docs: "Specs, plans, walkthroughs, and documentation",
    issues: "Issues, bugs, and their resolutions"
};
