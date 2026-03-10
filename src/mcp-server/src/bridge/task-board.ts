/**
 * TaskBoard — aggregates agent progress into a central view.
 *
 * Reads all agent progress from StorageAdapter and produces a structured
 * board showing per-phase status, useful for orchestrator phase advancement.
 */

export interface TaskBoardEntry {
    agentId: string;
    role: string;
    phase: string;
    status: "spawned" | "active" | "completed" | "failed" | "blocked" | "verified";
    detail: string;
    lastUpdated: string;
    issues: number;
}

export interface PhaseStatus {
    phase: string;
    agents: TaskBoardEntry[];
    completedCount: number;
    failedCount: number;
    blockedCount: number;
    activeCount: number;
    allDone: boolean;
    allPassed: boolean;
}

export interface TaskBoardSnapshot {
    sessionId: string;
    phases: PhaseStatus[];
    totalAgents: number;
    completedAgents: number;
    failedAgents: number;
    blockedAgents: number;
    activeAgents: number;
    overallStatus: "idle" | "running" | "completed" | "failed" | "blocked";
    updatedAt: string;
}

/**
 * Build a TaskBoard snapshot from agent progress data.
 */
export function buildTaskBoard(
    sessionId: string,
    progressData: Array<{
        agent_id: string;
        role: string;
        phase: string;
        status: string;
        detail: string;
        issues: Array<{ severity: string; area: string; description: string }>;
        last_updated: string;
    }>,
): TaskBoardSnapshot {
    // Group by phase
    const phaseMap = new Map<string, TaskBoardEntry[]>();

    for (const p of progressData) {
        const normalizedStatus = normalizeStatus(p.status);
        const entry: TaskBoardEntry = {
            agentId: p.agent_id,
            role: p.role,
            phase: p.phase,
            status: normalizedStatus,
            detail: p.detail,
            lastUpdated: p.last_updated,
            issues: p.issues?.length ?? 0,
        };

        const existing = phaseMap.get(p.phase) ?? [];
        existing.push(entry);
        phaseMap.set(p.phase, existing);
    }

    // Build phase statuses sorted by phase number
    const phases: PhaseStatus[] = Array.from(phaseMap.entries())
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([phase, agents]) => {
            const completedCount = agents.filter(a => a.status === "completed" || a.status === "verified").length;
            const failedCount = agents.filter(a => a.status === "failed").length;
            const blockedCount = agents.filter(a => a.status === "blocked").length;
            const activeCount = agents.filter(a => a.status === "active" || a.status === "spawned").length;

            return {
                phase,
                agents,
                completedCount,
                failedCount,
                blockedCount,
                activeCount,
                allDone: activeCount === 0 && agents.length > 0,
                allPassed: completedCount === agents.length && agents.length > 0,
            };
        });

    // Aggregate totals
    const totalAgents = progressData.length;
    const completedAgents = phases.reduce((s, p) => s + p.completedCount, 0);
    const failedAgents = phases.reduce((s, p) => s + p.failedCount, 0);
    const blockedAgents = phases.reduce((s, p) => s + p.blockedCount, 0);
    const activeAgents = phases.reduce((s, p) => s + p.activeCount, 0);

    let overallStatus: TaskBoardSnapshot["overallStatus"];
    if (totalAgents === 0) {
        overallStatus = "idle";
    } else if (blockedAgents > 0) {
        overallStatus = "blocked";
    } else if (failedAgents > 0 && activeAgents === 0) {
        overallStatus = "failed";
    } else if (completedAgents === totalAgents) {
        overallStatus = "completed";
    } else {
        overallStatus = "running";
    }

    return {
        sessionId,
        phases,
        totalAgents,
        completedAgents,
        failedAgents,
        blockedAgents,
        activeAgents,
        overallStatus,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Normalize various status strings into canonical values.
 */
function normalizeStatus(raw: string): TaskBoardEntry["status"] {
    const lower = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (lower.includes("complete") || lower.includes("done") || lower.includes("finished")) return "completed";
    if (lower.includes("verified")) return "verified";
    if (lower.includes("fail") || lower.includes("error")) return "failed";
    if (lower.includes("block") || lower.includes("stuck")) return "blocked";
    if (lower.includes("active") || lower.includes("running") || lower.includes("working")) return "active";
    if (lower.includes("spawn") || lower.includes("pending") || lower.includes("queued")) return "spawned";
    return "active"; // Default to active for unknown statuses
}

/**
 * Singleton TaskBoard that uses StorageAdapter under the hood.
 */
export class TaskBoard {
    private lastSnapshot: TaskBoardSnapshot | null = null;

    /**
     * Get current task board by reading all agent progress for a session.
     */
    async getBoard(wsRoot: string, sessionId: string): Promise<TaskBoardSnapshot> {
        const { getStorage } = await import("../storage/singleton.js");
        const storage = getStorage();
        const progressData = storage.readAllAgentProgress(wsRoot, sessionId);

        const snapshot = buildTaskBoard(sessionId, progressData);
        this.lastSnapshot = snapshot;
        return snapshot;
    }

    /**
     * Get the last computed snapshot without re-querying.
     */
    getCached(): TaskBoardSnapshot | null {
        return this.lastSnapshot;
    }

    /**
     * Check if a specific phase is ready to advance.
     * A phase can advance when all agents are done (complete, verified, or failed+blocked).
     */
    isPhaseReady(phaseId: string): boolean {
        if (!this.lastSnapshot) return false;
        const phase = this.lastSnapshot.phases.find(p => p.phase === phaseId);
        return phase?.allDone ?? false;
    }

    /**
     * Get agents that need retry in a specific phase.
     */
    getRetryableAgents(phaseId: string): TaskBoardEntry[] {
        if (!this.lastSnapshot) return [];
        const phase = this.lastSnapshot.phases.find(p => p.phase === phaseId);
        if (!phase) return [];
        return phase.agents.filter(a => a.status === "failed");
    }

    /**
     * Reset cached state.
     */
    reset(): void {
        this.lastSnapshot = null;
    }
}

/** Singleton */
let _taskBoard: TaskBoard | undefined;

export function getTaskBoard(): TaskBoard {
    if (!_taskBoard) {
        _taskBoard = new TaskBoard();
    }
    return _taskBoard;
}
