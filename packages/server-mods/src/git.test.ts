import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunResult } from '@kedalion/platform';
import { gitRoutes, parseLog, parseNameStatus, parseNumstat, parsePorcelainV2 } from './git.ts';

const done = (stdout: string, code = 0, stderr = ''): RunResult => ({ kind: 'done', code, stdout, stderr });
const roots = async () => [{ id: 'r1', path: 'C:/proj' }];
const q = (o: Record<string, string>) => ({ query: new URLSearchParams(o) }) as never;

test('parsePorcelainV2 reads branch headers', () => {
  const out = parsePorcelainV2('# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0');
  expect(out).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, files: [] });
});

test('parsePorcelainV2 splits staged and unstaged entries of one file', () => {
  const out = parsePorcelainV2('1 MM N... 100644 100644 100644 h1 h2 src/a b.ts\0');
  expect(out.files).toEqual([
    { path: 'src/a b.ts', index: 'M', worktree: 'M', group: 'staged' },
    { path: 'src/a b.ts', index: 'M', worktree: 'M', group: 'unstaged' },
  ]);
});

test('parsePorcelainV2 reads renames, conflicts, untracked and ignored', () => {
  const out = parsePorcelainV2(
    ['2 R. N... 100644 100644 100644 h1 h2 R100 új.ts', 'old.ts', 'u UU N... 1 2 3 4 h1 h2 h3 c.ts', '? ñ/new file.txt', '! ignored.log', ''].join('\0'),
  );
  expect(out.files).toEqual([
    { path: 'új.ts', origPath: 'old.ts', index: 'R', worktree: '.', group: 'staged' },
    { path: 'c.ts', index: 'U', worktree: 'U', group: 'conflict' },
    { path: 'ñ/new file.txt', index: '?', worktree: '?', group: 'untracked' },
  ]);
  expect(out.ignored).toEqual(['ignored.log']);
});

test('routes refuse an unknown root and a bad path', async () => {
  const routes = gitRoutes({ roots, run: async () => done('') });
  await expect(routes['GET /api/git/status']!(q({ root: 'nope' }))).rejects.toMatchObject({ code: 'rootNotFound' });
  await expect(routes['GET /api/git/diff']!(q({ root: 'r1', path: '../x' }))).rejects.toMatchObject({ code: 'badPath' });
  await expect(routes['GET /api/git/file']!(q({ root: 'r1', path: '', from: 'head' }))).rejects.toMatchObject({ code: 'badPath' });
});

test('status maps timeout, missing git and not a repo', async () => {
  const status = (run: Parameters<typeof gitRoutes>[0]['run']) => gitRoutes({ roots, run })['GET /api/git/status']!(q({ root: 'r1' }));
  await expect(status(async () => ({ kind: 'timeout' }))).rejects.toMatchObject({ code: 'gitTimeout' });
  await expect(status(async () => done('', 128, 'fatal: not a git repository'))).rejects.toMatchObject({ code: 'notARepo' });
  await expect(status(async () => done('', 128, 'fatal: detected dubious ownership'))).rejects.toMatchObject({ code: 'gitDubiousOwnership' });
  await expect(
    status(async () => {
      throw new Error('ENOENT');
    }),
  ).rejects.toMatchObject({ code: 'gitMissing' });
});

test('status strips the repo prefix and scopes every call', async () => {
  const calls: string[][] = [];
  const run = async (cmd: string[]) => {
    calls.push(cmd);
    if (cmd.includes('rev-parse')) return done('C:/repo\nsub/dir/\n');
    return done('# branch.head main\0? sub/dir/a.txt\0');
  };
  const out = await gitRoutes({ roots, run })['GET /api/git/status']!(q({ root: 'r1' }));
  expect(out).toMatchObject({ branch: 'main', files: [{ path: 'a.txt', group: 'untracked' }] });
  expect(calls[1]!.slice(0, 9)).toEqual(['git', '--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-C', 'C:/proj', 'status']);
  expect(calls[1]!.slice(-2)).toEqual(['--', '.']);
});

test('status lists ignored paths on request, without the repo prefix', async () => {
  const calls: string[][] = [];
  const run = async (cmd: string[]) => {
    calls.push(cmd);
    if (cmd.includes('rev-parse')) return done('C:/repo\nsub/\n');
    return done('# branch.head main\0! sub/node_modules/\0! sub/a.log\0');
  };
  const out = await gitRoutes({ roots, run })['GET /api/git/status']!(q({ root: 'r1', ignored: '1' }));
  expect(out).toMatchObject({ ignored: ['node_modules/', 'a.log'] });
  expect(calls[1]).toContain('--ignored=matching');
});

test('repos reports a folder outside a repo', async () => {
  const run = async () => done('', 128, 'fatal: not a git repository');
  expect(await gitRoutes({ roots, run })['GET /api/git/repos']!(q({}))).toEqual([{ root: 'r1', repo: false }]);
});

test.skipIf(Bun.which('git') === null)('live repo: status, file and diff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'git-test-'));
  try {
    const sh = (...args: string[]) => Bun.spawnSync(['git', '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    sh('init');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    sh('add', '.');
    sh('commit', '-m', 'init');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    writeFileSync(join(dir, 'b.txt'), 'new\n');
    const routes = gitRoutes({ roots: async () => [{ id: 'd', path: dir }] });
    const status = (await routes['GET /api/git/status']!(q({ root: 'd' }))) as { files: Array<{ path: string; group: string }> };
    expect(status.files.map((f) => `${f.group}:${f.path}`).sort()).toEqual(['unstaged:a.txt', 'untracked:b.txt']);
    expect(await routes['GET /api/git/file']!(q({ root: 'd', path: 'a.txt', from: 'head' }))).toEqual({ text: 'one\n' });
    expect(await routes['GET /api/git/file']!(q({ root: 'd', path: 'b.txt', from: 'head' }))).toEqual({ missing: true });
    const diff = (await routes['GET /api/git/diff']!(q({ root: 'd', path: 'a.txt' }))) as { text: string };
    expect(diff.text).toContain('+two');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseLog reads commits with refs and a subject holding the separator', () => {
  const text = ['a1\x1fa\x1fAna\x1f2026-01-02T03:04:05+00:00\x1fHEAD -> main\x1fFix x', '\nb2\x1fb\x1fBo\x1f2026-01-01T00:00:00+00:00\x1f\x1fone\x1ftwo', ''].join('\0');
  expect(parseLog(text)).toEqual([
    { hash: 'a1', short: 'a', author: 'Ana', date: '2026-01-02T03:04:05+00:00', refs: 'HEAD -> main', subject: 'Fix x' },
    { hash: 'b2', short: 'b', author: 'Bo', date: '2026-01-01T00:00:00+00:00', subject: 'one\x1ftwo' },
  ]);
});

test('parseNumstat reads plain lines, binary files and renames', () => {
  const out = ['3\t1\tsrc/a.ts', '-\t-\timg.png', '0\t0\t', 'old.ts', 'new.ts', '5\t2\tb.txt', ''].join('\0');
  const map = parseNumstat(out);
  expect(map.get('src/a.ts')).toEqual({ added: 3, removed: 1 });
  expect(map.get('img.png')).toEqual({});
  expect(map.get('new.ts')).toEqual({ added: 0, removed: 0 });
  expect(map.get('b.txt')).toEqual({ added: 5, removed: 2 });
  expect(map.has('old.ts')).toBe(false);
});

test('parseNameStatus reads plain entries and renames', () => {
  expect(parseNameStatus(['M', 'src/a.ts', 'R087', 'old.ts', 'new.ts', 'D', 'gone.txt', ''].join('\0'))).toEqual([
    { path: 'src/a.ts', status: 'M' },
    { path: 'new.ts', origPath: 'old.ts', status: 'R' },
    { path: 'gone.txt', status: 'D' },
  ]);
});

test('commit and file at a commit refuse a bad hash', async () => {
  const routes = gitRoutes({ roots, run: async () => done('') });
  await expect(routes['GET /api/git/commit']!(q({ root: 'r1', commit: '--all' }))).rejects.toMatchObject({ code: 'badRequest' });
  await expect(routes['GET /api/git/file']!(q({ root: 'r1', path: 'a.ts', from: 'parent', commit: 'HEAD~1' }))).rejects.toMatchObject({ code: 'badRequest' });
});

test('commit diffs against the first parent, or the empty tree for a root commit', async () => {
  const calls: string[][] = [];
  const run = (parents: string) => async (cmd: string[]) => {
    calls.push(cmd);
    return cmd.includes('rev-list') ? done(parents) : done('A\0a.ts\0');
  };
  expect(await gitRoutes({ roots, run: run('abc1234 p1 p2\n') })['GET /api/git/commit']!(q({ root: 'r1', commit: 'abc1234' }))).toEqual([{ path: 'a.ts', status: 'A' }]);
  expect(calls[1]!.slice(-3)).toEqual(['p1', 'abc1234', '--']);
  await gitRoutes({ roots, run: run('abc1234\n') })['GET /api/git/commit']!(q({ root: 'r1', commit: 'abc1234' }));
  expect(calls[3]!.slice(-3)).toEqual(['--root', 'abc1234', '--']);
});
