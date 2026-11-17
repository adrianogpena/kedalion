import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitFile } from '@kedalion/server-core';
import { batchPaths, blockedDiscardMessage, checkoutBlocker, discardPlan, pathspecStdin } from './git-discard.ts';

test('batches by count and bytes', () => {
  expect(batchPaths(['a', 'b', 'c'], 100, 2)).toEqual([['a', 'b'], ['c']]);
  expect(batchPaths(['aaaa', 'bbbb', 'c'], 10, 10)).toEqual([['aaaa', 'bbbb'], ['c']]);
  expect(batchPaths([])).toEqual([]);
  expect(pathspecStdin(['a', 'b c'])).toEqual({ args: ['--pathspec-from-file=-', '--pathspec-file-nul'], stdin: 'a\0b c\0' });
});

test('plan order and grouping', () => {
  const files: GitFile[] = [
    { path: 'u.txt', index: '?', worktree: '?', group: 'untracked' },
    { path: 'm.ts', index: '.', worktree: 'M', group: 'unstaged' },
    { path: 'm.ts', index: 'M', worktree: 'M', group: 'staged' },
    { path: 'new.ts', index: 'A', worktree: '.', group: 'staged' },
    { path: 'c.ts', index: 'U', worktree: 'U', group: 'conflict' },
    { path: 'r.ts', origPath: 'old.ts', index: 'R', worktree: '.', group: 'staged' },
    { path: 'sub', index: '.', worktree: 'M', group: 'unstaged' },
  ];
  expect(discardPlan(files, new Set(['sub']))).toEqual([
    { step: 'keepOurs', args: ['checkout', '--ours', '--', 'c.ts'] },
    { step: 'removeAdded', args: ['rm', '-f', '-q', '--', 'new.ts', 'r.ts'] },
    { step: 'restoreHead', args: ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'm.ts', 'old.ts'] },
    { step: 'cleanUntracked', args: ['clean', '-f', '-d', '-q', '--', 'u.txt'] },
    { step: 'resetSubmodule', args: ['submodule', 'update', '--checkout', '--force', '--', 'sub'] },
  ]);
});

test('blockers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kdis-'));
  try {
    await mkdir(join(dir, 'now-dir'));
    await writeFile(join(dir, 'was-dir'), 'x');
    expect(await checkoutBlocker(dir, 'now-dir')).toEqual({ kind: 'dirAtPath', path: 'now-dir' });
    expect(await checkoutBlocker(dir, 'was-dir/a/b.ts')).toEqual({ kind: 'fileAtParent', path: 'was-dir' });
    expect(await checkoutBlocker(dir, 'gone/a.ts')).toBeUndefined();
    expect(await checkoutBlocker(dir, 'was-dir')).toBeUndefined();
    expect(blockedDiscardMessage({ kind: 'dirAtPath', path: 'x' })).toContain('folder');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
