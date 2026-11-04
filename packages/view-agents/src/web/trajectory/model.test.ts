import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../../protocol';
import { applyFilters, infoOf, entriesOf, filesOf, findFrom, fmtDuration, fmtTokens, focusOf, isError, lineDiff, NO_FILTERS, toolStats } from './model';

const steps: AgentTraceStep[] = [
  { kind: 'user', label: 'go', detail: 'go' },
  { kind: 'tool', label: 'Read(a.ts)', detail: 'Read', tool: 'Read', file: 'a.ts', durationMs: 100, toolUseId: 't1' },
  { kind: 'tool', label: 'Edit(a.ts)', detail: 'Edit', tool: 'Edit', file: 'a.ts', edits: [{ old: 'x', new: 'y' }], durationMs: 300, error: true, toolUseId: 't2' },
  { kind: 'user', label: 'go', detail: 'go' },
];

test('filters by kind, tool, errors and text', () => {
  const e = entriesOf(steps);
  expect(applyFilters(e, { ...NO_FILTERS, tool: 'Edit' }).map((x) => x.i)).toEqual([2]);
  expect(applyFilters(e, { ...NO_FILTERS, errorsOnly: true }).map((x) => x.i)).toEqual([2]);
  expect(applyFilters(e, { ...NO_FILTERS, kinds: ['user'] }).map((x) => x.i)).toEqual([0, 3]);
  expect(applyFilters(e, { ...NO_FILTERS, query: 'read(' }).map((x) => x.i)).toEqual([1]);
});

test('finds the nearest error in both directions', () => {
  const e = entriesOf(steps);
  expect(findFrom(e, 3, -1, isError)?.i).toBe(2);
  expect(findFrom(e, 2, 1, isError)).toBeUndefined();
});

test('tool stats and files', () => {
  expect(toolStats(steps).map((s) => [s.tool, s.calls, s.errors, s.maxMs])).toEqual([['Edit', 1, 1, 300], ['Read', 1, 0, 100]]);
  expect(filesOf(steps)).toEqual([{ file: 'a.ts', reads: 1, edits: [{ i: 2, old: 'x', new: 'y', error: true }] }]);
});

test('line diff keeps shared lines', () => {
  expect(lineDiff('a\nb\nc', 'a\nx\nc').map((l) => l.kind)).toEqual(['same', 'del', 'add', 'same']);
  expect(lineDiff('', 'n').map((l) => l.kind)).toEqual(['add']);
});

test('focus tells equal messages apart', () => {
  expect(focusOf(steps, 3, 1)).toMatchObject({ kind: 'user', text: 'go', nth: 1 });
  expect(focusOf(steps, 2, 1)).toEqual({ at: 1, toolUseId: 't2' });
});

test('groups steps of one request and tracks the context change', () => {
  const s: AgentTraceStep[] = [
    { kind: 'tool', label: 'a', detail: '', messageId: 'm1', context: 1000 },
    { kind: 'tool', label: 'b', detail: '', messageId: 'm1' },
    { kind: 'assistant', label: 'c', detail: '', messageId: 'm2', context: 2100 },
  ];
  const info = infoOf(s);
  expect(info.map((x) => [x.head, x.group, x.delta])).toEqual([[undefined, 2, undefined], [0, 2, undefined], [undefined, 1, 1100]]);
  expect(info[1]!.members).toEqual([0, 1]);
  expect(info[2]!.members).toEqual([]);
});

test('formats durations and tokens', () => {
  expect(fmtDuration(450)).toBe('450ms');
  expect(fmtDuration(65_000)).toBe('1m 5s');
  expect(fmtTokens(84_200)).toBe('84.2k');
  expect(fmtTokens(1_500_000)).toBe('1.5M');
});
