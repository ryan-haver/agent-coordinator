/**
 * Spawn handler — spawn_agent, get_bridge_status, stop_agent MCP tools.
 *
 * Bridges the MCP server to the Agent Bridge VS Code extension.
 * Combines prompt generation, manifest registration, rate limiting,
 * and bridge HTTP calls into a single orchestrated flow.
 */
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import { getBridgeClient } from "../bridge/client.js";
import { getRateLimiter } from "../bridge/rate-limiter.js";
import { getErrorDetector } from "../bridge/error-detector.js";
import { getVerifier, Verifier } from "../bridge/verifier.js";
import { getOrchestrator } from "../bridge/orchestrator.js";
import { handleGetAgentPrompt } from "./agents.js";
import { handleAddAgentToManifest } from "./agents.js";

/**
 * spawn_agent — Generate prompt, register agent, spawn via bridge.
 *
 * Flow:
 *   1. Check rate limiter
 *   2. Generate prompt from template (or use custom_prompt)
 *   3. Register agent in manifest
 *   4. Spawn via bridge HTTP API
 *   5. Start error detector watch
 */
export async function handleSpawnAgent(args: Record<string, unknown>): Promise<ToolResponse> {
    const role = args?.role as string;
    const mission = args?.mission as string;
    const scope = args?.scope as string;
    const agent_id = args?.agent_id as string;
    const phase = (args?.phase as string) ?? "1";
    const model = (args?.model as string) ?? "auto";
    const custom_prompt = args?.custom_prompt as string | undefined;

    if (!role || !mission || !scope || !agent_id) {
        throw new Error("Missing required arguments: role, mission, scope, agent_id");
    }

    // 1. Rate limit check
    const limiter = getRateLimiter();
    const check = limiter.check();
    if (!check.allowed) {
        return {
            toolResult: `Rate limited: ${check.reason}`,
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: false,
                    error: check.reason,
                    waitMs: check.waitMs,
                    stats: limiter.getStats(),
                }, null, 2),
            }],
        };
    }

    // 2. Generate prompt
    let prompt: string;
    if (custom_prompt) {
        prompt = custom_prompt;
    } else {
        const wsRoot = resolveWorkspaceRoot(args);
        const promptResult = await handleGetAgentPrompt({
            role,
            mission,
            scope,
            agent_id,
            workspace_root: wsRoot,
        });
        prompt = promptResult.toolResult as string;
    }

    // 3. Register agent in manifest (non-fatal if fails — agent can still spawn)
    try {
        await handleAddAgentToManifest({
            agent_id,
            role,
            model,
            phase,
            scope,
            workspace_root: args?.workspace_root,
        });
    } catch (err) {
        // Agent may already exist from a previous attempt — continue
        const errMsg = (err as Error).message;
        if (!errMsg.includes("already exists")) {
            // Log but don't block spawn
        }
    }

    // 4. Spawn via bridge
    const client = getBridgeClient();
    const result = await client.spawn(prompt, {
        newConversation: true,
        background: true,
        agentManager: true,
    });

    if (!result.success) {
        limiter.recordError();
        return {
            toolResult: `Spawn failed: ${result.error}`,
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: false,
                    agent_id,
                    role,
                    error: result.error,
                    stats: limiter.getStats(),
                }, null, 2),
            }],
        };
    }

    // 5. Record spawn and start watching
    limiter.recordSpawn();
    if (result.conversationId) {
        const detector = getErrorDetector();
        detector.watchAgent(agent_id, result.conversationId);
    }

    return {
        toolResult: `Agent ${agent_id} spawned successfully`,
        content: [{
            type: "text",
            text: JSON.stringify({
                success: true,
                agent_id,
                role,
                phase,
                model,
                conversationId: result.conversationId,
                promptLength: result.promptLength,
                stats: limiter.getStats(),
            }, null, 2),
        }],
    };
}

/**
 * get_bridge_status — Health check and conversation list.
 */
export async function handleGetBridgeStatus(_args: Record<string, unknown>): Promise<ToolResponse> {
    const client = getBridgeClient();
    const health = await client.ping();
    const limiter = getRateLimiter();
    const detector = getErrorDetector();

    let conversations: unknown[] = [];
    if (health.online) {
        conversations = await client.getConversations();
    }

    const status = {
        bridge: health,
        rateLimiter: limiter.getStats(),
        watches: detector.getWatches().map(w => ({
            agentId: w.agentId,
            status: w.status,
            attempt: w.attempt,
            runningFor: `${Math.round((Date.now() - w.startedAt) / 1000)}s`,
            lastError: w.lastError,
        })),
        conversations,
    };

    return {
        toolResult: JSON.stringify(status),
        content: [{
            type: "text",
            text: JSON.stringify(status, null, 2),
        }],
    };
}

/**
 * stop_agent — Mark agent as stopped and unwatch.
 */
export async function handleStopAgent(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const reason = (args?.reason as string) ?? "Manually stopped";
    if (!agent_id) throw new Error("Missing required argument: agent_id");

    const detector = getErrorDetector();
    const watch = detector.getWatch(agent_id);

    // Unwatch the agent
    detector.unwatchAgent(agent_id);

    // Decrement active count
    const limiter = getRateLimiter();
    limiter.recordCompletion();

    return {
        toolResult: `Agent ${agent_id} stopped`,
        content: [{
            type: "text",
            text: JSON.stringify({
                agent_id,
                reason,
                wasWatched: !!watch,
                conversationId: watch?.conversationId,
                ranFor: watch ? `${Math.round((Date.now() - watch.startedAt) / 1000)}s` : "unknown",
            }, null, 2),
        }],
    };
}

/**
 * verify_agent_work — Run verification checks on completed agent work.
 */
export async function handleVerifyAgentWork(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    if (!agent_id) throw new Error("Missing required argument: agent_id");

    const wsRoot = args?.workspace_root ? resolveWorkspaceRoot(args) : undefined;
    const verifier = getVerifier();

    // Optionally filter to specific checks
    const checkNames = args?.checks as string[] | undefined;
    if (checkNames && checkNames.length > 0) {
        const allChecks = verifier.getChecks();
        verifier.setChecks(allChecks.filter(c => checkNames.includes(c.name)));
    }

    const result = await verifier.verify(wsRoot);

    // Restore full check list if we filtered
    if (checkNames && checkNames.length > 0) {
        verifier.setChecks(getVerifier().getChecks());
    }

    const retryContext = result.passed ? "" : Verifier.buildRetryContext(result);

    return {
        toolResult: JSON.stringify({ agent_id, ...result }),
        content: [{
            type: "text",
            text: JSON.stringify({
                agent_id,
                passed: result.passed,
                checks: result.checks.map(c => ({
                    name: c.name,
                    passed: c.passed,
                    durationMs: c.durationMs,
                    output: c.output.slice(0, 500),
                })),
                totalDurationMs: result.totalDurationMs,
                retryContext: retryContext ? "(available — append to agent prompt for retry)" : "(not needed)",
            }, null, 2),
        }],
    };
}

/**
 * run_swarm — Preview swarm execution plan from manifest.
 *
 * Parses the manifest, extracts phases and agents, and returns
 * a structured plan. Does NOT auto-execute — use spawn_agent for each.
 */
export async function handleRunSwarm(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const autoVerify = (args?.auto_verify as boolean) ?? true;
    const autoRetry = (args?.auto_retry as boolean) ?? true;

    // Read manifest
    const { getStorage } = await import("../storage/singleton.js");
    const storage = getStorage();
    const manifest = storage.readManifest(wsRoot);

    if (!manifest || manifest.trim().length === 0) {
        throw new Error("No swarm manifest found. Create one first with create_swarm_manifest.");
    }

    // Parse and build plan
    const orchestrator = getOrchestrator();
    orchestrator.updateConfig({ autoVerify, autoRetry });
    const plan = orchestrator.planSummary(manifest);

    // Bridge health check
    const client = getBridgeClient();
    const health = await client.ping();

    return {
        toolResult: JSON.stringify(plan),
        content: [{
            type: "text",
            text: JSON.stringify({
                bridgeOnline: health.online,
                config: orchestrator.getConfig(),
                plan,
                instructions: plan.totalAgents > 0
                    ? `Ready to execute. Call spawn_agent for each agent in phase order. Use poll_agent_completion to wait for phases, verify_agent_work to check, and advance_phase to move forward.`
                    : "No agents found in manifest. Add agents first with add_agent_to_manifest.",
            }, null, 2),
        }],
    };
}

/**
 * execute_swarm — Fully automated swarm execution.
 *
 * Reads the manifest, spawns agents phase-by-phase, polls for completion,
 * runs verification, retries failures, and returns a full execution report.
 */
export async function handleExecuteSwarm(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const autoVerify = (args?.auto_verify as boolean) ?? true;
    const autoRetry = (args?.auto_retry as boolean) ?? true;
    const dryRun = (args?.dry_run as boolean) ?? false;

    // Read manifest
    const { getStorage } = await import("../storage/singleton.js");
    const storage = getStorage();
    const manifest = storage.readManifest(wsRoot);

    if (!manifest || manifest.trim().length === 0) {
        throw new Error("No swarm manifest found. Create one first with create_swarm_manifest.");
    }

    const orchestrator = getOrchestrator();
    orchestrator.updateConfig({ autoVerify, autoRetry });

    // Dry run — return plan only
    if (dryRun) {
        const plan = orchestrator.planSummary(manifest);
        return {
            toolResult: JSON.stringify(plan),
            content: [{
                type: "text",
                text: JSON.stringify({
                    dryRun: true,
                    config: orchestrator.getConfig(),
                    plan,
                }, null, 2),
            }],
        };
    }

    // Bridge health check
    const client = getBridgeClient();
    const health = await client.ping();
    if (!health.online) {
        throw new Error("Agent Bridge is offline. Start the Antigravity extension first.");
    }

    // Execute with callbacks that wire into existing handlers
    const result = await orchestrator.execute(manifest, {
        spawnAgent: async (agent) => {
            await handleSpawnAgent({
                role: agent.role,
                mission: `Execute assigned scope: ${agent.scope}`,
                scope: agent.scope,
                agent_id: agent.id,
                phase: "1", // Phase is embedded in manifest
                model: agent.model,
                workspace_root: wsRoot,
            });
        },
        retryAgent: async (agent, retryContext, attempt) => {
            await handleSpawnAgent({
                role: agent.role,
                mission: `RETRY (attempt ${attempt}): ${agent.scope}`,
                scope: agent.scope,
                agent_id: `${agent.id}-retry-${attempt}`,
                model: agent.model,
                custom_prompt: retryContext,
                workspace_root: wsRoot,
            });
        },
    });

    return {
        toolResult: JSON.stringify(result),
        content: [{
            type: "text",
            text: JSON.stringify({
                success: result.success,
                totalAgents: result.totalAgents,
                completedAgents: result.completedAgents,
                failedAgents: result.failedAgents,
                totalDurationMs: result.totalDurationMs,
                phases: result.phases.map(p => ({
                    phase: p.phase,
                    allPassed: p.allPassed,
                    durationMs: p.durationMs,
                    agents: p.agents.map(a => ({
                        agentId: a.agentId,
                        status: a.status,
                        attempt: a.attempt,
                        error: a.error,
                    })),
                })),
            }, null, 2),
        }],
    };
}

/**
 * retry_agent — Re-spawn an agent with error context prepended.
 */
export async function handleRetryAgent(args: Record<string, unknown>): Promise<ToolResponse> {
    const agent_id = args?.agent_id as string;
    const error_context = args?.error_context as string;
    if (!agent_id) throw new Error("Missing required argument: agent_id");

    const wsRoot = resolveWorkspaceRoot(args);

    // Look up original agent from storage
    const { getStorage } = await import("../storage/singleton.js");
    const storage = getStorage();
    const agent = storage.getAgent(wsRoot, agent_id);
    if (!agent) throw new Error(`Agent ${agent_id} not found in manifest`);

    // Build retry prompt
    let retryPrompt = error_context ?? "";
    if (!retryPrompt) {
        // Auto-generate from verification
        const verifier = getVerifier();
        const verification = await verifier.verify(wsRoot);
        if (!verification.passed) {
            const { Verifier: V } = await import("../bridge/verifier.js");
            retryPrompt = V.buildRetryContext(verification);
        }
    }

    // Re-spawn with retry context
    const attempt = (args?.attempt as number) ?? 2;
    const result = await handleSpawnAgent({
        role: agent.role,
        mission: `RETRY (attempt ${attempt}): Fix verification failures and complete assigned scope`,
        scope: agent.scope,
        agent_id: `${agent_id}-retry-${attempt}`,
        model: agent.model,
        custom_prompt: retryPrompt,
        workspace_root: wsRoot,
    });

    return result;
}
