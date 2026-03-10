/**
 * Verifier — post-completion verification runner.
 *
 * Runs automated checks (build, test, lint, type-check) after an agent
 * reports completion. Supports configurable check lists and retry on failure.
 */
import { getBridgeClient } from "./client.js";

export interface VerificationCheck {
    /** Check name (e.g. "build", "test", "lint") */
    name: string;
    /** Shell command to execute */
    command: string;
    /** If true, agent must be retried on failure */
    required: boolean;
}

export interface CheckResult {
    name: string;
    passed: boolean;
    output: string;
    durationMs: number;
}

export interface VerificationResult {
    passed: boolean;
    checks: CheckResult[];
    totalDurationMs: number;
}

const DEFAULT_CHECKS: VerificationCheck[] = [
    { name: "build", command: "npm run build", required: true },
    { name: "type-check", command: "npx tsc --noEmit", required: true },
    { name: "test", command: "npm test", required: false },
];

export class Verifier {
    private checks: VerificationCheck[];
    private readonly timeoutMs: number;

    constructor(opts?: { checks?: VerificationCheck[]; timeoutMs?: number }) {
        this.checks = opts?.checks ?? [...DEFAULT_CHECKS];
        this.timeoutMs = opts?.timeoutMs ?? 120_000;
    }

    /**
     * Run all verification checks.
     * Executes commands via the Agent Bridge terminal endpoint.
     */
    async verify(workspaceRoot?: string): Promise<VerificationResult> {
        const client = getBridgeClient();
        const results: CheckResult[] = [];
        const start = Date.now();

        for (const check of this.checks) {
            const checkStart = Date.now();
            try {
                const resp = await globalThis.fetch(
                    `http://127.0.0.1:${process.env.AGENT_BRIDGE_PORT ?? "9090"}/api/terminal/execute`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            command: check.command,
                            cwd: workspaceRoot,
                            timeout: this.timeoutMs,
                        }),
                        signal: AbortSignal.timeout(this.timeoutMs),
                    }
                );

                const data = await resp.json() as Record<string, unknown>;
                const exitCode = data.exitCode ?? data.exit_code ?? (resp.ok ? 0 : 1);
                const output = String(data.output ?? data.stdout ?? data.stderr ?? "");

                results.push({
                    name: check.name,
                    passed: exitCode === 0,
                    output: output.slice(0, 2000), // Cap output length
                    durationMs: Date.now() - checkStart,
                });
            } catch (err) {
                results.push({
                    name: check.name,
                    passed: false,
                    output: `Check failed: ${(err as Error).message}`,
                    durationMs: Date.now() - checkStart,
                });
            }
        }

        const requiredFailed = results.some(
            r => !r.passed && this.checks.find(c => c.name === r.name)?.required
        );

        return {
            passed: !requiredFailed,
            checks: results,
            totalDurationMs: Date.now() - start,
        };
    }

    /**
     * Build an error context string from failed checks (for retry prompts).
     */
    static buildRetryContext(result: VerificationResult): string {
        const failures = result.checks.filter(c => !c.passed);
        if (failures.length === 0) return "";

        return [
            "## Previous Attempt Failed — Verification Errors",
            "",
            ...failures.map(f => [
                `### ${f.name} (FAILED)`,
                "```",
                f.output,
                "```",
            ].join("\n")),
            "",
            "Fix the above errors before marking your work as complete.",
        ].join("\n");
    }

    /**
     * Update checks at runtime.
     */
    setChecks(checks: VerificationCheck[]): void {
        this.checks = [...checks];
    }

    /**
     * Get current check configuration.
     */
    getChecks(): VerificationCheck[] {
        return [...this.checks];
    }
}

/** Singleton verifier instance */
let _verifier: Verifier | undefined;

export function getVerifier(): Verifier {
    if (!_verifier) {
        _verifier = new Verifier();
    }
    return _verifier;
}
