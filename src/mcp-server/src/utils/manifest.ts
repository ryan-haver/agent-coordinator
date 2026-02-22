import fs from 'fs';
import path from 'path';

export interface TableRow {
    [key: string]: string;
}

export interface ParseResult {
    headers: string[];
    rows: TableRow[];
}

/**
 * Clean a markdown cell value
 */
function cleanCell(cell: string): string {
    return cell.trim();
}

/**
 * Escape regex metacharacters in a string for safe use in RegExp.
 */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts a markdown table from a specific section denoted by an h2 heading.
 * Returns null if the section or table is not found.
 */
export function getTableFromSection(markdown: string, sectionHeading: string): ParseResult | null {
    const escaped = escapeRegex(sectionHeading);
    const sectionRegex = new RegExp(`##\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?:\\n##\\s|$)`);
    const sectionMatch = sectionRegex.exec(markdown);

    if (!sectionMatch) {
        return null;
    }

    const sectionContent = sectionMatch[1];

    // Find the first markdown table in the section
    const lines = sectionContent.split('\n');
    let startIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('|')) {
            startIdx = i;
            break;
        }
    }

    if (startIdx === -1 || startIdx + 1 >= lines.length) {
        return null; // No table found or incomplete table
    }

    // Check separator line
    const sepLine = lines[startIdx + 1];
    if (!sepLine.trim().startsWith('|') || !sepLine.includes('-')) {
        return null; // Invalid table format
    }

    const headers = lines[startIdx]
        .split('|')
        .slice(1, -1)
        .map(h => cleanCell(h));

    const rows: TableRow[] = [];
    let endIdx = startIdx + 2;

    for (let i = startIdx + 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) {
            endIdx = i;
            break;
        }

        const cells = line.split('|').slice(1, -1).map(c => cleanCell(c));
        const rowData: TableRow = {};
        for (let j = 0; j < headers.length; j++) {
            rowData[headers[j]] = cells[j] || '';
        }
        rows.push(rowData);
        if (i === lines.length - 1) {
            endIdx = i + 1;
        }
    }

    return { headers, rows };
}

/**
 * Serializes headers and rows back into a markdown table string.
 */
export function serializeTableToString(headers: string[], rows: TableRow[]): string {
    if (headers.length === 0) return '';

    let res = '| ' + headers.join(' | ') + ' |\n';
    res += '|' + headers.map(() => '---').join('|') + '|\n';

    for (const row of rows) {
        const rowCells = headers.map(h => row[h] || '');
        res += '| ' + rowCells.join(' | ') + ' |\n';
    }

    return res.trim();
}

/**
 * Replaces the first table inside a section with new table text.
 * Returns the modified complete markdown string.
 */
export function replaceTableInSection(markdown: string, sectionHeading: string, newTableText: string): string | null {
    const escaped = escapeRegex(sectionHeading);
    const sectionRegex = new RegExp(`(##\\s+${escaped}\\s*\\n+[\\s\\S]*?)(?:\\n##\\s|$)`);
    const sectionMatch = sectionRegex.exec(markdown);

    if (!sectionMatch) {
        return null;
    }

    const fullMatchText = sectionMatch[0]; // Includes the next heading if matched via the (?:\\n##\\s|$) condition
    const isEOF = !fullMatchText.endsWith('\n## ');

    // We only want to replace within the section content, not the next heading.
    let sectionContent = sectionMatch[1];

    const lines = sectionContent.split('\n');
    let tableStartIdx = -1;
    let tableEndIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (tableStartIdx === -1 && lines[i].trim().startsWith('|')) {
            tableStartIdx = i;
        } else if (tableStartIdx !== -1 && !lines[i].trim().startsWith('|')) {
            tableEndIdx = i;
            break;
        }
    }

    if (tableStartIdx === -1) {
        return null; // No existing table found
    }

    if (tableEndIdx === -1) {
        tableEndIdx = lines.length; // Table goes to end of section content
        // Also remove any trailing empty lines at the end of the table
        while (tableEndIdx > tableStartIdx && lines[tableEndIdx - 1].trim() === '') {
            tableEndIdx--;
        }
    }

    const beforeTable = lines.slice(0, tableStartIdx).join('\n');
    const afterTable = lines.slice(tableEndIdx).join('\n');

    const newSectionContent = beforeTable + (beforeTable.endsWith('\n') ? '' : '\n') + newTableText + '\n' + afterTable;

    const beforeSection = markdown.substring(0, sectionMatch.index);
    // The full match may include the next heading prefix (e.g., '\n## ').
    // afterSection must start AFTER the full match to avoid duplicating the next heading.
    const afterSection = isEOF ? '' : markdown.substring(sectionMatch.index + sectionMatch[0].length);
    // If not EOF, we need to re-insert the next heading prefix that was part of the lookahead
    const nextHeadingPrefix = isEOF ? '' : sectionMatch[0].substring(sectionContent.length);

    return beforeSection + newSectionContent + nextHeadingPrefix + afterSection;
}

/**
 * Reads the swarm-manifest.md from the workspace root.
 */
export function readManifest(workspaceRoot: string): string {
    const manifestPath = path.join(workspaceRoot, 'swarm-manifest.md');
    try {
        return fs.readFileSync(manifestPath, 'utf8');
    } catch (e: any) {
        throw new Error(`Could not read swarm-manifest.md at ${manifestPath}. If the project is in a different directory, pass workspace_root as a tool argument. Error: ${e.message}`);
    }
}

/**
 * Writes the swarm-manifest.md to the workspace root.
 * Creates a backup before writing to prevent data loss.
 */
export function writeManifest(workspaceRoot: string, content: string): void {
    const manifestPath = path.join(workspaceRoot, 'swarm-manifest.md');
    const backupPath = manifestPath + '.bak';

    // Backup existing manifest before overwriting
    if (fs.existsSync(manifestPath)) {
        try {
            fs.copyFileSync(manifestPath, backupPath);
        } catch {
            // Non-fatal: backup failure shouldn't prevent the write
        }
    }

    fs.writeFileSync(manifestPath, content, 'utf8');
}
