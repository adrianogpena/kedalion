import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../protocol.ts';
import { fileStatus, type GitExec } from './file-status.ts';

const steps: AgentTraceStep[] = [
  { kind: 'tool', label: '', detail: '', tool: 'Edit', file: '/repo/a.ts', edits: [{ old: 'x', new: 'y' }], ts: 5000 },
  { kind: 'tool', label: '', detail: '', tool: 'Edit', file: '/repo/b.ts', edits: [{ old: 'x', new: 'y' }], ts: 5000 },
  { kind: 'tool', label: '', detail: '', tool: 'Edit', file: '/repo/c.ts', edits: [{ old: 'x', new: 'y' }], ts: 5000 },
  { kind: 'tool', label: '', detail: '', tool: 'Read', file: '/elsewhere/d.ts' },
];

test('maps touched files to their git standing', async () => {
  const exec: GitExec = async (_cwd, args) => {
    if (args[0] === 'rev-parse') return '/repo\n';
    if (args[0] === 'status') return ' M a.ts\0';
    if (args[0] === 'ls-files') return 'a.ts\0b.ts\0c.ts\0';
    if (args[0] === 'check-ignore') return '';
    if (args[0] === 'log') return args.includes('b.ts') ? 'abc\n' : '';
    return null;
  };
  expect(await fileStatus(steps, '/repo', exec)).toEqual({ '/repo/a.ts': 'modified', '/repo/b.ts': 'committed', '/repo/c.ts': 'reverted', '/elsewhere/d.ts': 'outside' });
  expect(await fileStatus(steps, undefined, exec)).toEqual({});
});
