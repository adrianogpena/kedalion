import { expect, test } from 'bun:test';
import { conflictCount, parseConflicts, renderConflicts, resolveAll, resolveConflict, unresolvedCount } from './git-conflict.ts';

const two = ['top', '<<<<<<< HEAD', 'o1', '=======', 't1', '>>>>>>> feat', 'mid', '<<<<<<< HEAD', 'o2', '=======', 't2', '>>>>>>> feat', 'end', ''].join('\n');
const crlf = two.replace(/\n/g, '\r\n');

test('parses every conflict and keeps surrounding text', () => {
  const s = parseConflicts(two);
  expect(conflictCount(s)).toBe(2);
  expect(s.map((x) => x.kind)).toEqual(['text', 'conflict', 'text', 'conflict', 'text']);
});

test('unresolved render round-trips exactly', () => {
  expect(renderConflicts(parseConflicts(two))).toBe(two);
  expect(renderConflicts(parseConflicts(crlf))).toBe(crlf);
  expect(renderConflicts(parseConflicts(two.trimEnd()))).toBe(two.trimEnd());
});

test('per-hunk resolution', () => {
  const s = parseConflicts(two);
  expect(renderConflicts(resolveConflict(s, 0, 'ours'))).toContain('o1\nmid\n<<<<<<< HEAD');
  expect(renderConflicts(resolveAll(s, 'theirs'))).toBe('top\nt1\nmid\nt2\nend\n');
  expect(renderConflicts(resolveAll(s, 'both'))).toBe('top\no1\nt1\nmid\no2\nt2\nend\n');
  expect(renderConflicts(resolveAll(s, 'bothReverse'))).toBe('top\nt1\no1\nmid\nt2\no2\nend\n');
  expect(unresolvedCount(resolveConflict(s, 1, 'ours'))).toBe(1);
});

test('CRLF resolution keeps CRLF', () => {
  expect(renderConflicts(resolveAll(parseConflicts(crlf), 'both'))).toBe('top\r\no1\r\nt1\r\nmid\r\no2\r\nt2\r\nend\r\n');
});

test('diff3 base is kept unresolved and dropped on resolve', () => {
  const t = '<<<<<<< HEAD\no\n||||||| base\nb\n=======\nt\n>>>>>>> x\n';
  const s = parseConflicts(t);
  expect(s[0]).toMatchObject({ base: 'b\n' });
  expect(renderConflicts(s)).toBe(t);
  expect(renderConflicts(resolveAll(s, 'ours'))).toBe('o\n');
});

test('unterminated conflict does not drop the rest of the file', () => {
  const t = 'a\n<<<<<<< HEAD\nb\nc\n';
  const s = parseConflicts(t);
  expect(conflictCount(s)).toBe(0);
  expect(renderConflicts(s)).toBe(t);
  const u = '<<<<<<< HEAD\nb\n<<<<<<< X\no\n=======\nt\n>>>>>>> y\nz\n';
  const p = parseConflicts(u);
  expect(conflictCount(p)).toBe(1);
  expect(renderConflicts(p)).toBe(u);
});
