import { expect, test } from 'bun:test';
import { appendAttributesRule, appendIgnorePatterns, ignorePattern } from './git-ignore.ts';

test('patterns by kind, escaped and anchored', () => {
  expect(ignorePattern('src/a[1].ts', 'file')).toBe('/src/a\\[1\\].ts');
  expect(ignorePattern('!keep', 'file')).toBe('/!keep');
  expect(ignorePattern('build\\out\\', 'folder')).toBe('/build/out/');
  expect(ignorePattern('logs/x.LOG', 'extension')).toBe('*.LOG');
  expect(ignorePattern('trail ', 'file')).toBe('/trail\\ ');
  expect(ignorePattern('Makefile', 'extension')).toBeUndefined();
  expect(ignorePattern('.env', 'extension')).toBeUndefined();
  for (const bad of ['/abs', 'C:/x', '../up', 'a/./b', 'a\nb', '']) expect(ignorePattern(bad, 'file')).toBeUndefined();
});

test('append dedupes, keeps CRLF, closes the last line', () => {
  expect(appendIgnorePatterns('node_modules\r\n/dist', ['/dist', '*.log', '*.log'])).toEqual({ content: 'node_modules\r\n/dist\r\n*.log\r\n', added: ['*.log'] });
  expect(appendIgnorePatterns('', ['/a'])).toEqual({ content: '/a\n', added: ['/a'] });
  expect(appendIgnorePatterns('/a\n', ['/a']).added).toEqual([]);
});

test('attributes rule quotes and skips duplicates', () => {
  expect(appendAttributesRule('', 'my file.bin', ['binary'])?.content).toBe('"/my file.bin" binary\n');
  expect(appendAttributesRule('/x.psd filter=lfs -text\n', 'x.psd', ['filter=lfs', '-text'])?.added).toEqual([]);
  expect(appendAttributesRule('', 'x', ['a b'])).toBeUndefined();
});
