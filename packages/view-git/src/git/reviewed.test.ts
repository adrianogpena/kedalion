import { beforeEach, expect, test } from 'bun:test';
import { clearReviewed, isReviewed, markReviewed, reviewKey } from './reviewed';

beforeEach(() => clearReviewed());

test('marked files are reviewed until their counts change', () => {
  const key = reviewKey('p', { path: 'a.ts', added: 2, removed: 1 });
  expect(isReviewed(key)).toBe(false);
  markReviewed([key]);
  expect(isReviewed(key)).toBe(true);
  expect(isReviewed(reviewKey('p', { path: 'a.ts', added: 3, removed: 1 }))).toBe(false);
  expect(isReviewed(reviewKey('q', { path: 'a.ts', added: 2, removed: 1 }))).toBe(false);
});

test('binary files key without counts', () => {
  const key = reviewKey('p', { path: 'x.png' });
  markReviewed([key]);
  expect(isReviewed(key)).toBe(true);
});
