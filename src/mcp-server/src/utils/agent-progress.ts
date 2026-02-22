import fs from 'fs';
import path from 'path';

/**
 * Schema for per-agent progress files.
 * Each agent writes ONLY to their own file (swarm-agent-{id}.json).
 * The coordinator rolls up all agent files into the manifest.
 */
export interface AgentFileClaim {
    file: string;
    status: string;
}

export interface AgentIssue {
    severity: string;
    area: string;
    description: string;
}

export interface AgentProgress {
    swarm_session_id: string;
    agent_id: string;
    role: string;
    status: string;
    phase: string;
    file_claims: AgentFileClaim[];
    issues: AgentIssue[];
    handoff_notes: string;
    last_updated: string;
}

const AGENT_FILE_PREFIX = 'swarm-agent-';
const AGENT_FILE_SUFFIX = '.json';

function agentFilePath(workspaceRoot: string, agentId: string): string {
    // Sanitize agent ID for filename safety (e.g., α → a0b1)
    const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, (c) => c.charCodeAt(0).toString(16).padStart(4, '0'));
    return path.join(workspaceRoot, `${AGENT_FILE_PREFIX}${safeId}${AGENT_FILE_SUFFIX}`);
}

/**
 * Read an agent's progress file. Returns null if it doesn't exist.
 */
export function readAgentProgress(workspaceRoot: string, agentId: string): AgentProgress | null {
    const fp = agentFilePath(workspaceRoot, agentId);
    if (!fs.existsSync(fp)) return null;
    try {
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Write an agent's progress file. Creates if it doesn't exist.
 */
export function writeAgentProgress(workspaceRoot: string, progress: AgentProgress): void {
    const fp = agentFilePath(workspaceRoot, progress.agent_id);
    progress.last_updated = new Date().toISOString();
    fs.writeFileSync(fp, JSON.stringify(progress, null, 2), 'utf8');
}

/**
 * Create a new agent progress file with defaults.
 */
export function createAgentProgress(agentId: string, role: string, phase: string, sessionId: string = ''): AgentProgress {
    return {
        swarm_session_id: sessionId,
        agent_id: agentId,
        role,
        status: '⏳ Pending',
        phase,
        file_claims: [],
        issues: [],
        handoff_notes: '',
        last_updated: new Date().toISOString()
    };
}

/**
 * Read ALL agent progress files from the workspace root.
 * Optionally filter by session ID to avoid cross-swarm contamination.
 */
export function readAllAgentProgress(workspaceRoot: string, sessionId?: string): AgentProgress[] {
    const results: AgentProgress[] = [];
    try {
        const files = fs.readdirSync(workspaceRoot)
            .filter(f => f.startsWith(AGENT_FILE_PREFIX) && f.endsWith(AGENT_FILE_SUFFIX));
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(workspaceRoot, file), 'utf8');
                results.push(JSON.parse(content));
            } catch {
                // Skip malformed files
            }
        }
    } catch {
        // Directory doesn't exist or unreadable
    }
    if (sessionId) {
        return results.filter(r => r.swarm_session_id === sessionId);
    }
    return results;
}

/**
 * Delete all agent progress files from the workspace root.
 * Called when creating a new swarm manifest to prevent cross-session contamination.
 */
export function cleanupAgentFiles(workspaceRoot: string): number {
    let count = 0;
    try {
        const files = fs.readdirSync(workspaceRoot)
            .filter(f => f.startsWith(AGENT_FILE_PREFIX) && f.endsWith(AGENT_FILE_SUFFIX));
        for (const f of files) {
            try {
                fs.unlinkSync(path.join(workspaceRoot, f));
                count++;
            } catch {
                // Non-fatal: file may already be deleted
            }
        }
    } catch {
        // Directory doesn't exist or unreadable
    }
    return count;
}

/**
 * Extract the swarm session ID from a manifest's content.
 * The session ID is stored as a comment: <!-- session: {id} -->
 */
export function extractSessionId(manifestContent: string): string {
    const match = manifestContent.match(/<!--\s*session:\s*(\S+)\s*-->/);
    return match ? match[1] : '';
}

/**
 * Generate a new session ID (ISO date slug).
 */
export function generateSessionId(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
