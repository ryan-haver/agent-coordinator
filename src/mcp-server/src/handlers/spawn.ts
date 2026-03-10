/**
 * Spawn handler — spawn_agent, get_bridge_status, stop_agent MCP tools.
 *
 * Routes agent spawn requests through the ProviderRegistry, which
 * selects the best provider based on model, capabilities, and capacity.
 * Combines prompt generation, manifest registration, rate limiting,
 * and provider dispatch into a single orchestrated flow.
 */
import { resolveWorkspaceRoot, type ToolResponse } from "./context.js";
import { getBridgeClient } from "../bridge/client.js";
import { getProviderRegistry } from "../bridge/registry.js";
import { getRateLimiter } from "../bridge/rate-limiter.js";
import { getErrorDetector } from "../bridge/error-detector.js";
import { getVerifier, Verifier } from "../bridge/verifier.js";
import { getOrchestrator } from "../bridge/orchestrator.js";
import { getAutoApprover } from "../bridge/auto-approver.js";
import type { SpawnResult } from "../bridge/provider.js";
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
    const providerName = args?.provider as string | undefined;

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

    // 4. Select provider and spawn with dynamic failover
    const registry = getProviderRegistry();
    const attemptedProviders = new Set<string>();
    
    let result: SpawnResult | null = null;
    let selectedProvider = "";
    let providerReason = "";

    // Try up to 3 times to find a working provider if we hit quota limits
    for (let attempt = 0; attempt < 3; attempt++) {
        const selection = registry.selectProvider({
            provider: attempt === 0 ? providerName : undefined, // Only respect explicit on first try
            model: model !== "auto" ? model : undefined,
            capabilities: ["file-edit"],
            excludeProviders: Array.from(attemptedProviders)
        });

        if (!selection) {
            break; // No more eligible providers
        }

        selectedProvider = selection.provider.name;
        providerReason = selection.reason;
        attemptedProviders.add(selectedProvider);

        result = await selection.provider.spawn(prompt, {
            newConversation: true,
            background: true,
            agentManager: true,
        });

        if (result.success) {
            break; // Success!
        }

        // Determine if error is a quota/rate-limit error that warrants a failover
        const errStr = result.error?.toLowerCase() || "";
        const isQuotaError = errStr.includes("429") || 
                             errStr.includes("quota") || 
                             errStr.includes("rate limit") ||
                             errStr.includes("too many requests");

        if (!isQuotaError) {
            break; // Fatal error (e.g., config issue, bad prompt), don't retry
        }
        
        // Is quota error; loop continues and excludes this provider
        console.warn(`[Quota Router] Provider ${selectedProvider} hit quota limit. Failing over...`);
    }

    // Fallback: direct bridge client (legacy path) if all registry providers failed/exhausted
    if (!result || (!result.success && Array.from(attemptedProviders).length === 0)) {
        const client = getBridgeClient();
        const fallbackResult = await client.spawn(prompt, {
            newConversation: true,
            background: true,
            agentManager: true,
        });
        if (!fallbackResult.success) {
            limiter.recordError();
            return {
                toolResult: `Spawn failed (fallback): ${fallbackResult.error}`,
                content: [{ type: "text", text: JSON.stringify({
                    success: false, agent_id, role,
                    error: `No provider available. Fallback error: ${fallbackResult.error}`,
                    stats: limiter.getStats(),
                }, null, 2) }],
            };
        }
        limiter.recordSpawn();
        if (fallbackResult.conversationId) {
            getErrorDetector().watchAgent(agent_id, fallbackResult.conversationId, "antigravity (fallback)");
        }
        return {
            toolResult: `Agent ${agent_id} spawned (fallback)`,
            content: [{ type: "text", text: JSON.stringify({
                success: true, agent_id, role, phase, model,
                provider: "antigravity (fallback)",
                conversationId: fallbackResult.conversationId,
                promptLength: fallbackResult.promptLength,
                stats: limiter.getStats(),
            }, null, 2) }],
        };
    }

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
    registry.recordSpawn(selectedProvider);
    if (result.conversationId) {
        const detector = getErrorDetector();
        detector.watchAgent(agent_id, result.conversationId, selectedProvider);
    }

    return {
        toolResult: `Agent ${agent_id} spawned successfully via ${selectedProvider}`,
        content: [{
            type: "text",
            text: JSON.stringify({
                success: true,
                agent_id,
                role,
                phase,
                model,
                provider: selectedProvider,
                providerReason,
                conversationId: result.conversationId,
                promptLength: result.promptLength,
                stats: limiter.getStats(),
            }, null, 2),
        }],
    };
}

/**
 * get_bridge_status — Provider health and agent status.
 *
 * Reports all registered providers, their health, and active agent watches.
 * Backward-compatible: still reports bridge-specific data.
 */
export async function handleGetBridgeStatus(_args: Record<string, unknown>): Promise<ToolResponse> {
    const registry = getProviderRegistry();
    const limiter = getRateLimiter();
    const detector = getErrorDetector();

    // Health-check all registered providers
    const healthMap = await registry.pingAll();
    const providers = registry.listProviders().map(p => ({
        name: p.name,
        displayName: p.displayName,
        enabled: p.enabled,
        priority: p.priority,
        online: healthMap.get(p.name)?.online ?? false,
        latencyMs: healthMap.get(p.name)?.latencyMs ?? -1,
        activeCount: p.activeCount,
        maxConcurrent: p.maxConcurrent,
        models: p.models,
        capabilities: p.capabilities,
    }));

    // Backward compat: try to get conversations from bridge
    let conversations: unknown[] = [];
    try {
        const client = getBridgeClient();
        const bridgeHealth = await client.ping();
        if (bridgeHealth.online) {
            conversations = await client.getConversations();
        }
    } catch { /* bridge may not be available */ }

    const status = {
        providers,
        rateLimiter: limiter.getStats(),
        watches: detector.getWatches().map(w => ({
            agentId: w.agentId,
            status: w.status,
            attempt: w.attempt,
            runningFor: `${Math.round((Date.now() - w.startedAt) / 1000)}s`,
            lastError: w.lastError,
        })),
        conversations,
        totalActive: registry.getTotalActiveCount(),
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

    // Provider health check
    const registry = getProviderRegistry();
    const defaultProvider = registry.getDefault();
    const health = defaultProvider
        ? await defaultProvider.ping()
        : { online: false, latencyMs: -1 };

    return {
        toolResult: JSON.stringify(plan),
        content: [{
            type: "text",
            text: JSON.stringify({
                providerOnline: health.online,
                provider: defaultProvider?.name ?? "none",
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
    const autoApprove = (args?.auto_approve as boolean) ?? true;

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

    // Provider health check
    const registry = getProviderRegistry();
    const defaultProvider = registry.getDefault();
    if (!defaultProvider) {
        throw new Error("No providers registered. Check providers.json or start the Antigravity extension.");
    }
    const health = await defaultProvider.ping();
    if (!health.online) {
        throw new Error(`Provider '${defaultProvider.name}' is offline. Start the provider or enable another.`);
    }

    // Start auto-approver if requested
    const approver = getAutoApprover();
    if (autoApprove) {
        approver.start();
    }

    // Execute with callbacks that wire into existing handlers
    const result = await orchestrator.execute(manifest, {
        spawnAgent: async (agent) => {
            const spawnResult = await handleSpawnAgent({
                role: agent.role,
                mission: `Execute assigned scope: ${agent.scope}`,
                scope: agent.scope,
                agent_id: agent.id,
                phase: "1", // Phase is embedded in manifest
                model: agent.model,
                workspace_root: wsRoot,
            });

            // Track spawned cascade for auto-approval
            if (autoApprove && spawnResult?.content?.[0]) {
                try {
                    const data = JSON.parse((spawnResult.content[0] as { text: string }).text);
                    if (data.conversationId) {
                        approver.trackCascade(data.conversationId);
                    }
                } catch { /* best effort */ }
            }
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

    // Stop auto-approver after execution completes
    if (autoApprove) {
        approver.stop();
    }

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
                autoApprover: approver.getStatus(),
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

/**
 * auto_approver — Control the auto-approver for agent interactions.
 *
 * Actions:
 *   - start: Begin auto-approving interactions for tracked cascades
 *   - stop: Stop auto-approving
 *   - status: Get current auto-approver status and log
 *   - approve: Manually approve a specific interaction
 *   - track: Track a cascade ID for auto-approval
 */
export async function handleAutoApprover(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = args?.action as string;

    if (!action) {
        throw new Error("Missing required argument: action (start|stop|status|approve|track)");
    }

    const approver = getAutoApprover();

    switch (action) {
        case "start": {
            const config = args?.config as Record<string, unknown> | undefined;
            if (config) {
                approver.updateConfig({
                    pollIntervalMs: config.poll_interval_ms as number | undefined,
                    approveFileWrites: config.approve_file_writes as boolean | undefined,
                    approveCommands: config.approve_commands as boolean | undefined,
                });
            }
            approver.start();
            return {
                toolResult: "Auto-approver started",
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, status: approver.getStatus() }, null, 2),
                }],
            };
        }

        case "stop": {
            approver.stop();
            return {
                toolResult: "Auto-approver stopped",
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, status: approver.getStatus() }, null, 2),
                }],
            };
        }

        case "status": {
            return {
                toolResult: JSON.stringify(approver.getStatus()),
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: approver.getStatus(),
                        recentApprovals: approver.getLog().slice(-10),
                    }, null, 2),
                }],
            };
        }

        case "track": {
            const cascadeId = args?.cascade_id as string;
            if (!cascadeId) throw new Error("Missing cascade_id for track action");
            approver.trackCascade(cascadeId);
            return {
                toolResult: `Tracking cascade ${cascadeId}`,
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, cascadeId, status: approver.getStatus() }, null, 2),
                }],
            };
        }

        case "approve": {
            const { getAutoApprover: getAA } = await import("../bridge/auto-approver.js");
            const aa = getAA();
            const cascadeId = args?.cascade_id as string;
            const trajectoryId = args?.trajectory_id as string;
            const stepIndex = args?.step_index as number;
            const type = args?.type as "filePermission" | "runCommand";
            const target = args?.target as string;

            if (!cascadeId || !trajectoryId || stepIndex === undefined || !type || !target) {
                throw new Error("Missing required args: cascade_id, trajectory_id, step_index, type, target");
            }

            const result = await aa.approve({ cascadeId, trajectoryId, stepIndex, type, target });
            return {
                toolResult: JSON.stringify(result),
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }

        default:
            throw new Error(`Unknown action: ${action}. Use start|stop|status|approve|track`);
    }
}

/**
 * stop_swarm — Stop all active agents across all providers.
 * 
 * Uses the ProviderRegistry to list and stop all running sessions.
 */
export async function handleStopSwarm(args: Record<string, unknown>): Promise<ToolResponse> {
    const registry = getProviderRegistry();
    const activeCount = registry.getTotalActiveCount();
    
    if (activeCount === 0) {
        return {
            toolResult: "No active swarm components found.",
            content: [{
                type: "text",
                text: "No active agents are currently tracked by the registry."
            }]
        };
    }

    try {
        await registry.stopAll();
        return {
            toolResult: "Swarm stop signal sent to all active agents.",
            content: [{
                type: "text",
                text: "Successfully sent stop signal to all active agent processes."
            }]
        };
    } catch (e: any) {
        throw new Error(`Failed to stop swarm: ${e.message}`);
    }
}
