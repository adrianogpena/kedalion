import { expect, test } from 'bun:test';
import { parseWorktrees } from './git-worktree.ts';

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

test('CRLF output', () => {
  expect(parseWorktrees(text.replace(/\n/g, '\r\n'), '/r/wt')).toHaveLength(3);
});
