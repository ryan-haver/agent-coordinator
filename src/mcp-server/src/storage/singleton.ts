/**
 * Storage singleton — provides a global StorageAdapter instance.
 *
 * At startup, index.ts calls initStorage() to create the adapter.
 * Handlers import getStorage() to access it.
 *
 * Set STORAGE_BACKEND=sqlite to use the SQLite backend.
 * Default is "file" for backwards compatibility.
 */
import type { StorageAdapter } from "./adapter.js";
import { FileStorageAdapter } from "./file-adapter.js";
import { SqliteStorageAdapter } from "./sqlite-adapter.js";

let _storage: StorageAdapter | null = null;

/**
 * Initialize the global storage adapter.
 * Call once at server startup.
 * @param backend "file" (default) or "sqlite"
 */
export function initStorage(backend?: string): StorageAdapter {
    if (backend === "sqlite") {
        _storage = new SqliteStorageAdapter();
    } else {
        _storage = new FileStorageAdapter();
    }
    return _storage;
}

/**
 * Get the global storage adapter.
 * Auto-initializes with the STORAGE_BACKEND env var if not yet initialized.
 */
export function getStorage(): StorageAdapter {
    if (!_storage) {
        const backend = process.env.STORAGE_BACKEND || "file";
        _storage = backend === "sqlite" ? new SqliteStorageAdapter() : new FileStorageAdapter();
    }
    return _storage;
}

/**
 * Reset the storage singleton (for testing).
 */
export function resetStorage(): void {
    _storage = null;
}
