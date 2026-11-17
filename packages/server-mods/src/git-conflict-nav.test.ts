import { expect, test } from 'bun:test';
import { conflictIndexForLine, conflictRanges, reconcileConflictIndex, stepConflict } from './git-conflict-nav.ts';
import { parseConflicts, resolveConflict } from './git-conflict.ts';

const block = (o: string, t: string) => ['<<<<<<< HEAD', o, '=======', t, '>>>>>>> f'];
const three = parseConflicts(['top', ...block('o1', 't1'), 'mid', ...block('o2', 't2'), ...block('o3', 't3'), 'end', ''].join('\n'));

test('ranges and line lookup', () => {
  const ranges = conflictRanges(three);
  expect(ranges).toEqual([
    { index: 0, start: 2, end: 6 },
    { index: 1, start: 8, end: 12 },
    { index: 2, start: 13, end: 17 },
  ]);
  expect(conflictIndexForLine(ranges, 1)).toBeUndefined();
  expect(conflictIndexForLine(ranges, 10)).toBe(1);
  expect(conflictIndexForLine(ranges, 13)).toBe(2);
});

test('step wraps, skips resolved, keeps a sole target', () => {
  expect(stepConflict(three, undefined, 1)).toBe(0);
  expect(stepConflict(three, 2, 1)).toBe(0);
  expect(stepConflict(three, 0, -1)).toBe(2);
  const one = resolveConflict(resolveConflict(three, 0, 'ours'), 2, 'theirs');
  expect(stepConflict(one, 1, 1, true)).toBe(1);
  expect(stepConflict(one, 1, -1, true)).toBe(1);
  expect(stepConflict(resolveConflict(one, 1, 'ours'), 1, 1, true)).toBeUndefined();
});

test('reconcile follows the same hunk, else the nearest', () => {
  const fewer = parseConflicts(['top', ...block('o2', 't2'), ...block('o3', 't3'), ''].join('\n'));
  expect(reconcileConflictIndex(three, fewer, 2)).toBe(1);
  expect(reconcileConflictIndex(three, fewer, 0)).toBe(0);
  const other = parseConflicts(['x', ...block('a', 'b'), ''].join('\n'));
  expect(reconcileConflictIndex(three, other, 2)).toBe(0);
  expect(reconcileConflictIndex(three, parseConflicts('none\n'), 1)).toBeUndefined();
});
