/**
 * Startup config validation — logs warnings about missing or stale configs.
 * Called from server.ts at startup (info-level, non-fatal).
 */
import path from "path";
import fs from "fs";
import { getGlobalConfigPath } from "./handlers/context.js";

export interface ConfigStatus {
    modelFallbackFound: boolean;
    modelFallbackPath: string | null;
    hasPlatformSection: boolean;
    quotaSnapshotFound: boolean;
    quotaSnapshotStaleMinutes: number | null;
    autoModeVerified: boolean;
    warnings: string[];
}

export function validateConfig(): ConfigStatus {
    const configDir = getGlobalConfigPath();
    const warnings: string[] = [];

    // Check model_fallback.json
    let modelFallbackFound = false;
    let modelFallbackPath: string | null = null;
    let hasPlatformSection = false;
    let autoModeVerified = false;

    const envDir = process.env.AGENT_COORDINATOR_CONFIG;
    const searchPaths = [
        envDir ? path.join(envDir, 'model_fallback.json') : null,
        path.join(configDir, 'model_fallback.json'),
    ].filter(Boolean) as string[];

    for (const fp of searchPaths) {
        try {
            if (fs.existsSync(fp)) {
                const config = JSON.parse(fs.readFileSync(fp, 'utf8'));
                modelFallbackFound = true;
                modelFallbackPath = fp;
                hasPlatformSection = !!config.platform?.name;
                autoModeVerified = config.auto_mode_settings?.verified === true;

                if (!hasPlatformSection) {
                    warnings.push(`model_fallback.json at ${fp} has no platform section — routing will use generic mode.`);
                }
                if (!autoModeVerified) {
                    warnings.push(`auto_mode_settings.verified is false — settings keys are unconfirmed.`);
                }
                break;
            }
        } catch { /* try next */ }
    }

    if (!modelFallbackFound) {
        warnings.push(`No model_fallback.json found in ${searchPaths.join(' or ')} — routing recommendations unavailable.`);
    }

    // Check quota_snapshot.json
    let quotaSnapshotFound = false;
    let quotaSnapshotStaleMinutes: number | null = null;
    const quotaPath = path.join(configDir, 'quota_snapshot.json');

    try {
        if (fs.existsSync(quotaPath)) {
            quotaSnapshotFound = true;
            const ageMs = Date.now() - fs.statSync(quotaPath).mtimeMs;
            quotaSnapshotStaleMinutes = Math.round(ageMs / 60_000);
            if (ageMs > 3600_000) {
                warnings.push(`quota_snapshot.json is ${quotaSnapshotStaleMinutes} min old — run quota_check to refresh.`);
            }
        } else {
            warnings.push(`No quota_snapshot.json found at ${quotaPath} — quota-aware routing disabled.`);
        }
    } catch { /* ignore */ }

    return {
        modelFallbackFound,
        modelFallbackPath,
        hasPlatformSection,
        quotaSnapshotFound,
        quotaSnapshotStaleMinutes,
        autoModeVerified,
        warnings,
    };
}

/** Log config status at startup (to stderr so it doesn't corrupt MCP protocol on stdout) */
export function logConfigStatus(): void {
    const status = validateConfig();

    if (status.warnings.length === 0) {
        console.error("[config] ✅ All configs valid.");
        return;
    }

    for (const w of status.warnings) {
        console.error(`[config] ⚠️  ${w}`);
    }
}
