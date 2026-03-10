/**
 * ProviderRegistry — discovers, registers, and routes to agent providers.
 *
 * The registry is the single point of contact for the spawn handler.
 * It selects the best provider based on model requirements, availability,
 * priority, and concurrency limits.
 */
import type {
    AgentProvider,
    ProviderConfig,
    ProviderHealth,
    SpawnOptions,
    SpawnResult,
} from "./provider.js";
import { getQuotaMonitor } from "./quota-monitor.js";
import { getModelCatalog } from "./model-catalog.js";

/** Combined view of a provider + its config */
export interface RegisteredProvider {
    provider: AgentProvider;
    config: ProviderConfig;
    /** Current number of active agents on this provider */
    activeCount: number;
}

/** Requirements for selecting a provider */
export interface ProviderRequirements {
    /** Specific provider name to use */
    provider?: string;
    /** Model the agent should run on */
    model?: string;
    /** Required capabilities */
    capabilities?: string[];
    /** Providers to exclude from selection (e.g. ones that just failed) */
    excludeProviders?: string[];
}

/** Result of provider selection */
export interface ProviderSelection {
    provider: AgentProvider;
    reason: string;
}

/**
 * ProviderRegistry singleton.
 *
 * Usage:
 *   const registry = getProviderRegistry();
 *   registry.register(new AntigravityProvider(), { enabled: true, priority: 1, maxConcurrent: 3 });
 *   const best = registry.selectProvider({ model: "gemini-3-pro" });
 */
export class ProviderRegistry {
    private providers = new Map<string, RegisteredProvider>();

    /** Register a new provider */
    register(provider: AgentProvider, config: ProviderConfig): void {
        if (this.providers.has(provider.name)) {
            // Update config for existing provider
            const existing = this.providers.get(provider.name)!;
            existing.config = config;
            existing.provider = provider;
            return;
        }
        this.providers.set(provider.name, {
            provider,
            config,
            activeCount: 0,
        });
    }

    /** Unregister a provider */
    unregister(name: string): boolean {
        return this.providers.delete(name);
    }

    /** Get a specific provider by name */
    getProvider(name: string): AgentProvider | undefined {
        return this.providers.get(name)?.provider;
    }

    /** Get all registered providers */
    listProviders(): Array<{
        name: string;
        displayName: string;
        enabled: boolean;
        priority: number;
        models: string[];
        capabilities: string[];
        maxConcurrent: number;
        activeCount: number;
    }> {
        return Array.from(this.providers.values()).map((rp) => ({
            name: rp.provider.name,
            displayName: rp.provider.displayName,
            enabled: rp.config.enabled,
            priority: rp.config.priority,
            models: rp.provider.models,
            capabilities: rp.provider.capabilities,
            maxConcurrent: rp.config.maxConcurrent,
            activeCount: rp.activeCount,
        }));
    }

    /**
     * Select the best provider for the given requirements.
     *
     * Selection logic:
     *   1. If `provider` is specified, use it directly (error if unavailable)
     *   2. Filter to enabled providers that support the requested model/capabilities
     *   3. Filter to providers with available capacity (activeCount < maxConcurrent)
     *   4. Sort by priority (lower = better)
     *   5. Return highest-priority match
     */
    selectProvider(requirements: ProviderRequirements = {}): ProviderSelection | null {
        // Direct provider selection
        if (requirements.provider) {
            const rp = this.providers.get(requirements.provider);
            if (!rp) return null;
            if (!rp.config.enabled) return null;
            if (rp.activeCount >= rp.config.maxConcurrent) {
                return null; // At capacity
            }
            return { provider: rp.provider, reason: `Explicitly requested provider: ${rp.provider.name}` };
        }

        // Filter and sort candidates
        const candidates = Array.from(this.providers.values())
            .filter((rp) => {
                if (!rp.config.enabled) return false;
                if (rp.activeCount >= rp.config.maxConcurrent) return false;

                // Model match
                if (requirements.model) {
                    const modelMatch = rp.provider.models.some(
                        (m) => m === requirements.model || m.includes(requirements.model!)
                    );
                    if (!modelMatch) return false;
                }

                // Capability match
                if (requirements.capabilities) {
                    const hasAll = requirements.capabilities.every(
                        (cap) => rp.provider.capabilities.includes(cap)
                    );
                    if (!hasAll) return false;
                }

                // Exclusion match
                if (requirements.excludeProviders && requirements.excludeProviders.includes(rp.provider.name)) {
                    return false;
                }

                return true;
            })
            .sort((a, b) => a.config.priority - b.config.priority);

        if (candidates.length === 0) return null;

        // Quota-aware fallback strategy
        const monitor = getQuotaMonitor();
        const catalog = getModelCatalog();
        const buckets = catalog.getQuotaBuckets(monitor.getQuotaSnapshot().buckets);

        // Try to find the highest-priority candidate that isn't in an exhausted bucket
        for (const candidate of candidates) {
            // Determine candidate's bucket based on its first model
            const candidateModel = requirements.model || candidate.provider.models[0];
            const candidateBucket = buckets.find(b => b.models.includes(candidateModel));
            
            if (candidateBucket) {
                const pivotRec = monitor.getPivotRecommendation(candidateBucket.name);
                if (pivotRec.shouldPivot && pivotRec.exhaustedBucket === candidateBucket.name) {
                    // This provider's bucket is exhausted, skip it if possible
                    continue;
                }
            }
            return { provider: candidate.provider, reason: `Highest-priority healthy provider (priority ${candidate.config.priority})` };
        }

        // If all candidates are exhausted, return the highest-priority one anyway (might succeed)
        const best = candidates[0];
        const reason = requirements.model
            ? `Best available provider for model "${requirements.model}" (priority ${best.config.priority})`
            : `Highest-priority enabled provider (priority ${best.config.priority})`;

        return { provider: best.provider, reason };
    }

    /** Record that an agent was spawned on a provider */
    recordSpawn(providerName: string): void {
        const rp = this.providers.get(providerName);
        if (rp) rp.activeCount++;
    }

    /** Record that an agent completed/stopped on a provider */
    recordCompletion(providerName: string): void {
        const rp = this.providers.get(providerName);
        if (rp && rp.activeCount > 0) rp.activeCount--;
    }

    /** Get active count for a provider */
    getActiveCount(providerName: string): number {
        return this.providers.get(providerName)?.activeCount ?? 0;
    }

    /** Get total active count across all providers */
    getTotalActiveCount(): number {
        let total = 0;
        for (const rp of this.providers.values()) {
            total += rp.activeCount;
        }
        return total;
    }

    /** Health check all providers */
    async pingAll(): Promise<Map<string, ProviderHealth>> {
        const results = new Map<string, ProviderHealth>();
        const checks = Array.from(this.providers.entries()).map(
            async ([name, rp]) => {
                try {
                    const health = await rp.provider.ping();
                    results.set(name, health);
                } catch (err) {
                    results.set(name, {
                        online: false,
                        latencyMs: -1,
                        error: (err as Error).message,
                    });
                }
            }
        );
        await Promise.all(checks);
        return results;
    }

    /** Get the default provider (highest priority enabled) */
    getDefault(): AgentProvider | null {
        const selection = this.selectProvider();
        return selection?.provider ?? null;
    }

    /** Stop all active agents across all providers */
    async stopAll(): Promise<void> {
        const stops: Promise<void>[] = [];
        for (const rp of this.providers.values()) {
            stops.push((async () => {
                try {
                    const sessions = await rp.provider.listSessions();
                    for (const s of sessions) {
                        if (s.state === 'running') {
                            await rp.provider.stop(s.conversationId);
                        }
                    }
                } catch (e) {
                    // Ignore errors during mass stop
                }
            })());
        }
        await Promise.all(stops);
    }

    /** Reset all active counts (useful for testing) */
    resetCounts(): void {
        for (const rp of this.providers.values()) {
            rp.activeCount = 0;
        }
    }

    /** Clear all registered providers */
    clear(): void {
        this.providers.clear();
    }
}

// ── Singleton ──────────────────────────────────────────────────────

let instance: ProviderRegistry | undefined;

export function getProviderRegistry(): ProviderRegistry {
    if (!instance) {
        instance = new ProviderRegistry();
    }
    return instance;
}

/** Reset singleton (testing only) */
export function resetProviderRegistry(): void {
    instance = undefined;
}
