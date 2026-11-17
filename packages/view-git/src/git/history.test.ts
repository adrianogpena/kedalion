import { describe, expect, test } from 'bun:test';
import {
  firstParentChain,
  firstParentPosition,
  foldRunMessages,
  foldTargets,
  historyMatcher,
  isRefinement,
  isStashCommit,
  nearestSurvivor,
  parseTodoLine,
  splitMessage,
  squashCheck,
  squashMessage,
  type HistoryCommit,
} from './history.ts';

const c = (hash: string, parents: string[], subject = hash, author?: string): HistoryCommit => ({ hash, parents, subject, ...(author && { author }) });
// e (HEAD) - d - m (merge of c and x) - c - b - a (root)
const page = [c('e', ['d']), c('d', ['m']), c('m', ['c', 'x']), c('x', ['b']), c('c', ['b']), c('b', ['a']), c('a', [])];

describe('first-parent walk', () => {
  test('chain and position', () => {
    expect(firstParentChain(page, 'e', 'b')).toEqual(['e', 'd', 'm', 'c', 'b']);
    expect(firstParentChain(page, 'e', 'x')).toBeUndefined();
    expect(firstParentPosition(page, 'e', 'd')).toEqual({ kind: 'linear', distance: 1 });
    expect(firstParentPosition(page, 'e', 'c')).toEqual({ kind: 'belowMerge', distance: 3 });
    expect(firstParentPosition(page, 'e', 'x')).toEqual({ kind: 'notFound' });
  });

  test('squash checks', () => {
    expect(squashCheck(page, ['e', 'd'], 'e')).toEqual({ ok: true, newest: 'e', oldest: 'd', onto: 'm' });
    expect(squashCheck(page, ['c', 'b'], 'e')).toEqual({ ok: true, newest: 'c', oldest: 'b', onto: 'a' });
    expect(squashCheck(page, ['e'], 'e')).toEqual({ ok: false, reason: 'tooFew' });
    expect(squashCheck(page, ['e', 'zz'], 'e')).toEqual({ ok: false, reason: 'notLoaded' });
    expect(squashCheck(page, ['e', 'x'], 'e')).toEqual({ ok: false, reason: 'notOnHead' });
    expect(squashCheck(page, ['e', 'c'], 'e')).toEqual({ ok: false, reason: 'notContiguous' });
    expect(squashCheck(page, ['d', 'm'], 'e')).toEqual({ ok: false, reason: 'merge' });
    expect(squashCheck(page, ['b', 'a'], 'e')).toEqual({ ok: false, reason: 'root' });
  });
});

test('stash rows', () => {
  expect(isStashCommit(c('s', ['a', 'b'], 'WIP on main: 123 fix'))).toBe(true);
  expect(isStashCommit(c('s', ['a', 'b', 'u'], 'On feat: saved'))).toBe(true);
  expect(isStashCommit(c('s', ['a'], 'WIP on main: x'))).toBe(false);
  expect(isStashCommit(c('s', ['a', 'b'], 'Merge branch x'))).toBe(false);
});

test('messages', () => {
  expect(splitMessage('Title\r\n\r\nBody line\r\nmore\r\n')).toEqual({ subject: 'Title', body: 'Body line\nmore' });
  expect(splitMessage('  only  ')).toEqual({ subject: 'only', body: '' });
  expect(squashMessage(['first\n', '', 'second\n\nbody'])).toBe('first\n\nsecond\n\nbody');
});

test('rebase todo', () => {
  const lines = ['pick aaa one', 'squash bbb two', 'fixup -C ccc three', '# comment', 'exec make', 'f ddd four', 'p eee five', 'f fff six'].map(parseTodoLine);
  expect(lines[2]).toEqual({ word: 'fixup', role: 'fold', hash: 'ccc', useMessage: true, rest: 'three' });
  expect(lines[3]).toBeUndefined();
  expect(lines[4]).toEqual({ word: 'exec', role: 'command', rest: 'make' });
  expect(foldTargets(lines)).toEqual([undefined, 0, 0, undefined, undefined, undefined, undefined, 6]);
  const run = [lines[0]!, lines[1]!].map((line, i) => ({ line, message: `m${i}` }));
  expect(foldRunMessages(run)).toEqual(['m0', 'm1']);
  expect(foldRunMessages([...run, { line: lines[2]!, message: 'm2' }])).toEqual(['m2']);
  expect(foldRunMessages([{ line: lines[6]!, message: 'a' }, { line: lines[7]!, message: 'b' }])).toEqual(['a']);
});

test('find and refinement', () => {
  const list = [c('abcd1234', [], 'Fix login', 'Ann'), c('ffff0000', [], 'Add abcd parser', 'Bob')];
  const hits = (q: string, o = {}) => list.filter(historyMatcher(q, o)!).map((x) => x.hash);
  expect(hits('login')).toEqual(['abcd1234']);
  expect(hits('bob')).toEqual(['ffff0000']);
  expect(hits('abcd')).toEqual(['abcd1234', 'ffff0000']);
  expect(hits('^Add', { regex: true })).toEqual(['ffff0000']);
  expect(historyMatcher('(', { regex: true })).toBeUndefined();
  expect(isRefinement('fix', 'fix log')).toBe(true);
  expect(isRefinement('fix', 'fi')).toBe(false);
  expect(isRefinement('fix', 'fix l', { regex: true })).toBe(false);
});

test('nearest survivor', () => {
  expect(nearestSurvivor(['a', 'b', 'c', 'd'], ['a', 'c', 'd'], 'c')).toBe('c');
  expect(nearestSurvivor(['a', 'b', 'c', 'd'], ['a', 'd'], 'c')).toBe('d');
  expect(nearestSurvivor(['a', 'b', 'c', 'd'], ['a', 'd'], 'b')).toBe('a');
  expect(nearestSurvivor(['a'], [], 'a')).toBeUndefined();
});
