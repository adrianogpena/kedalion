import { expect, test } from 'bun:test';
import { parseWorktrees, worktreeAddArgs } from './git-worktree.ts';

const text = ['worktree /r/main', 'HEAD aaa', 'branch refs/heads/main', '', 'worktree /r/wt', 'HEAD bbb', 'detached', 'locked reason', '', 'worktree /r/bare.git', 'bare', ''].join('\n');

test('parses blocks and flags', () => {
  const list = parseWorktrees(text, '/r/wt');
  expect(list).toHaveLength(3);
  expect(list[0]).toMatchObject({ path: '/r/main', branch: 'main', current: false });
  expect(list[1]).toMatchObject({ detached: true, locked: true, current: true });
  expect(list[2]).toMatchObject({ bare: true, current: false });
});

test('current is the toplevel, not the first entry', () => {
  expect(parseWorktrees(text, '/r/main/')[0]!.current).toBe(true);
});

test('-z output keeps a path with a newline', () => {
  const z = ['worktree /r/a\nb', 'HEAD aaa', 'branch refs/heads/main', '', 'worktree /r/wt', 'HEAD bbb', 'detached', '', ''].join('\0');
  const list = parseWorktrees(z, '/r/wt');
  expect(list.map((w) => w.path)).toEqual(['/r/a\nb', '/r/wt']);
  expect(list[1]).toMatchObject({ detached: true, current: true });
});

test('a worktree line starts a new entry without a separator', () => {
  expect(parseWorktrees('worktree /a\nHEAD x\nworktree /b\nHEAD y\n', '/b').map((w) => w.path)).toEqual(['/a', '/b']);
});

test('CRLF output', () => {
  expect(parseWorktrees(text.replace(/\n/g, '\r\n'), '/r/wt')).toHaveLength(3);
});

test('worktreeAddArgs puts -- before the path and rejects option-like refs', () => {
  expect(worktreeAddArgs('-x', 'main')).toEqual(['worktree', 'add', '--', '-x', 'main']);
  expect(worktreeAddArgs('p', undefined, 'feat')).toEqual(['worktree', 'add', '-b', 'feat', '--', 'p']);
  expect(worktreeAddArgs('p', '--detach')).toBeUndefined();
  expect(worktreeAddArgs('p', undefined, '-f')).toBeUndefined();
});
