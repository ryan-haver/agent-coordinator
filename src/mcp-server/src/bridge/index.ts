/**
 * Bridge barrel export — re-exports all bridge module components.
 */
export { BridgeClient, getBridgeClient } from "./client.js";
export type { SpawnOptions, SpawnResult, BridgeConversation, BridgeHealth } from "./client.js";

export { RateLimiter, getRateLimiter } from "./rate-limiter.js";
export type { RateLimiterConfig, RateLimitCheck } from "./rate-limiter.js";

export { ErrorDetector, getErrorDetector } from "./error-detector.js";
export type { AgentWatch, RetryDecision } from "./error-detector.js";

export { Verifier, getVerifier } from "./verifier.js";
export type { VerificationCheck, CheckResult, VerificationResult } from "./verifier.js";

export { Orchestrator, getOrchestrator, parseManifestPhases, buildExecutionPlan } from "./orchestrator.js";
export type { OrchestratorConfig, PhaseResult, AgentResult, SwarmExecutionResult } from "./orchestrator.js";
