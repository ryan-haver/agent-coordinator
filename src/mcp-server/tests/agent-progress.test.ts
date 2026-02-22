import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    readAgentProgress,
    writeAgentProgress,
    createAgentProgress,
    readAllAgentProgress
} from '../src/utils/agent-progress.js';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-progress-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createAgentProgress', () => {
    it('creates progress with defaults', () => {
        const p = createAgentProgress('α', 'architect', '1', 'test-session');
        expect(p.agent_id).toBe('α');
        expect(p.role).toBe('architect');
        expect(p.phase).toBe('1');
        expect(p.swarm_session_id).toBe('test-session');
        expect(p.status).toBe('⏳ Pending');
        expect(p.file_claims).toEqual([]);
        expect(p.issues).toEqual([]);
        expect(p.handoff_notes).toBe('');
    });
});

describe('writeAgentProgress / readAgentProgress', () => {
    it('writes and reads back a progress file', () => {
        const p = createAgentProgress('test-agent', 'developer', '2');
        p.status = '🔄 Active';
        writeAgentProgress(tmpDir, p);

        const read = readAgentProgress(tmpDir, 'test-agent');
        expect(read).not.toBeNull();
        expect(read!.agent_id).toBe('test-agent');
        expect(read!.status).toBe('🔄 Active');
        expect(read!.last_updated).toBeTruthy();
    });

    it('returns null for non-existent agent', () => {
        const read = readAgentProgress(tmpDir, 'no-such-agent');
        expect(read).toBeNull();
    });

    it('updates existing progress file', () => {
        const p = createAgentProgress('test-agent', 'developer', '2');
        writeAgentProgress(tmpDir, p);

        const p2 = readAgentProgress(tmpDir, 'test-agent')!;
        p2.status = '✅ Complete';
        p2.file_claims.push({ file: 'src/foo.ts', status: '✅ Done' });
        writeAgentProgress(tmpDir, p2);

        const read = readAgentProgress(tmpDir, 'test-agent');
        expect(read!.status).toBe('✅ Complete');
        expect(read!.file_claims).toHaveLength(1);
    });

    it('handles Unicode agent IDs', () => {
        const p = createAgentProgress('α', 'architect', '1');
        writeAgentProgress(tmpDir, p);
        const read = readAgentProgress(tmpDir, 'α');
        expect(read).not.toBeNull();
        expect(read!.agent_id).toBe('α');
    });
});

describe('readAllAgentProgress', () => {
    it('returns empty array for empty directory', () => {
        const all = readAllAgentProgress(tmpDir);
        expect(all).toEqual([]);
    });

    it('reads all agent files', () => {
        writeAgentProgress(tmpDir, createAgentProgress('agent-1', 'developer', '1'));
        writeAgentProgress(tmpDir, createAgentProgress('agent-2', 'qa', '2'));
        writeAgentProgress(tmpDir, createAgentProgress('agent-3', 'architect', '1'));

        const all = readAllAgentProgress(tmpDir);
        expect(all).toHaveLength(3);
        const ids = all.map(a => a.agent_id).sort();
        expect(ids).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });

    it('skips malformed files', () => {
        writeAgentProgress(tmpDir, createAgentProgress('good-agent', 'dev', '1'));
        // Write a malformed file
        fs.writeFileSync(path.join(tmpDir, 'swarm-agent-bad.json'), '{invalid json', 'utf8');

        const all = readAllAgentProgress(tmpDir);
        expect(all).toHaveLength(1);
        expect(all[0].agent_id).toBe('good-agent');
    });

    it('returns empty for non-existent directory', () => {
        const all = readAllAgentProgress('/tmp/no-such-dir-' + Date.now());
        expect(all).toEqual([]);
    });
});
