import { expect, test } from 'bun:test';
import { parseBlame, uncommittedBlame } from './git-blame.ts';

const a = 'a'.repeat(40);
const b = 'b'.repeat(64);

test('reuses metadata for repeated commits and accepts 64-hex SHAs', () => {
  const text = [`${a} 1 1 2`, 'author Ann', 'author-time 100', 'summary first', 'filename f', '\tone', `${a} 2 2`, '\ttwo', `${b} 5 3 1`, 'author Bob', 'author-time 200', 'summary second', 'filename f', '\tthree', ''].join('\n');
  const r = parseBlame(text);
  expect(r).toHaveLength(3);
  expect(r[1]).toMatchObject({ line: 2, sha: a, author: 'Ann', summary: 'first', text: 'two' });
  expect(r[2]).toMatchObject({ line: 3, sha: b, author: 'Bob', time: 200 });
});

test('uncommitted lines, previous and renamed paths', () => {
  const z = '0'.repeat(40);
  const text = [`${z} 1 1 1`, 'author Not Committed Yet', 'previous ' + a + ' f', 'filename f', '\tnew', `${a} 1 2 1`, 'author Ann', 'previous ' + b + ' old', 'filename old', '\tkept', ''].join('\n');
  const r = parseBlame(text, 'f');
  expect(r[0]).toMatchObject({ uncommitted: true, previous: a });
  expect(r[0]!.origPath).toBeUndefined();
  expect(r[1]).toMatchObject({ previous: b, origPath: 'old' });
  expect(r[1]!.uncommitted).toBeUndefined();
});

test('uncommittedBlame marks every line', () => {
  const r = uncommittedBlame('a\r\nb\n');
  expect(r).toHaveLength(2);
  expect(r[1]).toMatchObject({ line: 2, text: 'b', uncommitted: true });
});

test('keeps tabs and strips CR in content', () => {
  const r = parseBlame([`${a} 1 1 1`, 'author A', '\t\tx\r', ''].join('\n'));
  expect(r[0]!.text).toBe('\tx');
});
