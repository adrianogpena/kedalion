import { expect, test } from 'bun:test';
import { latestProgress, parseProgressLine } from './git-progress.ts';

test('parses percent, counts, remote and bare counts', () => {
  expect(parseProgressLine('Receiving objects:  45% (9/20), 1.2 MiB | 2 MiB/s')).toEqual({ title: 'Receiving objects', percent: 45, current: 9, total: 20, remote: false });
  expect(parseProgressLine('remote: Compressing objects: 100% (3/3), done.')).toEqual({ title: 'Compressing objects', percent: 100, current: 3, total: 3, remote: true });
  expect(parseProgressLine('remote: Enumerating objects: 12, done.')).toEqual({ title: 'Enumerating objects', current: 12, remote: true });
  expect(parseProgressLine('From github.com:a/b')).toBeUndefined();
  expect(parseProgressLine('fatal: could not read')).toBeUndefined();
});

test('latest complete fragment wins', () => {
  expect(latestProgress('Receiving objects:  10% (2/20)\rReceiving objects:  50% (10/20)\rReceiving obj')?.percent).toBe(50);
  expect(latestProgress('Resolving deltas: 100% (4/4), done.\n')?.title).toBe('Resolving deltas');
  expect(latestProgress('partial')).toBeUndefined();
});
