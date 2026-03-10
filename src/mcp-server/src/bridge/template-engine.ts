/**
 * Template Engine — prompt template interpolation.
 *
 * Reads agent prompt templates and replaces $VARIABLE placeholders
 * with runtime context values. Supports turn limit configuration
 * per role and default values for missing variables.
 */
import path from "path";
import fs from "fs";

export interface TemplateContext {
    role: string;
    agentId: string;
    mission: string;
    scope: string;
    workspaceRoot: string;
    acceptanceCriteria?: string;
    turnLimit?: number | string;
    context?: string;
    taskId?: string;
    taskPriority?: string;
    taskDescription?: string;
    profile?: string;
    /** Extra variables to interpolate (for future extensibility) */
    extra?: Record<string, string>;
}

/** Default turn limits per role (overridden by model_fallback.json if present) */
const DEFAULT_TURN_LIMITS: Record<string, number> = {
    "project-manager": 10,
    "architect": 10,
    "developer": 20,
    "debugger": 20,
    "qa": 15,
    "code-reviewer": 15,
    "devops": 15,
    "explorer": 15,
    "researcher": 10,
};

/**
 * Load turn limit for a role from model_fallback.json if available,
 * falling back to built-in defaults.
 */
export function getTurnLimit(role: string, configDir?: string): number {
    // Try to read from model_fallback.json
    if (configDir) {
        try {
            const fbPath = path.join(configDir, "model_fallback.json");
            if (fs.existsSync(fbPath)) {
                const config = JSON.parse(fs.readFileSync(fbPath, "utf8"));
                const turnLimits = config?.turnLimits ?? config?.turn_limits;
                if (turnLimits?.[role]) {
                    return Number(turnLimits[role]);
                }
            }
        } catch { /* fall through to defaults */ }
    }

    return DEFAULT_TURN_LIMITS[role] ?? 20;
}

/**
 * Interpolate all $VARIABLE placeholders in a template string.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        // Replace both $KEY and ${KEY} syntax
        result = result.split(`$${key}`).join(value);
        result = result.split(`\${${key}}`).join(value);
    }
    return result;
}

/**
 * Build the full variable map from a TemplateContext.
 */
export function buildVariableMap(ctx: TemplateContext, configDir?: string): Record<string, string> {
    const turnLimit = ctx.turnLimit ?? getTurnLimit(ctx.role, configDir);

    const vars: Record<string, string> = {
        AGENT_ID: ctx.agentId,
        MISSION: ctx.mission,
        SCOPE: ctx.scope,
        WORKSPACE_ROOT: ctx.workspaceRoot,
        ACCEPTANCE_CRITERIA: ctx.acceptanceCriteria ?? "Complete all assigned work, ensure build passes, all tests pass.",
        TURN_LIMIT: String(turnLimit),
        CONTEXT: ctx.context ?? "",
        TASK_ID: ctx.taskId ?? ctx.agentId,
        TASK_PRIORITY: ctx.taskPriority ?? "normal",
        TASK_DESCRIPTION: ctx.taskDescription ?? ctx.mission,
        PROFILE: ctx.profile ?? "",
    };

    // Merge extra variables
    if (ctx.extra) {
        for (const [k, v] of Object.entries(ctx.extra)) {
            vars[k] = v;
        }
    }

    return vars;
}

/**
 * Read a prompt template file and populate it with context.
 */
export function getPopulatedPrompt(ctx: TemplateContext, configDir: string): string {
    if (!/^[a-z0-9-]+$/i.test(ctx.role)) {
        throw new Error(`Invalid role name: ${ctx.role}`);
    }

    const promptPath = path.join(configDir, "templates", "agent-prompts", `${ctx.role}.md`);
    if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt template for ${ctx.role} not found at ${promptPath}`);
    }

    const template = fs.readFileSync(promptPath, "utf8");
    const vars = buildVariableMap(ctx, configDir);

    // Load Fusebase profile if available
    const fbAccountsPath = path.join(configDir, "fusebase_accounts.json");
    if (fs.existsSync(fbAccountsPath)) {
        try {
            const fbConfig = JSON.parse(fs.readFileSync(fbAccountsPath, "utf8"));
            const profileEntry = fbConfig?.fusebase_profiles?.[ctx.role];
            if (profileEntry?.profile) {
                vars.PROFILE = profileEntry.profile;
            }
        } catch { /* ignore parse errors */ }
    }

    return interpolate(template, vars);
}

/**
 * List all available template roles.
 */
export function listAvailableRoles(configDir: string): string[] {
    const promptDir = path.join(configDir, "templates", "agent-prompts");
    if (!fs.existsSync(promptDir)) return [];

    return fs.readdirSync(promptDir)
        .filter(f => f.endsWith(".md"))
        .map(f => f.replace(".md", ""));
}
