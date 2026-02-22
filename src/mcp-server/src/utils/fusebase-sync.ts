import fs from 'fs';
import path from 'path';
import { withFileLock } from './file-mutex.js';

/**
 * Fusebase Dual-Write Resilience
 * 
 * Tracks failed Fusebase writes in a .fusebase-pending.json file.
 * Agents log failures here; reconciliation retries them at phase gates
 * and swarm completion.
 * 
 * The MCP server does NOT call Fusebase directly — it only manages the log.
 * The calling agent retries via its own Fusebase MCP connection.
 */

export interface PendingWrite {
    agent_id: string;
    local_file: string;
    fusebase_page: string;
    fusebase_folder_id: string;
    failed_at: string;
    error: string;
    retries: number;
}

export interface PendingLog {
    pending_writes: PendingWrite[];
}

const PENDING_FILENAME = '.fusebase-pending.json';

function pendingLogPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, 'swarm-docs', PENDING_FILENAME);
}

/**
 * Read the pending log. Returns empty list if file doesn't exist.
 */
export function readPendingLog(workspaceRoot: string): PendingLog {
    const fp = pendingLogPath(workspaceRoot);
    try {
        const raw = fs.readFileSync(fp, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            pending_writes: Array.isArray(parsed.pending_writes) ? parsed.pending_writes : []
        };
    } catch {
        return { pending_writes: [] };
    }
}

/**
 * Write the pending log atomically.
 */
function writePendingLog(workspaceRoot: string, log: PendingLog): void {
    const fp = pendingLogPath(workspaceRoot);
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fp, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Append a pending write entry. Uses file lock to prevent race conditions
 * when multiple agents log failures simultaneously.
 */
export async function appendPendingWrite(
    workspaceRoot: string,
    entry: Omit<PendingWrite, 'retries'>
): Promise<void> {
    const lockPath = pendingLogPath(workspaceRoot) + '.lock';
    await withFileLock(lockPath, () => {
        const log = readPendingLog(workspaceRoot);
        log.pending_writes.push({ ...entry, retries: 0 });
        writePendingLog(workspaceRoot, log);
    });
}

/**
 * Remove a pending write by index after successful retry.
 * Uses file lock for safety.
 */
export async function resolvePendingWrite(
    workspaceRoot: string,
    localFile: string
): Promise<boolean> {
    const lockPath = pendingLogPath(workspaceRoot) + '.lock';
    return withFileLock(lockPath, () => {
        const log = readPendingLog(workspaceRoot);
        const idx = log.pending_writes.findIndex(w => w.local_file === localFile);
        if (idx === -1) return false;
        log.pending_writes.splice(idx, 1);
        writePendingLog(workspaceRoot, log);
        return true;
    });
}

/**
 * Increment retry count for a pending write.
 */
export async function incrementRetry(
    workspaceRoot: string,
    localFile: string
): Promise<void> {
    const lockPath = pendingLogPath(workspaceRoot) + '.lock';
    await withFileLock(lockPath, () => {
        const log = readPendingLog(workspaceRoot);
        const entry = log.pending_writes.find(w => w.local_file === localFile);
        if (entry) {
            entry.retries += 1;
        }
        writePendingLog(workspaceRoot, log);
    });
}

/**
 * Get a summary of pending writes grouped by agent.
 */
export function getPendingSummary(workspaceRoot: string): {
    total: number;
    by_agent: Record<string, number>;
    items: PendingWrite[];
} {
    const log = readPendingLog(workspaceRoot);
    const byAgent: Record<string, number> = {};
    for (const w of log.pending_writes) {
        byAgent[w.agent_id] = (byAgent[w.agent_id] || 0) + 1;
    }
    return {
        total: log.pending_writes.length,
        by_agent: byAgent,
        items: log.pending_writes
    };
}

/**
 * Clear all pending writes (e.g., after final reconciliation or swarm cleanup).
 */
export async function clearPendingLog(workspaceRoot: string): Promise<void> {
    const fp = pendingLogPath(workspaceRoot);
    if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
    }
}
