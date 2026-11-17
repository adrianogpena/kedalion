import { describe, expect, test } from 'bun:test';
import type { DiffLine } from './diff-parse';
import {
  annotateIntraLineDiff, applyWordDiffToSpans, computeInitialGapStates, focusableOrder, gotoHunk, highlightSearchMatches,
  intraLinePair, moveFocus, normalizeRanges, updateSearchMatches,
} from './intra-line';

const l = (kind: 'add' | 'del' | 'ctx', text: string): DiffLine => ({ kind, text });

describe('intraLinePair', () => {
  test('trims prefix and suffix and snaps to the word', () => {
    const r = intraLinePair('const value = compute(alpha);', 'const value = compile(alpha);')!;
    expect(r.old).toEqual([{ start: 14, end: 21 }]);
    expect(r.new).toEqual([{ start: 14, end: 21 }]);
  });

  test('skips dissimilar lines and identical lines', () => {
    expect(intraLinePair('abcdefgh', 'zyxwvuts')).toBeNull();
    expect(intraLinePair('same', 'same')).toBeNull();
  });

  test('does not split surrogate pairs', () => {
    const r = intraLinePair('keep keep \u{1F600} tail', 'keep keep \u{1F601} tail', 0)!;
    expect(r.old[0]).toEqual({ start: 10, end: 12 });
  });
});

describe('annotateIntraLineDiff', () => {
  test('pairs del and add runs in order', () => {
    const lines = [l('ctx', 'x'), l('del', 'let a = 1;'), l('del', 'let b = 2;'), l('add', 'let a = 5;'), l('ctx', 'y')];
    const out = annotateIntraLineDiff(lines);
    expect(out[1]).toEqual([{ start: 8, end: 9 }]);
    expect(out[3]).toEqual([{ start: 8, end: 9 }]);
    expect(out[2]).toBeUndefined();
    expect(out[0]).toBeUndefined();
  });
});

describe('overlays', () => {
  test('normalizeRanges sorts and merges', () => {
    expect(normalizeRanges([{ start: 5, end: 8 }, { start: 0, end: 2 }, { start: 7, end: 9 }, { start: 3, end: 3 }])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 9 },
    ]);
  });

  test('splits styled spans across ranges', () => {
    const out = applyWordDiffToSpans([{ text: 'abc', className: 'k' }, { text: 'def' }], [{ start: 1, end: 4 }]);
    expect(out).toEqual([
      { text: 'a', className: 'k' },
      { text: 'bc', className: 'k word-diff' },
      { text: 'd', className: 'word-diff' },
      { text: 'ef' },
    ]);
  });

  test('search highlight marks the current match', () => {
    const out = highlightSearchMatches([{ text: 'foo' }], [{ start: 0, end: 3 }], true);
    expect(out).toEqual([{ text: 'foo', className: 'search-match search-current' }]);
  });
});

describe('updateSearchMatches', () => {
  test('is case-insensitive and escapes the query', () => {
    expect(updateSearchMatches(['Foo foo', 'a.b', 'axb'], 'FOO')).toEqual([
      { line: 0, start: 0, end: 3 },
      { line: 0, start: 4, end: 7 },
    ]);
    expect(updateSearchMatches(['a.b', 'axb'], 'a.b')).toEqual([{ line: 0, start: 0, end: 3 }]);
    expect(updateSearchMatches(['x'], '')).toEqual([]);
  });
});

describe('navigation', () => {
  test('gotoHunk wraps', () => {
    expect(gotoHunk(2, 3, 1)).toBe(0);
    expect(gotoHunk(0, 3, -1)).toBe(2);
    expect(gotoHunk(null, 3, 1)).toBe(0);
    expect(gotoHunk(null, 3, -1)).toBe(2);
    expect(gotoHunk(0, 0, 1)).toBeNull();
  });

  test('focus ring orders by row and moves', () => {
    const order = focusableOrder([
      { kind: 'hunk', row: 5, id: 'h1' },
      { kind: 'expand', row: 5, id: 'e1' },
      { kind: 'expand', row: 1, id: 'e0' },
    ]);
    expect(order.map((f) => f.id)).toEqual(['e0', 'e1', 'h1']);
    expect(moveFocus(2, 3, 1)).toBe(0);
    expect(moveFocus(2, 3, 1, false)).toBe(2);
    expect(moveFocus(null, 3, -1)).toBe(2);
  });
});

describe('computeInitialGapStates', () => {
  test('reveals min(3, gap/2) on each side', () => {
    const gaps = computeInitialGapStates([
      { oldStart: 1, oldCount: 5, newStart: 1, newCount: 5 },
      { oldStart: 31, oldCount: 4, newStart: 31, newCount: 4 },
    ]);
    expect(gaps).toEqual([{ after: 0, oldFrom: 9, oldTo: 27, newFrom: 9, newTo: 27, top: 3, bottom: 3, hidden: 19 }]);
  });

  test('small gaps and leading and trailing gaps', () => {
    const gaps = computeInitialGapStates([{ oldStart: 11, oldCount: 3, newStart: 11, newCount: 3 }], 20);
    expect(gaps[0]).toMatchObject({ after: -1, top: 0, bottom: 3, hidden: 7, oldFrom: 1, oldTo: 7 });
    expect(gaps[1]).toMatchObject({ after: 0, top: 3, bottom: 0, hidden: 4, oldFrom: 17, oldTo: 20 });
    expect(computeInitialGapStates([{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 }, { oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 }])[0]).toMatchObject({ top: 1, bottom: 1, hidden: 0 });
  });
});
