/**
 * Shared test fixtures for integration tests.
 * Each test gets an isolated temp directory.
 */
import fs from "fs";
import path from "path";
import os from "os";

export interface Fixture {
    tmpDir: string;
    swarmDir: string;
    cleanup(): void;
}

/**
 * Create an isolated temp workspace for a test.
 * Automatically creates .swarm/ subdirectory.
 */
export function createFixture(prefix = "ac-integration-"): Fixture {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const swarmDir = path.join(tmpDir, ".swarm");
    fs.mkdirSync(swarmDir, { recursive: true });

    return {
        tmpDir,
        swarmDir,
        cleanup() {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                // Windows may have lingering file locks — best effort
            }
        }
    };
}

/**
 * Read a file from the fixture directory.
 * Returns null if file doesn't exist.
 */
export function readFixtureFile(tmpDir: string, relativePath: string): string | null {
    const fullPath = path.join(tmpDir, relativePath);
    return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null;
}

/**
 * Check if a file exists in the fixture directory.
 */
export function fixtureFileExists(tmpDir: string, relativePath: string): boolean {
    return fs.existsSync(path.join(tmpDir, relativePath));
}
