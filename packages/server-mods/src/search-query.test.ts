import { expect, test } from 'bun:test';
import { matchAt, parseSearchQuery, statMatches, typeMatches } from './rooted-fs/search-query.ts';

const NOW = Date.parse('2026-06-15T12:00:00Z');

test('parses terms, phrases, alternatives and filters', () => {
  expect(parseSearchQuery('foo "bar baz" | qux', NOW)).toEqual({ any: [['foo', 'bar baz'], ['qux']], exact: false, types: [] });
  expect(parseSearchQuery('a|b', NOW).any).toEqual([['a'], ['b']]);
  const q = parseSearchQuery('type:image,doc case:exact larger:2kb smallerThan=1 newer:7d older:2026-01-31', NOW);
  expect(q).toMatchObject({ any: [], exact: true, types: ['image', 'doc'], minSize: 2048, maxSize: 1024 ** 2, after: NOW - 7 * 86_400_000, before: Date.parse('2026-01-31T00:00:00Z') });
  expect(parseSearchQuery('type:folder', NOW).types).toEqual(['dir']);
});

test('an invalid filter is a plain term', () => {
  expect(parseSearchQuery('type:nope larger:big C:x', NOW)).toMatchObject({ any: [['type:nope', 'larger:big', 'C:x']], types: [] });
  expect(parseSearchQuery('larger:big', NOW).minSize).toBeUndefined();
});

test('matches terms by case unless exact', () => {
  expect(matchAt(parseSearchQuery('README'), 'docs/readme.md')).toBe(5);
  expect(matchAt(parseSearchQuery('README case:exact'), 'readme.md')).toBe(-1);
  expect(matchAt(parseSearchQuery('README case:exact'), 'README.md')).toBe(0);
  expect(matchAt(parseSearchQuery('md read'), 'readme.md')).toBe(7);
  expect(matchAt(parseSearchQuery('x|read'), 'readme.md')).toBe(0);
  expect(matchAt(parseSearchQuery(''), 'anything')).toBe(0);
});

test('type and stat filters', () => {
  const img = parseSearchQuery('type:image');
  expect(typeMatches(img, 'a.PNG', 'file')).toBe(true);
  expect(typeMatches(img, 'png', 'dir')).toBe(false);
  expect(typeMatches(parseSearchQuery('type:dir'), 'x', 'dir')).toBe(true);
  const big = parseSearchQuery('larger:1kb newer:2026-06-01', NOW);
  expect(statMatches(big, { size: 2048, mtimeMs: NOW }, 'file')).toBe(true);
  expect(statMatches(big, { size: 10, mtimeMs: NOW }, 'file')).toBe(false);
  expect(statMatches(big, { size: 0, mtimeMs: NOW }, 'dir')).toBe(false);
  expect(statMatches(parseSearchQuery('newer:2026-06-01', NOW), { size: 0, mtimeMs: Date.parse('2026-05-01') }, 'dir')).toBe(false);
});
