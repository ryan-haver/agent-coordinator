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

    /**
     * Execute a single phase — spawn agents, poll, verify, retry.
     *
     * Uses callbacks so the orchestrator stays decoupled from handlers.
     */
    async executePhase(
        agents: Array<{ id: string; role: string; model: string; scope: string }>,
        callbacks: ExecutionCallbacks,
    ): Promise<PhaseResult> {
        const start = Date.now();
        const results: AgentResult[] = [];

        // 1. Spawn all agents (respecting rate limits)
        for (const agent of agents) {
            try {
                const limiter = getRateLimiter();
                const check = limiter.check();
                if (!check.allowed) {
                    // Wait before retrying
                    await sleep(check.waitMs ?? 5000);
                }

                await callbacks.spawnAgent(agent);
                limiter.recordSpawn();
                results.push({
                    agentId: agent.id,
                    role: agent.role,
                    status: "completed", // Will be updated during polling
                    attempt: 1,
                });
            } catch (err) {
                results.push({
                    agentId: agent.id,
                    role: agent.role,
                    status: "failed",
                    attempt: 1,
                    error: (err as Error).message,
                });
            }
        }

        // 2. Poll for completion
        const deadline = Date.now() + this.config.phaseTimeoutMs;
        const detector = getErrorDetector();

        while (Date.now() < deadline) {
            const watches = detector.getWatches();
            const activeAgentIds = new Set(
                watches
                    .filter(w => w.status === "running")
                    .map(w => w.agentId)
            );

            // Check if all agents for this phase are done
            const phaseAgentIds = new Set(agents.map(a => a.id));
            const stillRunning = [...phaseAgentIds].filter(id => activeAgentIds.has(id));

            if (stillRunning.length === 0) break;

            // Notify progress
            if (callbacks.onProgress) {
                callbacks.onProgress({
                    activeAgents: stillRunning.length,
                    totalAgents: agents.length,
                    elapsedMs: Date.now() - start,
                });
            }

            await sleep(this.config.pollIntervalMs);
        }

        // 3. Verify completed agents
        if (this.config.autoVerify) {
            const verifier = getVerifier();
            const verification = await verifier.verify();

            for (const result of results) {
                if (result.status === "failed") continue;

                if (verification.passed) {
                    result.status = "verified";
                    result.verificationPassed = true;
                } else {
                    result.verificationPassed = false;

                    // 4. Retry on failure
                    if (this.config.autoRetry && result.attempt < this.config.maxRetries) {
                        const retryContext = Verifier.buildRetryContext(verification);
                        try {
                            const agent = agents.find(a => a.id === result.agentId);
                            if (agent && callbacks.retryAgent) {
                                await callbacks.retryAgent(agent, retryContext, result.attempt + 1);
                                result.attempt += 1;
                                result.status = "completed"; // Will be re-verified
                            }
                        } catch (err) {
                            result.status = "failed";
                            result.error = `Retry failed: ${(err as Error).message}`;
                        }
                    } else {
                        result.status = "failed";
                        result.error = "Verification failed after max retries";
                    }
                }
            }
        }

        // Update statuses for timed-out agents
        for (const result of results) {
            if (result.status === "completed") {
                const watch = detector.getWatch(result.agentId);
                if (watch?.status === "running") {
                    result.status = "timeout";
                }
            }
        }

        const allPassed = results.every(r => r.status === "verified" || r.status === "completed");

        return {
            phase: agents[0]?.role ?? "unknown",
            agents: results,
            allPassed,
            durationMs: Date.now() - start,
        };
    }

    /**
     * Execute the full swarm — all phases in sequence.
     */
    async execute(
        manifestContent: string,
        callbacks: ExecutionCallbacks,
    ): Promise<SwarmExecutionResult> {
        const start = Date.now();
        const phases = parseManifestPhases(manifestContent);
        const plan = buildExecutionPlan(phases);
        const phaseResults: PhaseResult[] = [];

        for (const { phase, agents } of plan) {
            const phaseResult = await this.executePhase(agents, callbacks);
            phaseResult.phase = phase;
            phaseResults.push(phaseResult);

            // Notify phase completion
            if (callbacks.onPhaseComplete) {
                callbacks.onPhaseComplete(phase, phaseResult);
            }

            // If phase failed and we shouldn't continue, stop
            if (!phaseResult.allPassed && !this.config.autoRetry) {
                break;
            }
        }

        const totalAgents = phaseResults.reduce((s, p) => s + p.agents.length, 0);
        const completedAgents = phaseResults.reduce(
            (s, p) => s + p.agents.filter(a => a.status === "verified" || a.status === "completed").length,
            0,
        );
        const failedAgents = phaseResults.reduce(
            (s, p) => s + p.agents.filter(a => a.status === "failed" || a.status === "timeout").length,
            0,
        );

        return {
            success: failedAgents === 0,
            phases: phaseResults,
            totalAgents,
            completedAgents,
            failedAgents,
            totalDurationMs: Date.now() - start,
        };
    }
}

/** Callback interface — keeps Orchestrator decoupled from MCP handlers */
export interface ExecutionCallbacks {
    spawnAgent(agent: { id: string; role: string; model: string; scope: string }): Promise<void>;
    retryAgent?(agent: { id: string; role: string; model: string; scope: string }, retryContext: string, attempt: number): Promise<void>;
    onProgress?(info: { activeAgents: number; totalAgents: number; elapsedMs: number }): void;
    onPhaseComplete?(phase: string, result: PhaseResult): void;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Singleton orchestrator instance */
let _orchestrator: Orchestrator | undefined;

export function getOrchestrator(): Orchestrator {
    if (!_orchestrator) {
        _orchestrator = new Orchestrator();
    }
    return _orchestrator;
}
