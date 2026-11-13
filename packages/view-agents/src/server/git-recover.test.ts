import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../protocol.ts';
import { creditStep, recoverShellChanges } from './git-recover.ts';
import type { GitExec } from './file-status.ts';

const steps: AgentTraceStep[] = [
  { kind: 'user', label: 'go', detail: 'go', ts: 10_000 },
  { kind: 'tool', label: 'Edit', detail: '', tool: 'Edit', area: 'files', file: '/repo/a.ts', edits: [{ old: 'x', new: 'y' }], ts: 20_000 },
  { kind: 'tool', label: 'Bash', detail: '', tool: 'Bash', area: 'shell', command: 'prettier -w .', ts: 30_000, durationMs: 5000 },
  { kind: 'tool', label: 'Bash', detail: '', tool: 'Bash', area: 'shell', command: 'ls', ts: 60_000, durationMs: 100 },
];

test('creditStep picks the shell step running at the change, else the last one before', () => {
  expect(creditStep(steps, 33_000)).toBe(2);
  expect(creditStep(steps, 50_000)).toBe(2);
  expect(creditStep(steps, 60_050)).toBe(3);
  expect(creditStep(steps, 5000)).toBeUndefined();
});

test('recoverShellChanges keeps files changed during the session that no tool call names', async () => {
  const exec: GitExec = async (_cwd, args) => {
    if (args[0] === 'rev-parse') return '/repo\n';
    if (args[0] === 'rev-list') return 'base1\n';
    if (args[0] === 'diff' && args[1] === '--name-only') return 'a.ts\0b.ts\0old.ts\0';
    if (args[0] === 'ls-files') return 'new.ts\0';
    if (args[0] === 'diff') return `diff of ${args[args.length - 1]} vs ${args[3]}`;
    return null;
  };
  const mtimes: Record<string, number> = { 'a.ts': 21_000, 'b.ts': 34_000, 'old.ts': 1000, 'new.ts': 61_000 };
  const out = await recoverShellChanges(steps, '/repo', {
    exec,
    mtime: (p) => mtimes[p.replace(/\\/g, '/').split('/').pop()!],
    read: () => 'one\ntwo',
  });
  expect(out.map((r) => ({ ...r, file: r.file.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '') }))).toEqual([
    { file: '/repo/b.ts', i: 2, mtimeMs: 34_000, diff: 'diff of b.ts vs base1' },
    { file: '/repo/new.ts', i: 3, mtimeMs: 61_000, diff: '+one\n+two' },
  ]);
  expect(await recoverShellChanges(steps.slice(0, 2), '/repo', { exec })).toEqual([]);
});
