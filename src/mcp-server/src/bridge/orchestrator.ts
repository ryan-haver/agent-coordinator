/**
 * Orchestrator — fully automated swarm execution engine.
 *
 * Runs the complete swarm lifecycle:
 *   1. Read manifest → extract phases and agents
 *   2. For each phase: spawn agents → poll completion → verify → advance
 *   3. Handle retries for failed agents
 *   4. Produce final report via complete_swarm
 */
import { getBridgeClient } from "./client.js";
import { getRateLimiter } from "./rate-limiter.js";
import { getErrorDetector } from "./error-detector.js";
import { getVerifier, Verifier } from "./verifier.js";

export interface OrchestratorConfig {
    autoVerify: boolean;
    autoRetry: boolean;
    maxRetries: number;
    pollIntervalMs: number;
    /** Max time to wait for a phase to complete (ms) */
    phaseTimeoutMs: number;
}

export interface PhaseResult {
    phase: string;
    agents: AgentResult[];
    allPassed: boolean;
    durationMs: number;
}

export interface AgentResult {
    agentId: string;
    role: string;
    status: "completed" | "failed" | "timeout" | "verified";
    attempt: number;
    error?: string;
    verificationPassed?: boolean;
}

export interface SwarmExecutionResult {
    success: boolean;
    phases: PhaseResult[];
    totalAgents: number;
    completedAgents: number;
    failedAgents: number;
    totalDurationMs: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
    autoVerify: true,
    autoRetry: true,
    maxRetries: 2,
    pollIntervalMs: 30_000,
    phaseTimeoutMs: 30 * 60_000, // 30 minutes per phase
};

/**
 * Parse a swarm manifest to extract phases and their agents.
 */
export function parseManifestPhases(manifestContent: string): Map<string, Array<{
    id: string;
    role: string;
    model: string;
    scope: string;
}>> {
    const phases = new Map<string, Array<{ id: string; role: string; model: string; scope: string }>>();

    // Parse Agents table from markdown
    const agentsMatch = manifestContent.match(/## Agents\s*\n\|[^\n]*\|\s*\n\|[-\s|]*\|\s*\n([\s\S]*?)(?:\n##\s|$)/);
    if (!agentsMatch) return phases;

    const rows = agentsMatch[1].split("\n").filter(l => l.trim().startsWith("|"));
    for (const row of rows) {
        const cells = row.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.length < 5) continue;

        const [id, role, model, phase, scope] = cells;
        if (!id || !phase) continue;

        const phaseAgents = phases.get(phase) ?? [];
        phaseAgents.push({ id, role, model, scope });
        phases.set(phase, phaseAgents);
    }

    return phases;
}

/**
 * Build a structured execution plan from manifest phases.
 */
export function buildExecutionPlan(
    phases: Map<string, Array<{ id: string; role: string; model: string; scope: string }>>,
): Array<{ phase: string; agents: Array<{ id: string; role: string; model: string; scope: string }> }> {
    return Array.from(phases.entries())
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([phase, agents]) => ({ phase, agents }));
}

/**
 * The Orchestrator class manages the full swarm execution lifecycle.
 * It coordinates with MCP tools via callback functions to stay decoupled.
 */
export class Orchestrator {
    private config: OrchestratorConfig;

    constructor(config?: Partial<OrchestratorConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Get current configuration.
     */
    getConfig(): OrchestratorConfig {
        return { ...this.config };
    }

    /**
     * Update orchestrator config.
     */
    updateConfig(partial: Partial<OrchestratorConfig>): void {
        this.config = { ...this.config, ...partial };
    }

    /**
     * Build a summary of what would be executed.
     * Useful for dry-run / preview before spawning.
     */
    planSummary(manifestContent: string): {
        phases: Array<{ phase: string; agentCount: number; agents: string[] }>;
        totalAgents: number;
    } {
        const phases = parseManifestPhases(manifestContent);
        const plan = buildExecutionPlan(phases);

        return {
            phases: plan.map(p => ({
                phase: p.phase,
                agentCount: p.agents.length,
                agents: p.agents.map(a => `${a.id} (${a.role})`),
            })),
            totalAgents: plan.reduce((sum, p) => sum + p.agents.length, 0),
        };
    }
}

/** Singleton orchestrator instance */
let _orchestrator: Orchestrator | undefined;

export function getOrchestrator(): Orchestrator {
    if (!_orchestrator) {
        _orchestrator = new Orchestrator();
    }
    return _orchestrator;
}
