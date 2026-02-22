import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Swarm Registry — tracks active swarms across all workspaces.
 * Stored at ~/.antigravity-configs/swarm_registry.json
 */

const REGISTRY_PATH = path.join(os.homedir(), '.antigravity-configs', 'swarm_registry.json');

export interface SwarmRegistryEntry {
    workspace: string;
    session_id: string;
    mission: string;
    phase: string;
    agents_active: number;
    agents_total: number;
    supervision: string;
    started_at: string;
    last_updated: string;
    status: string;  // "active" | "completed" | "failed"
}

export interface SwarmEvent {
    timestamp: string;
    agent_id: string;
    event_type: string;  // "build_broken" | "dependency_added" | "api_changed" | "critical_blocker" | "info"
    message: string;
    workspace: string;
    session_id: string;
}

function readRegistry(): SwarmRegistryEntry[] {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) return [];
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    } catch {
        return [];
    }
}

function writeRegistry(entries: SwarmRegistryEntry[]): void {
    const dir = path.dirname(REGISTRY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

/**
 * Register a new swarm in the global registry.
 */
export function registerSwarm(entry: SwarmRegistryEntry): void {
    const entries = readRegistry();
    // Remove any existing entry for this workspace (one swarm per workspace)
    const filtered = entries.filter(e => e.workspace !== entry.workspace);
    filtered.push(entry);
    writeRegistry(filtered);
}

/**
 * Update an existing swarm's registry entry.
 */
export function updateSwarmRegistry(workspace: string, updates: Partial<SwarmRegistryEntry>): void {
    const entries = readRegistry();
    const entry = entries.find(e => e.workspace === workspace);
    if (entry) {
        Object.assign(entry, updates, { last_updated: new Date().toISOString() });
        writeRegistry(entries);
    }
}

/**
 * Remove a swarm from the registry (on completion or cleanup).
 */
export function deregisterSwarm(workspace: string): void {
    const entries = readRegistry();
    writeRegistry(entries.filter(e => e.workspace !== workspace));
}

/**
 * List all active swarms across workspaces.
 */
export function listActiveSwarms(): SwarmRegistryEntry[] {
    return readRegistry().filter(e => e.status === 'active');
}

/**
 * List ALL swarms (including completed/failed).
 */
export function listAllSwarms(): SwarmRegistryEntry[] {
    return readRegistry();
}

// --- Event System ---

const EVENTS_DIR = path.join(os.homedir(), '.antigravity-configs', 'swarm_events');

function eventsFilePath(workspace: string, sessionId: string): string {
    const slug = workspace.replace(/[/\\:]/g, '_');
    return path.join(EVENTS_DIR, `events-${slug}-${sessionId}.json`);
}

/**
 * Broadcast an event visible to all agents in the same workspace/session.
 */
export function broadcastEvent(event: SwarmEvent): void {
    if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
    const fp = eventsFilePath(event.workspace, event.session_id);
    let events: SwarmEvent[] = [];
    try {
        if (fs.existsSync(fp)) events = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch { /* start fresh */ }
    events.push(event);
    fs.writeFileSync(fp, JSON.stringify(events, null, 2), 'utf8');
}

/**
 * Get events, optionally filtered by type.
 */
export function getEvents(workspace: string, sessionId: string, eventType?: string): SwarmEvent[] {
    const fp = eventsFilePath(workspace, sessionId);
    try {
        if (!fs.existsSync(fp)) return [];
        const events: SwarmEvent[] = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (eventType) return events.filter(e => e.event_type === eventType);
        return events;
    } catch {
        return [];
    }
}

/**
 * Clean up events for a workspace/session.
 */
export function cleanupEvents(workspace: string, sessionId: string): void {
    const fp = eventsFilePath(workspace, sessionId);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* non-fatal */ }
}
