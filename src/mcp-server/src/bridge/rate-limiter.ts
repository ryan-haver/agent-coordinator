/**
 * Rate Limiter — token-bucket concurrency control for agent spawning.
 *
 * Prevents overwhelming the IDE with too many simultaneous agents.
 * Supports configurable concurrency limits, cooldown, and exponential backoff.
 */

export interface RateLimiterConfig {
    /** Max simultaneous agents (default: 3) */
    maxConcurrent: number;
    /** Minimum gap between spawns in ms (default: 5000) */
    cooldownMs: number;
    /** Max spawns per hour (default: 30) */
    maxPerHour: number;
    /** Backoff multiplier on consecutive errors (default: 2.0) */
    backoffMultiplier: number;
    /** Max backoff delay in ms (default: 60000) */
    maxBackoffMs: number;
}

export interface RateLimitCheck {
    allowed: boolean;
    reason?: string;
    waitMs?: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
    maxConcurrent: 3,
    cooldownMs: 5000,
    maxPerHour: 30,
    backoffMultiplier: 2.0,
    maxBackoffMs: 60_000,
};

export class RateLimiter {
    private config: RateLimiterConfig;
    private activeCount = 0;
    private lastSpawnTime = 0;
    private spawnTimestamps: number[] = [];
    private consecutiveErrors = 0;
    private currentBackoffMs = 0;

    constructor(config?: Partial<RateLimiterConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if a spawn is currently allowed.
     * Does NOT consume a slot — call `recordSpawn()` after successful spawn.
     */
    check(): RateLimitCheck {
        const now = Date.now();

        // Check backoff from errors
        if (this.currentBackoffMs > 0) {
            const elapsed = now - this.lastSpawnTime;
            if (elapsed < this.currentBackoffMs) {
                const waitMs = this.currentBackoffMs - elapsed;
                return {
                    allowed: false,
                    reason: `Error backoff active (${this.consecutiveErrors} consecutive errors). Wait ${Math.ceil(waitMs / 1000)}s.`,
                    waitMs,
                };
            }
        }

        // Check concurrent limit
        if (this.activeCount >= this.config.maxConcurrent) {
            return {
                allowed: false,
                reason: `Concurrent limit reached: ${this.activeCount}/${this.config.maxConcurrent} agents active.`,
            };
        }

        // Check cooldown
        const timeSinceLastSpawn = now - this.lastSpawnTime;
        if (this.lastSpawnTime > 0 && timeSinceLastSpawn < this.config.cooldownMs) {
            const waitMs = this.config.cooldownMs - timeSinceLastSpawn;
            return {
                allowed: false,
                reason: `Cooldown active. Wait ${Math.ceil(waitMs / 1000)}s.`,
                waitMs,
            };
        }

        // Check hourly rate
        const oneHourAgo = now - 3_600_000;
        this.spawnTimestamps = this.spawnTimestamps.filter(t => t > oneHourAgo);
        if (this.spawnTimestamps.length >= this.config.maxPerHour) {
            const oldestInWindow = this.spawnTimestamps[0];
            const waitMs = oldestInWindow + 3_600_000 - now;
            return {
                allowed: false,
                reason: `Hourly limit reached: ${this.spawnTimestamps.length}/${this.config.maxPerHour} spawns this hour.`,
                waitMs,
            };
        }

        return { allowed: true };
    }

    /**
     * Record a successful spawn — increments active count, resets backoff.
     */
    recordSpawn(): void {
        const now = Date.now();
        this.activeCount++;
        this.lastSpawnTime = now;
        this.spawnTimestamps.push(now);
        this.consecutiveErrors = 0;
        this.currentBackoffMs = 0;
    }

    /**
     * Record agent completion — decrements active count.
     */
    recordCompletion(): void {
        this.activeCount = Math.max(0, this.activeCount - 1);
    }

    /**
     * Record a spawn error — triggers exponential backoff.
     */
    recordError(): void {
        this.consecutiveErrors++;
        this.lastSpawnTime = Date.now();
        this.currentBackoffMs = Math.min(
            this.config.cooldownMs * Math.pow(this.config.backoffMultiplier, this.consecutiveErrors),
            this.config.maxBackoffMs
        );
    }

    /**
     * Force-set the active agent count (e.g. from poll_agent_completion data).
     */
    setActiveCount(count: number): void {
        this.activeCount = Math.max(0, count);
    }

    /**
     * Current stats for diagnostics.
     */
    getStats(): {
        activeCount: number;
        spawnsThisHour: number;
        consecutiveErrors: number;
        backoffMs: number;
        config: RateLimiterConfig;
    } {
        const now = Date.now();
        const oneHourAgo = now - 3_600_000;
        this.spawnTimestamps = this.spawnTimestamps.filter(t => t > oneHourAgo);
        return {
            activeCount: this.activeCount,
            spawnsThisHour: this.spawnTimestamps.length,
            consecutiveErrors: this.consecutiveErrors,
            backoffMs: this.currentBackoffMs,
            config: { ...this.config },
        };
    }

    /**
     * Update configuration at runtime.
     */
    updateConfig(partial: Partial<RateLimiterConfig>): void {
        this.config = { ...this.config, ...partial };
    }
}

/** Singleton rate limiter instance */
let _rateLimiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
    if (!_rateLimiter) {
        _rateLimiter = new RateLimiter();
    }
    return _rateLimiter;
}
