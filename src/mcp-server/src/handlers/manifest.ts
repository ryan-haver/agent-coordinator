/**
 * Manifest tool handlers: create_swarm_manifest, read_manifest_section, set_manifest_field
 */
import path from "path";
import fs from "fs";
import { resolveWorkspaceRoot, globalConfigPath, type ToolResponse } from "./context.js";
import {
    getTableFromSection,
    replaceTableInSection,
    serializeTableToString,
    readManifest,
    writeManifest,
    withManifestLock
} from "../utils/manifest.js";
import {
    cleanupAgentFiles,
    extractSessionId,
    generateSessionId,
    readAllAgentProgress
} from "../utils/agent-progress.js";
import {
    registerSwarm,
    cleanupStaleEvents
} from "../utils/swarm-registry.js";
import { writeSwarmStatus } from "./shared.js";

export async function handleCreateSwarmManifest(args: Record<string, unknown>): Promise<ToolResponse> {
    const mission = args?.mission;
    if (!mission || typeof mission !== "string") throw new Error("Missing required argument: mission");
    const supervision = (args?.supervision_level as string) || "Full";

    const templatePath = path.join(globalConfigPath, "templates", "swarm-manifest.md");
    if (!fs.existsSync(templatePath)) throw new Error("Template not found");
    let content = fs.readFileSync(templatePath, "utf8");

    content = content.split("$MISSION").join(mission);
    content = content.split("$TIMESTAMP").join(new Date().toISOString());
    content = content.replace(/Supervision:\s*\w+/, `Supervision: ${supervision}`);

    const wsRoot = resolveWorkspaceRoot(args);

    const sessionId = generateSessionId();
    content = `<!-- session: ${sessionId} -->\n` + content;

    const cleaned = cleanupAgentFiles(wsRoot);

    try { cleanupStaleEvents(7); } catch { /* non-fatal */ }

    writeManifest(wsRoot, content);
    writeSwarmStatus(wsRoot, content, "Swarm initialized");

    try {
        await registerSwarm({
            workspace: wsRoot,
            session_id: sessionId,
            mission: mission.substring(0, 200),
            phase: "0",
            agents_active: 0,
            agents_total: 0,
            supervision,
            started_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            status: "active"
        });
    } catch { /* registry write is non-fatal */ }

    return { toolResult: "Manifest created successfully.", content: [{ type: "text", text: `Manifest created (session: ${sessionId}). Cleaned ${cleaned} old agent files.` }] };
}

export async function handleReadManifestSection(args: Record<string, unknown>): Promise<ToolResponse> {
    const wsRoot = resolveWorkspaceRoot(args);
    const md = readManifest(wsRoot);
    const section = args?.section;
    if (!section || typeof section !== "string") throw new Error("Missing required argument: section");
    const res = getTableFromSection(md, section);
    if (!res) throw new Error(`Section ${section} not found or no table in it`);
    return { toolResult: JSON.stringify(res, null, 2), content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
}

export async function handleSetManifestField(args: Record<string, unknown>): Promise<ToolResponse> {
    const { section, rows } = args as any;
    if (!section || !rows) throw new Error("Missing required arguments: section, rows");
    const wsRoot = resolveWorkspaceRoot(args);

    const resultText = await withManifestLock(wsRoot, (md) => {
        const table = getTableFromSection(md, section);
        if (table) {
            const headers = rows.length > 0 ? Object.keys(rows[0]) : table.headers;
            const updated = replaceTableInSection(md, section, serializeTableToString(headers, rows));
            if (updated) return { content: updated, result: `Updated ${section} with ${rows.length} rows` };
        }

        const sectionIdx = md.indexOf(`## ${section}`);
        if (sectionIdx === -1) throw new Error(`Section "## ${section}" not found in manifest`);
        if (rows.length === 0) throw new Error("Rows array is empty");
        const headers = Object.keys(rows[0]);
        const tableStr = serializeTableToString(headers, rows);
        let insertIdx = md.indexOf('\n', sectionIdx);
        if (insertIdx === -1) insertIdx = md.length;
        else insertIdx++;
        const newMd = md.slice(0, insertIdx) + '\n' + tableStr + '\n' + md.slice(insertIdx);
        return { content: newMd, result: `Created ${section} table with ${rows.length} rows` };
    });

    return { toolResult: resultText, content: [{ type: "text", text: resultText }] };
}
