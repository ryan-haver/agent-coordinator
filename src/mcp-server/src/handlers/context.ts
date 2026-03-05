/**
 * Shared types and context for all tool handlers.
 */
import path from "path";
import os from "os";
import fs from "fs";

export const globalConfigPath = path.join(os.homedir(), ".antigravity-configs");

/**
 * Resolve the workspace root directory using multiple strategies.
 * Called lazily per-request (not at startup) so the CWD at server
 * launch time doesn't lock us into a wrong directory.
 */
export function resolveWorkspaceRoot(args?: Record<string, unknown>): string {
    // Strategy 1: Explicit argument override (highest priority)
    if (args?.workspace_root && typeof args.workspace_root === "string") {
        return args.workspace_root;
    }

    // Strategy 2: Environment variable (set by Antigravity extension)
    if (process.env.ANTIGRAVITY_WORKSPACE) {
        return process.env.ANTIGRAVITY_WORKSPACE;
    }

    // Strategy 3: Walk up from CWD looking for swarm-manifest.md
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir !== root) {
        if (fs.existsSync(path.join(dir, 'swarm-manifest.md'))) {
            return dir;
        }
        dir = path.dirname(dir);
    }

    // Strategy 4: Fall back to CWD (original behavior)
    return process.cwd();
}

/** Standard MCP tool response shape */
export interface ToolResponse {
    toolResult?: string;
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

/** Tool handler function signature */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;
