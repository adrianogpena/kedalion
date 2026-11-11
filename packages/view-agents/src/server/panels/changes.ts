import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { AppError, invalid, notFound } from '@kedalion/server-core';
import { findSessionFile } from '../chat/normalize.ts';
import type { PanelCtx, PanelRoutes } from './ctx.ts';
import { repoRelative, touchedFiles } from './session-files.ts';

export interface SessionCommit {
  hash: string;
  subject: string;
  /** The commit's files that the session wrote. */
  files: string[];
}

const GIT_TIMEOUT_MS = 60_000;
const MAX_PATHS = 5000;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `git <args>` in `cwd` without ever prompting for credentials; a timeout kills it. */
export async function runGit(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitResult> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code: timedOut ? 124 : code, stdout, stderr: timedOut ? `git ${args[0]} timed out` : stderr };
  } finally {
    clearTimeout(timer);
  }
}

const failed = (r: GitResult) => {
  const text = (r.stderr.trim() || r.stdout.trim() || 'Git failed.');
  return new AppError('internal', 'gitFailed', text.split(/\r?\n/)[0] ?? text, { detail: text });
};

/** A path inside the project: relative, no `..`, not absolute. */
export function safePath(p: unknown): string {
  if (typeof p !== 'string' || p === '' || p.includes('\0') || isAbsolute(p) || /^[a-z]:/i.test(p)) throw invalid('badPath', 'Invalid path.');
  if (p.startsWith(':')) throw invalid('badPath', 'Invalid path.');
  const norm = p.replaceAll('\\', '/');
  if (norm.split('/').some((s) => s === '..')) throw invalid('badPath', 'Invalid path.');
  return norm;
}

const pathsOf = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > MAX_PATHS) throw invalid('badPath', 'Invalid path.');
  return v.map(safePath);
};

const branchName = (v: unknown): string => {
  if (typeof v !== 'string' || v === '' || v.startsWith('-') || /[\s\0~^:?*[\\]/.test(v) || v.includes('..')) throw invalid('badBranch', 'Invalid branch name.');
  return v;
};

interface Body {
  project?: string;
  paths?: unknown;
  untracked?: unknown;
  all?: unknown;
  message?: unknown;
  amend?: unknown;
  push?: unknown;
  branch?: unknown;
  create?: unknown;
  pop?: unknown;
}

/** Server routes of the changes panel: `POST /api/agents/git/<action>` with `{ project, ... }` and `GET /api/agents/git/branches?project=`. */
export const routes: PanelRoutes = (ctx: PanelCtx) => {
  const rootOf = (project: unknown): string => {
    const root = typeof project === 'string' ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('projectNotFound', 'Project not found.');
    return root;
  };
  const ok = async (root: string, args: string[], timeout?: number) => {
    const r = await runGit(root, args, timeout);
    if (r.code !== 0) throw failed(r);
    return r;
  };
  const post = (fn: (root: string, b: Body) => Promise<unknown>) => async ({ json }: { json<T>(): Promise<T> }) => {
    const b = await json<Body>();
    return fn(rootOf(b.project), b);
  };

  const push = async (root: string) => {
    const r = await runGit(root, ['push']);
    if (r.code === 0) return;
    if (/no upstream branch/i.test(r.stderr)) {
      await ok(root, ['push', '--set-upstream', 'origin', 'HEAD']);
      return;
    }
    throw failed(r);
  };

  return {
    'GET /api/agents/git/branches': async ({ query }) => {
      const root = rootOf(query.get('project'));
      const out = (await ok(root, ['branch', '--format=%(HEAD)|%(refname:short)'])).stdout;
      const branches = out
        .split('\n')
        .filter((l) => l.includes('|'))
        .map((l) => ({ name: l.slice(l.indexOf('|') + 1).trim(), current: l.startsWith('*') }))
        .filter((b) => !b.name.startsWith('('));
      return { branches };
    },
    'GET /api/agents/git/session': async ({ query }) => {
      const root = rootOf(query.get('project'));
      const sessionId = query.get('sessionId') ?? '';
      const file = sessionId ? (ctx.accountDirs?.() ?? []).map((d) => findSessionFile(d, sessionId)).find(Boolean) : undefined;
      if (!file) return { files: [], commits: [] };
      const { paths, startedAt } = touchedFiles(readFileSync(file, 'utf8'), root);
      const top = (await runGit(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
      const files = top ? paths.map((p) => repoRelative(top, p)).filter((p): p is string => p !== undefined) : [];
      const mine = new Set(files.map((f) => f.toLowerCase()));
      const commits: SessionCommit[] = [];
      if (mine.size && startedAt !== undefined) {
        const log = await runGit(root, ['log', `--since=${new Date(startedAt).toISOString()}`, '--name-only', '--format=%x01%H%x02%s']);
        if (log.code === 0) {
          for (const chunk of log.stdout.split('\x01').slice(1)) {
            const [head = '', rest = ''] = chunk.split('\n\n');
            const [hash = '', subject = ''] = head.split('\x02');
            const changed = rest.split('\n').map((l) => l.trim()).filter((l) => mine.has(l.toLowerCase()));
            if (changed.length) commits.push({ hash, subject: subject.trim(), files: changed });
          }
        }
      }
      return { files, commits };
    },
    'POST /api/agents/git/stage': post(async (root, b) => {
      if (b.all === true) await ok(root, ['add', '-A']);
      else await ok(root, ['add', '-A', '--', ...pathsOf(b.paths)]);
      return { ok: true };
    }),
    'POST /api/agents/git/unstage': post(async (root, b) => {
      const head = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
      const base = head.code === 0 ? ['reset', '-q', 'HEAD'] : ['rm', '--cached', '-r', '-q'];
      await ok(root, b.all === true ? (head.code === 0 ? base : [...base, '--', '.']) : [...base, '--', ...pathsOf(b.paths)]);
      return { ok: true };
    }),
    'POST /api/agents/git/discard': post(async (root, b) => {
      const tracked = b.paths === undefined ? [] : pathsOf(b.paths);
      const untracked = b.untracked === undefined ? [] : pathsOf(b.untracked);
      if (tracked.length) await ok(root, ['restore', '--worktree', '--', ...tracked]);
      if (untracked.length) await ok(root, ['clean', '-f', '-d', '--', ...untracked]);
      return { ok: true };
    }),
    'POST /api/agents/git/commit': post(async (root, b) => {
      const message = typeof b.message === 'string' ? b.message.trim() : '';
      const amend = b.amend === true;
      if (!message && !amend) throw invalid('emptyMessage', 'Write a commit message.');
      await ok(root, ['commit', ...(amend ? ['--amend'] : []), ...(message ? ['-m', message] : ['--no-edit'])]);
      if (b.push === true) await push(root);
      return { ok: true };
    }),
    'POST /api/agents/git/undo': post(async (root) => {
      await ok(root, ['reset', '--soft', 'HEAD~1']);
      return { ok: true };
    }),
    'POST /api/agents/git/pull': post(async (root) => {
      await ok(root, ['pull']);
      return { ok: true };
    }),
    'POST /api/agents/git/push': post(async (root) => {
      await push(root);
      return { ok: true };
    }),
    'POST /api/agents/git/stash': post(async (root, b) => {
      await ok(root, b.pop === true ? ['stash', 'pop'] : ['stash', 'push', '--include-untracked']);
      return { ok: true };
    }),
    'POST /api/agents/git/checkout': post(async (root, b) => {
      const name = branchName(b.branch);
      await ok(root, b.create === true ? ['checkout', '-b', name] : ['checkout', name]);
      return { ok: true };
    }),
  };
};
