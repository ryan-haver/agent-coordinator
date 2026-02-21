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
    const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, (c) => c.charCodeAt(0).toString(16));
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
export function createAgentProgress(agentId: string, role: string, phase: string): AgentProgress {
    return {
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
 * Used by the coordinator for roll-up.
 */
export function readAllAgentProgress(workspaceRoot: string): AgentProgress[] {
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
    return results;
}
