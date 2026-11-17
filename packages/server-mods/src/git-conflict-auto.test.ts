import { expect, test } from 'bun:test';
import { autoResolve, autoResolvePick, hasConflictMarkers, isWhitespaceOnlyDiff, perLineMerge, resolutionForText } from './git-conflict-auto.ts';
import { parseConflicts, renderConflicts, type ConflictSegment } from './git-conflict.ts';

const seg = (ours: string, theirs: string, base?: string): ConflictSegment => ({
  kind: 'conflict',
  ours,
  theirs,
  ...(base !== undefined && { base }),
  resolution: 'unresolved',
  markers: { start: '<<<<<<< a\n', ...(base !== undefined && { base: '||||||| b\n' }), sep: '=======\n', end: '>>>>>>> c\n' },
});

test('ladder: identical, one side changed, per line, whitespace opt-in', () => {
  expect(autoResolvePick(seg('x\n', 'x\n'))).toEqual({ rule: 'identical', resolution: 'ours' });
  expect(autoResolvePick(seg('new\n', 'old\n', 'old\n'))).toEqual({ rule: 'oursOnly', resolution: 'ours' });
  expect(autoResolvePick(seg('old\n', 'new\n', 'old\n'))).toEqual({ rule: 'theirsOnly', resolution: 'theirs' });
  expect(autoResolvePick(seg('A\nb\n', 'a\nB\n', 'a\nb\n'))).toEqual({ rule: 'perLine', resolution: 'merged', merged: 'A\nB\n' });
  expect(autoResolvePick(seg('A\n', 'B\n', 'a\n'))).toBeUndefined();
  expect(autoResolvePick(seg('  x\n', 'x\n'))).toBeUndefined();
  expect(autoResolvePick(seg('  x\n', 'x\n'), { whitespace: true })).toEqual({ rule: 'whitespace', resolution: 'ours' });
});

test('helpers', () => {
  expect(perLineMerge('a\n', 'a\nb\n', 'a\n')).toBeUndefined();
  expect(isWhitespaceOnlyDiff('a b', 'a b')).toBe(false);
  expect(isWhitespaceOnlyDiff('a  b', 'a b')).toBe(true);
  expect(hasConflictMarkers('x\n<<<<<<< HEAD\n')).toBe(true);
  expect(hasConflictMarkers('<<<<<<<< no\n')).toBe(false);
});

test('autoResolve skips decided and unsafe hunks and renders', () => {
  const text = ['<<<<<<< HEAD', 'same', '=======', 'same', '>>>>>>> f', 'mid', '<<<<<<< HEAD', 'o', '=======', 't', '>>>>>>> f', ''].join('\n');
  const r = autoResolve(parseConflicts(text));
  expect(r.applied).toEqual([{ index: 0, rule: 'identical' }]);
  expect(renderConflicts(r.segments)).toBe(['same', 'mid', '<<<<<<< HEAD', 'o', '=======', 't', '>>>>>>> f', ''].join('\n'));
});

test('resolutionForText maps edits back to a pick', () => {
  const s = seg('o\n', 't\n', 'b\n');
  expect(resolutionForText(s, 't\n')).toEqual({ resolution: 'theirs' });
  expect(resolutionForText(s, 't\no\n')).toEqual({ resolution: 'bothReverse' });
  expect(resolutionForText(s, 'b\n')).toEqual({ resolution: 'base' });
  expect(resolutionForText(s, 'z\n')).toEqual({ resolution: 'merged', merged: 'z\n' });
});
