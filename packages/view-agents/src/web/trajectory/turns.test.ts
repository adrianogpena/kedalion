import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../../protocol';
import { filesOf } from './model';
import { failedCalls, turnOf, unknownResults } from './views';

const steps: AgentTraceStep[] = [
  { kind: 'user', label: 'one', detail: 'one' },
  { kind: 'tool', label: 'Edit', detail: '', tool: 'Edit', file: 'a.ts', edits: [{ old: 'x', new: 'y' }], error: true },
  { kind: 'tool', label: 'Edit', detail: '', tool: 'Edit', file: 'a.ts', edits: [{ old: 'x', new: 'z' }] },
  { kind: 'tool', label: 'Bash', detail: '', tool: 'Bash', command: 'npm test', error: true },
  { kind: 'user', label: 'skill', detail: '', source: 'skill' },
  { kind: 'user', label: 'two', detail: 'two' },
  { kind: 'tool', label: 'Write', detail: '', tool: 'Write', file: 'b.ts', edits: [{ old: '', new: 'b' }], pending: true },
  { kind: 'assistant', label: 'done', detail: 'done' },
  { kind: 'tool', label: 'Bash', detail: '', tool: 'Bash', command: 'npm test', pending: true },
];

test('turnOf maps steps to the prompt they follow', () => {
  expect(turnOf(steps)).toEqual([0, 0, 0, 0, 0, 5, 5, 5, 5]);
});

test('unknownResults flags pending calls the session moved past', () => {
  expect([...unknownResults(steps, true)]).toEqual([6]);
  expect([...unknownResults(steps, false)].sort()).toEqual([6, 8]);
});

test('failedCalls pairs a failure with its fix in the same turn', () => {
  expect(failedCalls(steps)).toEqual([
    { i: 1, tool: 'Edit', label: 'Edit', fixedAt: 2 },
    { i: 3, tool: 'Bash', label: 'Bash' },
  ]);
});

test('filesOf tags edits with their turn and adds git-recovered files', () => {
  const files = filesOf(steps, new Set([6]), [{ file: 'c.ts', i: 8, mtimeMs: 9, diff: '@@\n+x\n-y\n+z' }]);
  const a = files.find((f) => f.file === 'a.ts')!;
  const b = files.find((f) => f.file === 'b.ts')!;
  const c = files.find((f) => f.file === 'c.ts')!;
  expect(a.turns).toEqual([0]);
  expect(a.edits.map((e) => e.turn)).toEqual([0, 0]);
  expect(b.turns).toEqual([5]);
  expect(b.edits[0]!.unknown).toBe(true);
  expect(c.recovered).toEqual({ i: 8, turn: 5, diff: '@@\n+x\n-y\n+z' });
  expect([c.added, c.removed]).toEqual([2, 1]);
  expect(filesOf(steps, new Set(), [{ file: 'A.ts', mtimeMs: 1, diff: '' }]).filter((f) => f.recovered)).toEqual([]);
});
