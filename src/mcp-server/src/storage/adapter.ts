/**
 * StorageAdapter — Abstract interface for swarm coordination state.
 *
 * Concrete implementations:
 *   - FileStorageAdapter  (Phase 1 — current file-based backend)
 *   - SqliteStorageAdapter (Phase 5A — embedded SQLite)
 *
 * The adapter owns manifest, agent-progress, file-claim, and event data.
 * Handlers call these methods instead of touching the filesystem directly.
 */

// ── Domain Types ──────────────────────────────────────────────────────

export interface AgentRow {
    id: string;
    role: string;
    model: string;
    phase: string;
    scope: string;
    status: string;
}

export interface FileClaim {
    file: string;
    agent_id: string;
    status: string;
    claimed_at?: string;
}

export interface Issue {
    severity: string;
    area: string;
    description: string;
    reporter: string;
}

export interface PhaseGate {
    phase: string;
    complete: boolean;
}

export interface AgentProgressData {
    agent_id: string;
    role: string;
    phase: string;
    status: string;
    detail: string;
    session_id: string;
    file_claims: Array<{ file: string; status: string }>;
    issues: Array<{ severity: string; area: string; description: string }>;
    handoff_notes: string;
    last_updated: string;
}

export interface SwarmEvent {
    timestamp: string;
    agent_id: string;
    event_type: string;
    message: string;
    workspace: string;
    session_id: string;
}

export interface SwarmInfo {
    workspace: string;
    session_id: string;
    mission: string;
    phase: string;
    agents_active: number;
    agents_total: number;
    supervision: string;
    started_at: string;
    last_updated: string;
    status: string;
}

// ── Adapter Interface ─────────────────────────────────────────────────

export interface StorageAdapter {
    // ── Manifest (raw markdown) ──────────────────────────────────────

    /** Read the current manifest content. Throws if not found. */
    readManifest(wsRoot: string): string;

    /** Write manifest content (overwrite). */
    writeManifest(wsRoot: string, content: string): void;

    /**
     * Execute a function while holding a manifest lock.
     * The callback receives the current manifest content
     * and returns { content: newManifest | null, result: T }.
     * If content is non-null, it is written back atomically.
     */
    withManifestLock<T>(
        wsRoot: string,
        fn: (md: string) => { content: string | null; result: T }
    ): Promise<T>;

    // ── Agents ───────────────────────────────────────────────────────

    /** List agents in the Agents table. */
    listAgents(wsRoot: string): AgentRow[];

    /** Get a single agent row, or null. */
    getAgent(wsRoot: string, agentId: string): AgentRow | null;

    /** Add an agent row. Throws if already exists. */
    addAgent(wsRoot: string, agent: AgentRow): void;

    /** Update one or more fields of an agent. */
    updateAgent(wsRoot: string, agentId: string, fields: Partial<Omit<AgentRow, 'id'>>): void;

    /** Remove an agent from the manifest. */
    removeAgent(wsRoot: string, agentId: string): void;

    // ── Agent Progress (per-agent state) ─────────────────────────────

    /** Read agent progress, or null if not found. */
    readAgentProgress(wsRoot: string, agentId: string): AgentProgressData | null;

    /** Write (create or update) agent progress. */
    writeAgentProgress(wsRoot: string, progress: AgentProgressData): void;

    /** Read all agent progress for a session. */
    readAllAgentProgress(wsRoot: string, sessionId: string): AgentProgressData[];

    /** Clean up agent progress files. Returns count of cleaned files. */
    cleanupAgentFiles(wsRoot: string): number;

    // ── File Claims ──────────────────────────────────────────────────

    /**
     * Atomically claim a file. Throws if already actively claimed by another agent.
     * Returns true on success.
     */
    claimFile(wsRoot: string, agentId: string, filePath: string): boolean;

    /** Check if a file is claimed. Returns claims or empty array. */
    checkFileClaim(wsRoot: string, filePath: string): FileClaim[];

    /** Release a file claim. */
    releaseFileClaim(wsRoot: string, agentId: string, filePath: string, status: string): void;

    /** Release all claims for an agent (used on failure). */
    releaseAllClaims(wsRoot: string, agentId: string): string[];

    // ── Issues ────────────────────────────────────────────────────────

    /** Add an issue. */
    addIssue(wsRoot: string, issue: Issue): void;

    /** List all issues (manifest + agent progress). */
    listIssues(wsRoot: string): Issue[];

    // ── Phase Gates ──────────────────────────────────────────────────

    /** Get all phase gates. */
    getPhaseGates(wsRoot: string): PhaseGate[];

    /** Set a phase gate complete/incomplete. */
    setPhaseGate(wsRoot: string, phase: string, complete: boolean): void;

    // ── Events ────────────────────────────────────────────────────────

    /** Broadcast an event. */
    broadcastEvent(event: SwarmEvent): Promise<void>;

    /** Get events, optionally filtered. */
    getEvents(wsRoot: string, sessionId: string, eventType?: string): SwarmEvent[];

    /** Clean up events for a session. */
    cleanupEvents(wsRoot: string, sessionId: string): void;

    // ── Swarm Registry ───────────────────────────────────────────────

    /** Register a new swarm in the cross-workspace registry. */
    registerSwarm(info: SwarmInfo): Promise<void>;

    /** Update swarm registry entry. */
    updateSwarmRegistry(wsRoot: string, fields: Partial<SwarmInfo>): Promise<void>;

    /** Deregister a swarm. */
    deregisterSwarm(wsRoot: string): Promise<void>;

    /** List all active swarms. */
    listActiveSwarms(): SwarmInfo[];

    // ── Session ──────────────────────────────────────────────────────

    /** Extract session ID from manifest content. */
    extractSessionId(md: string): string;

    /** Generate a new session ID. */
    generateSessionId(): string;

    // ── Status ────────────────────────────────────────────────────────

    /** Write the swarm_status.json quick-read file. */
    writeSwarmStatus(wsRoot: string, lastEvent: string): void;
}
