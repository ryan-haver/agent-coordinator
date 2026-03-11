/**
 * Bridge Client — Thin facade over ConnectRpcClient for backward compatibility.
 *
 * Modules that historically imported `getBridgeClient()` continue to work.
 * The actual spawn and health check logic lives in ConnectRpcClient.
 */

import { ConnectRpcClient } from "./connect-rpc-client.js";

export interface SpawnOptions {
    newConversation?: boolean;
    background?: boolean;
    agentManager?: boolean;
    workingDirectory?: string;
}

export interface SpawnResult {
    success: boolean;
    conversationId?: string;
    error?: string;
    promptLength?: number;
}

export interface BridgeHealth {
    online: boolean;
    version?: string;
    uptime?: number;
}

export class BridgeClient {
    private rpcClient: ConnectRpcClient;

    constructor() {
        this.rpcClient = new ConnectRpcClient();
    }

    /**
     * Spawn a new agent directly via native ConnectRPC.
     */
    async spawn(prompt: string, opts?: SpawnOptions): Promise<SpawnResult> {
        return this.rpcClient.spawn(prompt, {
            workingDirectory: opts?.workingDirectory,
            agenticMode: true,
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
            artifactReviewMode: "ARTIFACT_REVIEW_MODE_TURBO"
        });
    }

    /**
     * Health check — validates we can find and connect to the Language Server process.
     */
    async ping(): Promise<BridgeHealth> {
        try {
            await this.rpcClient.connect();
            return {
                online: true,
                version: "native-rpc-v1",
                uptime: process.uptime(),
            };
        } catch {
            return { online: false };
        }
    }
}

/** Singleton bridge client instance */
let _bridgeClient: BridgeClient | undefined;

export function getBridgeClient(): BridgeClient {
    if (!_bridgeClient) {
        _bridgeClient = new BridgeClient();
    }
    return _bridgeClient;
}
