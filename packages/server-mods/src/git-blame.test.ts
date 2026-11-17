import { expect, test } from 'bun:test';
import { parseBlame } from './git-blame.ts';

const a = 'a'.repeat(40);
const b = 'b'.repeat(64);

test('reuses metadata for repeated commits and accepts 64-hex SHAs', () => {
  const text = [`${a} 1 1 2`, 'author Ann', 'author-time 100', 'summary first', 'filename f', '\tone', `${a} 2 2`, '\ttwo', `${b} 5 3 1`, 'author Bob', 'author-time 200', 'summary second', 'filename f', '\tthree', ''].join('\n');
  const r = parseBlame(text);
  expect(r).toHaveLength(3);
  expect(r[1]).toMatchObject({ line: 2, sha: a, author: 'Ann', summary: 'first', text: 'two' });
  expect(r[2]).toMatchObject({ line: 3, sha: b, author: 'Bob', time: 200 });
});

test('keeps tabs and strips CR in content', () => {
  const r = parseBlame([`${a} 1 1 1`, 'author A', '\t\tx\r', ''].join('\n'));
  expect(r[0]!.text).toBe('\tx');
});
