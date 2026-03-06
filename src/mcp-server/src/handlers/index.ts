/**
 * Handler barrel file — maps tool names to handler functions.
 */
import type { ToolHandler } from "./context.js";

// Manifest handlers
import { handleCreateSwarmManifest, handleReadManifestSection, handleSetManifestField } from "./manifest.js";

// Agent handlers
import {
    handleUpdateAgentStatus,
    handleAddAgentToManifest,
    handleMarkAgentFailed,
    handleReassignAgent,
    handleGetMyAssignment,
    handleGetAgentProgress,
    handleRemoveAgentFromManifest,
    handleUpdateAgentInManifest,
    handleGetAgentPrompt
} from "./agents.js";

// File claim handlers
import { handleClaimFile, handleCheckFileClaim, handleReleaseFileClaim } from "./files.js";

// Phase handlers
import { handleCheckPhaseGates, handleAdvancePhase, handleUpdatePhaseGate, handlePollAgentCompletion } from "./phases.js";

// Event handlers
import { handleBroadcastEvent, handleGetEvents, handlePostHandoffNote, handleGetHandoffNotes, handleReportIssue } from "./events.js";

// Swarm handlers
import { handleGetSwarmStatus, handleCompleteSwarm, handleListActiveSwarms, handleRollupAgentProgress } from "./swarm.js";

// Quota handler
import { handleCheckQuota } from "./quota.js";

// Fusebase handlers
import { handleLogFusebasePending, handleSyncFusebasePending, handleGetFusebaseSyncStatus } from "./fusebase.js";

// Scope handlers
import { handleRequestScopeExpansion, handleGrantScopeExpansion, handleDenyScopeExpansion } from "./scope.js";

// Telemetry handlers
import { handleGetMyTelemetry, handleGetSessionTelemetry, handleGetSlowOperations, handleGetTelemetrySummary } from "./telemetry.js";

// Memory handlers (semantic search — soft dependency on Qdrant)
import { handleStoreMemory, handleSemanticSearch, handleFindSimilarCode, handleFindPastSolutions } from "./memory.js";

/**
 * Master tool handler map: tool name → handler function.
 * The index.ts router uses this to dispatch tool calls.
 */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
    // Manifest
    create_swarm_manifest: handleCreateSwarmManifest,
    read_manifest_section: handleReadManifestSection,
    set_manifest_field: handleSetManifestField,

    // Agents
    update_agent_status: handleUpdateAgentStatus,
    add_agent_to_manifest: handleAddAgentToManifest,
    mark_agent_failed: handleMarkAgentFailed,
    reassign_agent: handleReassignAgent,
    get_my_assignment: handleGetMyAssignment,
    get_agent_progress: handleGetAgentProgress,
    remove_agent_from_manifest: handleRemoveAgentFromManifest,
    update_agent_in_manifest: handleUpdateAgentInManifest,
    get_agent_prompt: handleGetAgentPrompt,

    // File claims
    claim_file: handleClaimFile,
    check_file_claim: handleCheckFileClaim,
    release_file_claim: handleReleaseFileClaim,

    // Phases
    check_phase_gates: handleCheckPhaseGates,
    advance_phase: handleAdvancePhase,
    update_phase_gate: handleUpdatePhaseGate,
    poll_agent_completion: handlePollAgentCompletion,

    // Events, notes & issues
    broadcast_event: handleBroadcastEvent,
    get_events: handleGetEvents,
    post_handoff_note: handlePostHandoffNote,
    get_handoff_notes: handleGetHandoffNotes,
    report_issue: handleReportIssue,

    // Swarm lifecycle
    get_swarm_status: handleGetSwarmStatus,
    complete_swarm: handleCompleteSwarm,
    list_active_swarms: handleListActiveSwarms,
    rollup_agent_progress: handleRollupAgentProgress,

    // Quota
    check_quota: handleCheckQuota,

    // Fusebase
    log_fusebase_pending: handleLogFusebasePending,
    sync_fusebase_pending: handleSyncFusebasePending,
    get_fusebase_sync_status: handleGetFusebaseSyncStatus,

    // Scope expansion
    request_scope_expansion: handleRequestScopeExpansion,
    grant_scope_expansion: handleGrantScopeExpansion,
    deny_scope_expansion: handleDenyScopeExpansion,

    // Telemetry
    get_my_telemetry: handleGetMyTelemetry,
    get_session_telemetry: handleGetSessionTelemetry,
    get_slow_operations: handleGetSlowOperations,
    get_telemetry_summary: handleGetTelemetrySummary,

    // Semantic Memory (Qdrant — soft dependency)
    store_memory: handleStoreMemory,
    semantic_search: handleSemanticSearch,
    find_similar_code: handleFindSimilarCode,
    find_past_solutions: handleFindPastSolutions,
};
