/**
 * Storage singleton — provides a global StorageAdapter instance.
 *
 * At startup, index.ts calls initStorage() to create the adapter.
 * Handlers import getStorage() to access it.
 *
 * Currently always creates FileStorageAdapter.
 * When STORAGE_BACKEND=sqlite is set, this will create SqliteStorageAdapter.
 */
import type { StorageAdapter } from "./adapter.js";
import { FileStorageAdapter } from "./file-adapter.js";

let _storage: StorageAdapter | null = null;

/**
 * Initialize the global storage adapter.
 * Call once at server startup.
 */
export function initStorage(backend?: string): StorageAdapter {
    if (backend === "sqlite") {
        // Future: return new SqliteStorageAdapter();
        throw new Error("SQLite backend not yet implemented");
    }
    _storage = new FileStorageAdapter();
    return _storage;
}

/**
 * Get the global storage adapter.
 * Throws if initStorage() hasn't been called yet.
 */
export function getStorage(): StorageAdapter {
    if (!_storage) {
        // Auto-init with file backend for backwards compat
        _storage = new FileStorageAdapter();
    }
    return _storage;
}
