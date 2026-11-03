import { describe, expect, test } from 'bun:test';
import { bodyMatches, countSinceMark, errorsSinceMark, filterRows, grepLines, isStuck, pendingAge, requestsBefore, sliceBody, splitMatches } from './netview';

const e = (id: number, over: Record<string, unknown> = {}) => ({ id, url: `http://x/${id}`, done: true, ...over });

describe('filterRows', () => {
  const entries = [e(1), e(2, { url: 'http://x/IDACall' }), e(3, { done: false, startedAt: 1000 })];
  const base = { text: '', bodyIds: null, mark: null, sinceMark: false, pendingOnly: false, now: 20000, pendingSecs: 10 };

  test('url text', () => {
    expect(filterRows(entries, { ...base, text: 'idacall' }).map((r) => r.id)).toEqual([2]);
  });
  test('body ids', () => {
    expect(filterRows(entries, { ...base, bodyIds: new Set([1, 3]) }).map((r) => r.id)).toEqual([1, 3]);
  });
  test('since mark', () => {
    expect(filterRows(entries, { ...base, mark: { id: 1, ts: 0 }, sinceMark: true }).map((r) => r.id)).toEqual([2, 3]);
    expect(filterRows(entries, { ...base, sinceMark: true }).length).toBe(3);
  });
  test('pending only', () => {
    expect(filterRows(entries, { ...base, pendingOnly: true }).map((r) => r.id)).toEqual([3]);
  });
});

describe('pending', () => {
  test('age and stuck', () => {
    const p = e(1, { done: false, startedAt: 1000 });
    expect(pendingAge(p, 13500)).toBe(12);
    expect(isStuck(p, 13500, 10)).toBe(true);
    expect(isStuck(p, 5000, 10)).toBe(false);
    expect(pendingAge(e(2), 5000)).toBeUndefined();
  });
});

describe('marks and links', () => {
  test('counts after the mark', () => {
    expect(countSinceMark([e(1), e(2), e(3)], { id: 1, ts: 0 })).toBe(2);
    expect(countSinceMark([e(1)], null)).toBe(0);
    expect(errorsSinceMark([{ ts: 5, level: 'error' }, { ts: 15, level: 'error' }, { ts: 20, level: 'log' }], { id: 0, ts: 10 })).toBe(1);
  });
  test('requests within 2 s before', () => {
    const rows = [e(1, { startedAt: 7000 }), e(2, { startedAt: 9000 }), e(3, { startedAt: 11000 }), e(4)];
    expect(requestsBefore(rows, 10000).map((r) => r.id)).toEqual([2]);
  });
});

describe('body helpers', () => {
  test('bodyMatches checks request, decoded and response', () => {
    expect(bodyMatches({ body: 'Hello World' }, 'world')).toBe(true);
    expect(bodyMatches({ postData: 'a%3Cb' }, 'a<b', 'a<b')).toBe(true);
    expect(bodyMatches({ body: 'x' }, 'y')).toBe(false);
    expect(bodyMatches(undefined, 'y')).toBe(false);
  });
  test('splitMatches', () => {
    expect(splitMatches('aXbxc', 'x')).toEqual([
      { text: 'a', hit: false },
      { text: 'X', hit: true },
      { text: 'b', hit: false },
      { text: 'x', hit: true },
      { text: 'c', hit: false },
    ]);
  });
  test('sliceBody clamps', () => {
    expect(sliceBody('abcdef', 1, 4)).toEqual({ text: 'ef', index: 1, count: 2 });
    expect(sliceBody('abcdef', 9, 4).index).toBe(1);
    expect(sliceBody('', 0).count).toBe(1);
  });
  test('grepLines with context', () => {
    const body = ['a', 'b', 'hit', 'c', 'd', 'e', 'f', 'hit'].join('\n');
    const r = grepLines(body, 'HIT', 1);
    expect(r.matches).toBe(2);
    expect(r.lines).toEqual(['2: b', '3: hit', '4: c', '--', '7: f', '8: hit']);
  });
});
