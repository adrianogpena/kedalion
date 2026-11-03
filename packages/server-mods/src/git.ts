import { runWithTimeout, type Runner } from '@kedalion/platform';
import {
  AppError,
  invalid,
  notFound,
  type GitCode,
  type GitCommit,
  type GitCommitFile,
  type GitDiff,
  type GitFile,
  type GitFileContent,
  type GitRepoInfo,
  type GitStatus,
  type Routes,
} from '@kedalion/server-core';
import { isBinary } from './bytes.ts';
import { badPath, segmentsOf, type FsRoot } from './rooted-fs.ts';

export interface GitRoutesOptions {
  /** The registered roots; the same function the gallery passes to `rootedFs`. */
  roots: () => Promise<FsRoot[]>;
  /** Runs a command: `runWithTimeout` from platform, a fake in tests. */
  run?: Runner;
}

const STATUS_TIMEOUT_MS = 10_000;
const QUICK_TIMEOUT_MS = 5_000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_DIFF_CHARS = 1_000_000;
const MAX_UNTRACKED_BYTES = 1_000_000;
const LOG_PAGE = 50;
const MAX_LOG_PAGE = 200;
const HASH = /^[0-9a-f]{7,40}$/;
const LOG_FORMAT = ['%H', '%h', '%an', '%aI', '%D', '%s'].join('%x1f');

const gitMissing = () => new AppError('internal', 'gitMissing', 'Git was not found on PATH.');
const notARepo = () => invalid('notARepo', 'This folder is not in a Git repository.');
const gitTimeout = () => new AppError('internal', 'gitTimeout', 'Git took too long to answer.');
const gitFailed = (stderr: string) => {
  if (/dubious ownership/i.test(stderr)) {
    return new AppError('internal', 'gitDubiousOwnership', 'Git refuses this folder: its owner differs. Add it to safe.directory.', { detail: stderr.trim() });
  }
  return new AppError('internal', 'gitFailed', stderr.trim().split(/\r?\n/)[0] || 'Git failed.', { detail: stderr.trim() });
};

export interface PorcelainStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  ignored?: string[];
}

/** Parses `git status --porcelain=v2 -z --branch` output; paths stay as git prints them (repo-relative). */
export function parsePorcelainV2(text: string): PorcelainStatus {
  const out: PorcelainStatus = { branch: '', ahead: 0, behind: 0, files: [] };
  const tokens = text.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t) continue;
    if (t.startsWith('# ')) {
      const space = t.indexOf(' ', 2);
      const key = space < 0 ? t.slice(2) : t.slice(2, space);
      const value = space < 0 ? '' : t.slice(space + 1);
      if (key === 'branch.head') out.branch = value;
      else if (key === 'branch.upstream') out.upstream = value;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          out.ahead = Number(m[1]);
          out.behind = Number(m[2]);
        }
      }
    } else if (t[0] === '1') {
      const f = t.split(' ');
      addEntry(out.files, f[1]!, t.split(' ').slice(8).join(' '));
    } else if (t[0] === '2') {
      const path = t.split(' ').slice(9).join(' ');
      const origPath = tokens[++i] ?? '';
      addEntry(out.files, t.split(' ')[1]!, path, origPath);
    } else if (t[0] === 'u') {
      const path = t.split(' ').slice(10).join(' ');
      out.files.push({ path, index: 'U', worktree: 'U', group: 'conflict' });
    } else if (t[0] === '?') {
      out.files.push({ path: t.slice(2), index: '?', worktree: '?', group: 'untracked' });
    } else if (t[0] === '!') {
      (out.ignored ??= []).push(t.slice(2));
    }
  }
  return out;
}

/** Parses `git diff --numstat -z` output into counts by (new) path; binary files (`-\t-`) get no counts. */
export function parseNumstat(out: string): Map<string, { added?: number; removed?: number }> {
  const map = new Map<string, { added?: number; removed?: number }>();
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(t);
    if (!m) continue;
    let path = m[3]!;
    if (path === '') {
      i++;
      path = tokens[++i] ?? '';
    }
    map.set(path, m[1] === '-' || m[2] === '-' ? {} : { added: Number(m[1]), removed: Number(m[2]) });
  }
  return map;
}

/** Parses `git log -z --format=<LOG_FORMAT>` output. */
export function parseLog(text: string): GitCommit[] {
  return text
    .split('\0')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', short = '', author = '', date = '', refs = '', ...subject] = record.split('\x1f');
      return { hash, short, author, date, subject: subject.join('\x1f'), ...(refs && { refs }) };
    });
}

/** Parses `git diff-tree -r -z --name-status -M` output. */
export function parseNameStatus(text: string): GitCommitFile[] {
  const tokens = text.split('\0');
  const out: GitCommitFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]!.trim();
    if (!code) continue;
    const status = code[0] as GitCode;
    if (status === 'R' || status === 'C') {
      const origPath = tokens[++i] ?? '';
      out.push({ path: tokens[++i] ?? '', origPath, status });
    } else {
      out.push({ path: tokens[++i] ?? '', status });
    }
  }
  return out;
}

function addEntry(files: GitFile[], xy: string, path: string, origPath?: string): void {
  const index = xy[0] as GitCode;
  const worktree = xy[1] as GitCode;
  const base = origPath ? { path, origPath } : { path };
  if (index !== '.') files.push({ ...base, index, worktree, group: 'staged' });
  if (worktree !== '.') files.push({ ...base, index, worktree, group: 'unstaged' });
}

let gitOnPath: boolean | undefined;
const defaultRun: Runner = (cmd, timeoutMs) => {
  gitOnPath ??= Bun.which('git') !== null;
  if (!gitOnPath) throw gitMissing();
  return runWithTimeout(cmd, timeoutMs);
};

/**
 * Read-only Git routes over the registered roots: `GET /api/git/repos|status|file|diff|log|commit`. The client
 * sends a root id and a root-relative path; every call runs `git -C <root>` with the path after `--`
 * (or inside a `HEAD:` / `:` revision), so no client string is ever an option.
 */
export function gitRoutes(opts: GitRoutesOptions): Routes {
  const run = opts.run ?? defaultRun;

  async function git(root: FsRoot, args: string[], timeoutMs = QUICK_TIMEOUT_MS) {
    let result;
    try {
      // A folder's own .git/config must not run programs: no fsmonitor hook (status), external diff,
      // textconv (diff) or signature check (log, through gpg.program); filter drivers via filterOverrides.
      result = await run(['git', '--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-C', root.path, ...args], timeoutMs);
    } catch (e) {
      throw e instanceof AppError ? e : gitMissing();
    }
    if (result.kind === 'timeout') throw gitTimeout();
    return result;
  }

  /**
   * `-c` overrides blanking every filter driver the folder's own config defines (local, worktree or included
   * from them): `status` and a worktree `diff` would run its clean/process command on stat-dirty files.
   * Global and system drivers (e.g. git-lfs) are the user's own and stay.
   */
  async function filterOverrides(root: FsRoot): Promise<string[]> {
    const r = await git(root, ['config', '--show-scope', '--name-only', '--get-regexp', '^filter\\.']);
    if (r.code !== 0) return [];
    const names = new Set<string>();
    for (const line of r.stdout.split(/\r?\n/)) {
      const [scope, key] = line.split('\t');
      if (!key || scope === 'global' || scope === 'system') continue;
      const m = /^filter\.(.+)\.[^.]+$/i.exec(key);
      if (m) names.add(m[1]!);
    }
    return [...names].flatMap((n) => ['-c', `filter.${n}.clean=`, '-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`]);
  }

  /** Stdout of a call that must succeed. */
  async function gitOut(root: FsRoot, args: string[], timeoutMs?: number): Promise<string> {
    const r = await git(root, args, timeoutMs);
    if (r.code !== 0) throw /not a git repository/i.test(r.stderr) ? notARepo() : gitFailed(r.stderr);
    return r.stdout;
  }

  async function findRoot(id: unknown): Promise<FsRoot> {
    const root = typeof id === 'string' ? (await opts.roots()).find((r) => r.id === id) : undefined;
    if (!root) throw notFound('rootNotFound', 'This folder is no longer registered or no longer exists.');
    return root;
  }

  /** The folder's path inside its repo, `sub/dir/` or empty at the top. */
  async function prefixOf(root: FsRoot): Promise<string> {
    const out = await gitOut(root, ['rev-parse', '--show-toplevel', '--show-prefix']);
    return (out.split(/\r?\n/)[1] ?? '').trim();
  }

  function commitOf(query: URLSearchParams): string {
    const hash = query.get('commit') ?? '';
    if (!HASH.test(hash)) throw invalid('badRequest', 'Invalid request.');
    return hash;
  }

  /** `diff-tree` arguments comparing a commit with its first parent, or with the empty tree for a root commit. */
  async function rangeOf(root: FsRoot, hash: string): Promise<string[]> {
    const parents = (await gitOut(root, ['rev-list', '--parents', '-n1', hash])).trim().split(' ');
    return parents[1] ? [parents[1], hash] : ['--root', hash];
  }

  function filePath(query: URLSearchParams): string {
    const segments = segmentsOf(query.get('path') ?? '');
    if (!segments.length) throw badPath();
    return segments.join('/');
  }

  async function status(root: FsRoot, untracked: boolean, ignored = false): Promise<GitStatus> {
    const args = [...(await filterOverrides(root)), 'status', '--porcelain=v2', '-z', '--branch', untracked ? '--untracked-files=all' : '--untracked-files=no', ...(ignored ? ['--ignored=matching'] : []), '--', '.'];
    const parsed = parsePorcelainV2(await gitOut(root, args, STATUS_TIMEOUT_MS));
    if (!untracked) return { ...parsed, files: [] };
    const prefix = await prefixOf(root);
    const strip = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
    const numstat = async (cached: boolean) => {
      try {
        const r = await git(root, [...(await filterOverrides(root)), 'diff', ...(cached ? ['--cached'] : []), '--numstat', '-z', '--no-ext-diff', '--no-textconv', '-M', '--relative', '--', '.'], STATUS_TIMEOUT_MS);
        return r.code === 0 ? parseNumstat(r.stdout) : new Map<string, { added?: number; removed?: number }>();
      } catch {
        return new Map<string, { added?: number; removed?: number }>();
      }
    };
    const [work, cached] = await Promise.all([numstat(false), numstat(true)]);
    const countUntracked = async (path: string): Promise<{ added?: number; removed?: number }> => {
      try {
        const file = Bun.file(`${root.path}/${path}`);
        if (file.size > MAX_UNTRACKED_BYTES) return {};
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isBinary(bytes.subarray(0, 8192))) return {};
        let n = 0;
        for (const b of bytes) if (b === 10) n++;
        if (bytes.length && bytes[bytes.length - 1] !== 10) n++;
        return { added: n, removed: 0 };
      } catch {
        return {};
      }
    };
    const files = await Promise.all(
      parsed.files.map(async (f) => {
        const path = strip(f.path);
        const base = { ...f, path, ...(f.origPath !== undefined && { origPath: strip(f.origPath) }) };
        if (f.group === 'staged') return { ...base, ...cached.get(path) };
        if (f.group === 'unstaged') return { ...base, ...work.get(path) };
        if (f.group === 'untracked') return { ...base, ...(await countUntracked(path)) };
        return base;
      }),
    );
    return { ...parsed, files, ...(ignored && { ignored: (parsed.ignored ?? []).map(strip) }) };
  }

  return {
    'GET /api/git/repos': async () => {
      const roots = await opts.roots();
      return Promise.all(
        roots.map(async (root): Promise<GitRepoInfo> => {
          try {
            const { branch, upstream, ahead, behind } = await status(root, false);
            return { root: root.id, repo: true, branch, ...(upstream !== undefined && { upstream }), ahead, behind };
          } catch (e) {
            if (e instanceof AppError && e.code === 'notARepo') return { root: root.id, repo: false };
            return { root: root.id, repo: false, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
    },

    'GET /api/git/status': async ({ query }) => status(await findRoot(query.get('root')), true, query.get('ignored') === '1'),

    'GET /api/git/file': async ({ query }) => {
      const root = await findRoot(query.get('root'));
      const path = filePath(query);
      const from = query.get('from');
      const prefix = await prefixOf(root);
      let tree: string;
      if (from === 'head') tree = 'HEAD';
      else if (from === 'index') tree = '';
      else if (from === 'commit') tree = commitOf(query);
      else if (from === 'parent') tree = `${commitOf(query)}^`;
      else throw invalid('badRequest', 'Invalid request.');
      const rev = `${tree}:${prefix}${path}`;
      const size = await git(root, ['cat-file', '-s', rev]);
      if (size.code !== 0) {
        if (/not a git repository/i.test(size.stderr)) throw notARepo();
        if (/dubious ownership/i.test(size.stderr)) throw gitFailed(size.stderr);
        return { missing: true } satisfies GitFileContent;
      }
      if (Number(size.stdout.trim()) > MAX_FILE_BYTES) return { tooLarge: true } satisfies GitFileContent;
      const text = await gitOut(root, ['show', rev]);
      if (isBinary(new TextEncoder().encode(text.slice(0, 8192)))) return { binary: true } satisfies GitFileContent;
      return { text } satisfies GitFileContent;
    },

    'GET /api/git/log': async ({ query }) => {
      const root = await findRoot(query.get('root'));
      const skip = Math.max(0, Math.floor(Number(query.get('skip')) || 0));
      const limit = Math.min(MAX_LOG_PAGE, Math.max(1, Math.floor(Number(query.get('limit')) || LOG_PAGE)));
      const r = await git(root, ['log', '-z', '--no-show-signature', `--format=${LOG_FORMAT}`, `--skip=${skip}`, `-n${limit}`, '--', '.'], STATUS_TIMEOUT_MS);
      if (r.code !== 0) {
        if (/does not have any commits/i.test(r.stderr)) return [] satisfies GitCommit[];
        throw /not a git repository/i.test(r.stderr) ? notARepo() : gitFailed(r.stderr);
      }
      return parseLog(r.stdout);
    },

    'GET /api/git/commit': async ({ query }) => {
      const root = await findRoot(query.get('root'));
      const range = await rangeOf(root, commitOf(query));
      const text = await gitOut(root, ['diff-tree', '-r', '-z', '--no-commit-id', '--name-status', '-M', '--relative', ...range, '--'], STATUS_TIMEOUT_MS);
      return parseNameStatus(text);
    },

    'GET /api/git/diff': async ({ query }) => {
      const root = await findRoot(query.get('root'));
      const path = filePath(query);
      const commit = query.get('commit');
      const args = commit
        ? ['diff-tree', '-p', '--no-commit-id', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', ...(await rangeOf(root, commitOf(query))), '--', path]
        : [...(await filterOverrides(root)), 'diff', ...(query.get('staged') === '1' ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--no-textconv', '--', path];
      const text = await gitOut(root, args);
      return (text.length > MAX_DIFF_CHARS ? { text: text.slice(0, MAX_DIFF_CHARS), truncated: true } : { text, truncated: false }) satisfies GitDiff;
    },
  };
}
