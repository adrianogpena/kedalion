import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentFileGit, AgentTraceStep } from '../protocol.ts';

const GIT_TIMEOUT_MS = 8000;
const MAX_FILES = 400;

export type GitExec = (cwd: string, args: string[]) => Promise<string | null>;

export const execGit: GitExec = async (cwd, args) => {
  try {
    const proc = Bun.spawn(['git', '--no-optional-locks', ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', windowsHide: true });
    const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
    try {
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return code === 0 ? out : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
};

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();

interface Touched {
  edited: boolean;
  firstTs?: number;
  lastTs?: number;
  /** The last change removed or moved the file away. */
  gone: boolean;
}

/** Files the steps touched (with whether they were changed and when first), keyed by trace path. */
export function touchedFiles(steps: AgentTraceStep[]): Map<string, Touched> {
  const m = new Map<string, Touched>();
  const mark = (file: string, edited: boolean, ts?: number, gone = false) => {
    const x = m.get(file) ?? { edited: false, gone: false };
    if (edited) {
      x.edited = true;
      x.gone = gone;
      if (ts !== undefined && (x.firstTs === undefined || ts < x.firstTs)) x.firstTs = ts;
      if (ts !== undefined && (x.lastTs === undefined || ts > x.lastTs)) x.lastTs = ts;
    }
    m.set(file, x);
  };
  for (const s of steps) {
    if (s.kind !== 'tool') continue;
    if (s.file) mark(s.file, s.edits !== undefined, s.ts);
    for (const f of s.shellFiles ?? []) mark(f.path, f.op !== 'restore', s.ts, f.op === 'delete' || f.op === 'move-from');
  }
  return m;
}

const DRIFT_MARGIN_MS = 3000;

const statOf = (p: string): { mtimeMs: number } | undefined => {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
};

/** Files whose disk state no longer matches the session's last change: modified afterwards, missing, or back after a delete. */
export function diskCheck(steps: AgentTraceStep[], stat: (p: string) => { mtimeMs: number } | undefined = statOf): Record<string, 'changed' | 'missing'> {
  const out: Record<string, 'changed' | 'missing'> = {};
  for (const [file, info] of [...touchedFiles(steps)].slice(0, MAX_FILES)) {
    if (!info.edited || !isAbsolute(file)) continue;
    const st = stat(file);
    if (info.gone) {
      if (st) out[file] = 'changed';
    } else if (!st) out[file] = 'missing';
    else if (info.lastTs !== undefined && st.mtimeMs > info.lastTs + DRIFT_MARGIN_MS) out[file] = 'changed';
  }
  return out;
}

function porcelainStatus(xy: string): AgentFileGit {
  if (xy === '??') return 'untracked';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

/** Git standing of every file the session touched, relative to the repository of `cwd`. */
export async function fileStatus(steps: AgentTraceStep[], cwd: string | undefined, exec: GitExec = execGit): Promise<Record<string, AgentFileGit>> {
  if (!cwd) return {};
  const top = (await exec(cwd, ['rev-parse', '--show-toplevel']))?.trim();
  if (!top) return {};
  const touched = [...touchedFiles(steps)].slice(0, MAX_FILES);
  const result: Record<string, AgentFileGit> = {};
  const inside: Array<[string, string, Touched]> = [];
  for (const [file, info] of touched) {
    const rel = relative(top, resolve(cwd, file)).replace(/\\/g, '/');
    if (rel === '' || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) result[file] = 'outside';
    else inside.push([file, rel, info]);
  }
  if (inside.length === 0) return result;
  const paths = inside.map(([, rel]) => rel);
  const status = await exec(top, ['status', '--porcelain=v1', '-z', '--', ...paths]);
  const byRel = new Map<string, AgentFileGit>();
  if (status) {
    const parts = status.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.length < 4) continue;
      const xy = p.slice(0, 2);
      byRel.set(norm(p.slice(3)), porcelainStatus(xy));
      if (xy.includes('R') || xy.includes('C')) i++;
    }
  }
  const tracked = new Set((await exec(top, ['ls-files', '-z', '--', ...paths]))?.split('\0').filter(Boolean).map(norm) ?? []);
  const ignored = new Set((await exec(top, ['check-ignore', '-z', '--', ...paths]))?.split('\0').filter(Boolean).map(norm) ?? []);
  for (const [file, rel, info] of inside) {
    const key = norm(rel);
    const s = byRel.get(key);
    if (s) result[file] = s;
    else if (ignored.has(key)) result[file] = 'ignored';
    else if (tracked.has(key) && info.edited && info.firstTs !== undefined) {
      const since = new Date(info.firstTs - 1000).toISOString();
      const log = await exec(top, ['log', '-1', '--format=%H', `--since=${since}`, '--', rel]);
      result[file] = log && log.trim() ? 'committed' : 'reverted';
    } else result[file] = 'clean';
  }
  return result;
}
