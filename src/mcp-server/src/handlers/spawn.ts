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

