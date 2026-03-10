#!/usr/bin/env node
/**
 * Agent Coordinator - Standalone CLI Wrapper
 * 
 * Allows parsing a local task.md manifest and invoking the MCP orchestrator 
 * directly via terminal, completely bypassing the VS Code extension UX.
 * 
 * Usage:
 *   node build/cli/index.js [workspace_root]
 */

import path from "path";
import fs from "fs";
import { loadProviders } from "../bridge/provider-loader.js";
import { getProviderRegistry } from "../bridge/registry.js";
import { handleExecuteSwarm } from "../handlers/spawn.js";
import { initStorage } from "../storage/singleton.js";

async function main() {
    console.log("Antigravity Agent Coordinator - Standalone CLI");
    console.log("==============================================\n");

    const targetDir = process.argv[2] 
        ? path.resolve(process.cwd(), process.argv[2]) 
        : process.cwd();

    console.log(`Target directory: ${targetDir}`);

    const manifestPath = path.join(targetDir, ".agent", "task.md");
    if (!fs.existsSync(manifestPath)) {
        console.error(`\n[!] Error: No swarm manifest found at ${manifestPath}`);
        console.error("    Please create a .agent/task.md file first.");
        process.exit(1);
    }

    try {
        console.log("Initializing storage...");
        initStorage(process.env.STORAGE_BACKEND);

        console.log("Loading providers...");
        await loadProviders();
        
        const registry = getProviderRegistry();
        const defaultProvider = registry.getDefault();
        console.log(`Default provider: ${defaultProvider?.name ?? 'none'}`);
        
        if (!defaultProvider) {
            console.error("\n[!] Error: No available providers found.");
            console.error("    Please configure providers.json or ensure Claude Code / Codex are installed.");
            process.exit(1);
        }

        console.log("\nExecuting Swarm...");
        
        // Use the handler directly as if called by MCP
        // but supply the explicit target directory as workspace_root
        const response = await handleExecuteSwarm({
            workspace_root: targetDir,
            auto_verify: true,
            auto_retry: true,
            auto_approve: true
        });

        // The response contains text JSON
        if (response.content && response.content[0] && response.content[0].type === "text") {
            const data = JSON.parse(response.content[0].text);
            
            console.log("\n=== Execution Summary ===");
            console.log(`Success: ${data.success ? '✅' : '❌'}`);
            console.log(`Total Agents: ${data.totalAgents}`);
            console.log(`Completed: ${data.completedAgents}`);
            console.log(`Failed: ${data.failedAgents}`);
            console.log(`Duration: ${Math.round(data.totalDurationMs / 1000)}s`);
            
            if (data.phases) {
                console.log("\nPhases:");
                for (const p of data.phases) {
                    console.log(`  Phase ${p.phase} [${p.allPassed ? '✅' : '❌'}] - ${Math.round(p.durationMs / 1000)}s`);
                    for (const a of p.agents) {
                        const icon = a.status === "completed" ? "✅" : (a.status === "failed" ? "❌" : "⏳");
                        console.log(`    - Agent ${a.agentId}: ${icon} ${a.status} (Attempt ${a.attempt})`);
                        if (a.error) {
                            console.log(`      Error: ${a.error}`);
                        }
                    }
                }
            }
        }
        
    } catch (error: any) {
        console.error(`\n[!] Fatal Error executing swarm: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

main().catch(console.error);
