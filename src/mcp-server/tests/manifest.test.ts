import { describe, it, expect } from 'vitest';
import { getTableFromSection, replaceTableInSection, serializeTableToString } from '../src/utils/manifest.js';

const SAMPLE_MANIFEST = `# Swarm Manifest

## Agents

| ID | Role | Phase | Status |
|----|------|-------|--------|
| α | architect | 1 | ⏳ Pending |
| β | developer | 2 | ⏳ Pending |

## File Claims

| File | Claimed By | Status |
|------|------------|--------|

## Issues

| Severity | File/Area | Description | Reported By |
|----------|-----------|-------------|-------------|

## Phase Gates

- [ ] Phase 1 (Planning)
- [ ] Phase 2 (Implementation)
`;

describe('getTableFromSection', () => {
    it('parses Agents table correctly', () => {
        const result = getTableFromSection(SAMPLE_MANIFEST, 'Agents');
        expect(result).not.toBeNull();
        expect(result!.headers).toEqual(['ID', 'Role', 'Phase', 'Status']);
        expect(result!.rows).toHaveLength(2);
        expect(result!.rows[0]['ID']).toBe('α');
        expect(result!.rows[0]['Role']).toBe('architect');
        expect(result!.rows[1]['ID']).toBe('β');
    });

    it('parses empty table (File Claims)', () => {
        const result = getTableFromSection(SAMPLE_MANIFEST, 'File Claims');
        expect(result).not.toBeNull();
        expect(result!.headers).toEqual(['File', 'Claimed By', 'Status']);
        expect(result!.rows).toHaveLength(0);
    });

    it('returns null for non-existent section', () => {
        const result = getTableFromSection(SAMPLE_MANIFEST, 'NonExistent');
        expect(result).toBeNull();
    });

    it('returns null for section without table', () => {
        const result = getTableFromSection(SAMPLE_MANIFEST, 'Phase Gates');
        expect(result).toBeNull();
    });

    it('handles special characters in section heading', () => {
        const md = `## File/Area Claims\n\n| Col | Val |\n|-----|-----|\n| a | b |\n`;
        const result = getTableFromSection(md, 'File/Area Claims');
        expect(result).not.toBeNull();
        expect(result!.rows[0]['Col']).toBe('a');
    });
});

describe('serializeTableToString', () => {
    it('serializes headers and rows', () => {
        const result = serializeTableToString(['ID', 'Status'], [{ ID: 'α', Status: '✅ Done' }]);
        expect(result).toContain('| ID | Status |');
        expect(result).toContain('| α | ✅ Done |');
    });

    it('serializes empty rows', () => {
        const result = serializeTableToString(['File', 'Status'], []);
        expect(result).toContain('| File | Status |');
        const lines = result.trim().split('\n');
        expect(lines).toHaveLength(2); // header + separator only
    });
});

describe('replaceTableInSection', () => {
    it('replaces Agents table', () => {
        const newTable = serializeTableToString(
            ['ID', 'Role', 'Phase', 'Status'],
            [{ ID: 'α', Role: 'architect', Phase: '1', Status: '✅ Complete' }]
        );
        const result = replaceTableInSection(SAMPLE_MANIFEST, 'Agents', newTable);
        expect(result).not.toBeNull();
        expect(result!).toContain('✅ Complete');
        expect(result!).not.toContain('⏳ Pending');
        // Should preserve other sections
        expect(result!).toContain('## File Claims');
        expect(result!).toContain('## Issues');
        expect(result!).toContain('## Phase Gates');
    });

    it('preserves sections after replaced table', () => {
        const newTable = serializeTableToString(
            ['Severity', 'File/Area', 'Description', 'Reported By'],
            [{ Severity: '🔴', 'File/Area': 'foo.ts', Description: 'Bug', 'Reported By': 'α' }]
        );
        const result = replaceTableInSection(SAMPLE_MANIFEST, 'Issues', newTable);
        expect(result).not.toBeNull();
        expect(result!).toContain('Bug');
        expect(result!).toContain('## Phase Gates');
    });

    it('returns null for non-existent section', () => {
        const result = replaceTableInSection(SAMPLE_MANIFEST, 'NonExistent', '| a |\n|---|\n');
        expect(result).toBeNull();
    });

    it('can replace table in last section (before EOF)', () => {
        const md = `## Only Section\n\n| A |\n|---|\n| old |\n`;
        const newTable = '| A |\n|---|\n| new |\n';
        const result = replaceTableInSection(md, 'Only Section', newTable);
        expect(result).not.toBeNull();
        expect(result!).toContain('new');
        expect(result!).not.toContain('old');
    });

    it('does not cause double newlines on successive replacements', () => {
        let md = SAMPLE_MANIFEST;
        for (let i = 0; i < 3; i++) {
            const table = serializeTableToString(
                ['ID', 'Role', 'Phase', 'Status'],
                [{ ID: 'α', Role: 'architect', Phase: '1', Status: `Status ${i}` }]
            );
            md = replaceTableInSection(md, 'Agents', table) || md;
        }
        // No triple+ newlines should exist
        expect(md).not.toMatch(/\n{4,}/);
        expect(md).toContain('Status 2');
    });
});
