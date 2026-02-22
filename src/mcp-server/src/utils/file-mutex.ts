import fs from 'fs';

/**
 * Cross-process file mutex using exclusive-create lock files.
 *
 * When multiple MCP server processes (one per agent) need to read-modify-write
 * a shared file (e.g. swarm-manifest.md), this mutex ensures only one process
 * operates at a time.
 *
 * Mechanism: fs.writeFileSync(lockPath, pid, { flag: 'wx' })
 *   - 'wx' = exclusive create — fails if file already exists
 *   - PID written for diagnostics and stale lock detection
 */

export interface FileMutexOptions {
    /** Max attempts before giving up (default: 10) */
    maxRetries?: number;
    /** Initial retry delay in ms (default: 50, doubles each retry) */
    initialDelayMs?: number;
    /** Lock files older than this are considered stale and force-removed (default: 30000ms) */
    staleLockMs?: number;
}

const DEFAULT_OPTIONS: Required<FileMutexOptions> = {
    maxRetries: 10,
    initialDelayMs: 50,
    staleLockMs: 30000,
};

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt to acquire the lock. Returns true on success, false if already held.
 * Handles stale lock detection: if the lock file is older than staleLockMs,
 * it is force-removed and re-acquired.
 */
function tryAcquire(lockPath: string, staleLockMs: number): boolean {
    try {
        fs.writeFileSync(lockPath, `${process.pid}`, { flag: 'wx' });
        return true;
    } catch {
        // Lock exists — check if stale
        try {
            const stat = fs.statSync(lockPath);
            const age = Date.now() - stat.mtimeMs;
            if (age > staleLockMs) {
                // Stale lock from crashed process — force remove
                try {
                    fs.unlinkSync(lockPath);
                    fs.writeFileSync(lockPath, `${process.pid}`, { flag: 'wx' });
                    return true;
                } catch {
                    return false; // Another process beat us to it
                }
            }
        } catch {
            // Lock was removed between our check and stat — try again next iteration
        }
        return false;
    }
}

/**
 * Release the lock by deleting the lock file.
 */
function release(lockPath: string): void {
    try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
}

/**
 * Execute a function while holding an exclusive file lock.
 *
 * Usage:
 * ```ts
 * const result = await withFileLock('/path/to/.my-lock', () => {
 *     const data = fs.readFileSync('shared-file.json', 'utf8');
 *     const modified = transform(JSON.parse(data));
 *     fs.writeFileSync('shared-file.json', JSON.stringify(modified));
 *     return modified;
 * });
 * ```
 *
 * @param lockPath Path to the lock file (e.g. '/workspace/.manifest-lock')
 * @param fn Function to execute while holding the lock. Can be sync or async.
 * @param options Retry/backoff/stale configuration
 * @returns The return value of fn
 * @throws Error if lock cannot be acquired after all retries
 */
export async function withFileLock<T>(
    lockPath: string,
    fn: () => T | Promise<T>,
    options?: FileMutexOptions
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let delay = opts.initialDelayMs;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        if (tryAcquire(lockPath, opts.staleLockMs)) {
            try {
                return await fn();
            } finally {
                release(lockPath);
            }
        }

        if (attempt < opts.maxRetries) {
            await sleep(delay);
            delay = Math.min(delay * 2, 2000); // Cap at 2s
        }
    }

    // Final attempt failed — force acquire as last resort
    release(lockPath);
    if (tryAcquire(lockPath, opts.staleLockMs)) {
        try {
            return await fn();
        } finally {
            release(lockPath);
        }
    }

    throw new Error(`Could not acquire file lock at ${lockPath} after ${opts.maxRetries} retries. Another process may be stuck.`);
}
