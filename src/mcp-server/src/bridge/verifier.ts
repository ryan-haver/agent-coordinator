/**
 * Verifier — post-completion verification runner.
 *
 * Runs automated checks (build, test, lint, type-check) after an agent
 * reports completion. Supports configurable check lists and retry on failure.
 * Commands are executed locally via child_process.execSync.
 */
import { execSync } from "child_process";

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
     * Executes commands directly via child_process.execSync.
     */
    async verify(workspaceRoot?: string): Promise<VerificationResult> {
        const results: CheckResult[] = [];
        const start = Date.now();

        for (const check of this.checks) {
            const checkStart = Date.now();
            try {
                const stdout = execSync(check.command, {
                    cwd: workspaceRoot || undefined,
                    timeout: this.timeoutMs,
                    encoding: "utf8",
                    maxBuffer: 10 * 1024 * 1024,
                    stdio: ["pipe", "pipe", "pipe"],
                });

                results.push({
                    name: check.name,
                    passed: true,
                    output: String(stdout).slice(0, 2000),
                    durationMs: Date.now() - checkStart,
                });
            } catch (err: any) {
                // execSync throws on non-zero exit — capture output from the error
                const output = String(err.stdout ?? err.stderr ?? err.message ?? "").slice(0, 2000);
                results.push({
                    name: check.name,
                    passed: false,
                    output: output || `Check failed: exit code ${err.status ?? "unknown"}`,
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
