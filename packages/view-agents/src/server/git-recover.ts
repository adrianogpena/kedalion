import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentRecoveredFile, AgentTraceStep } from '../protocol.ts';
import { execGit, type GitExec, touchedFiles } from './file-status.ts';

const MAX_FILES = 100;
const MAX_CANDIDATES = 2000;
const MAX_DIFF = 20_000;
const BEFORE_MS = 2000;
const AFTER_MS = 5000;

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();

const mtimeOf = (p: string): number | undefined => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return undefined;
  }
};

const readText = (p: string): string | undefined => {
  try {
    const text = readFileSync(p, 'utf8');
    return text.includes('\0') ? undefined : text;
  } catch {
    return undefined;
  }
};

const capDiff = (s: string) => (s.length > MAX_DIFF ? `${s.slice(0, MAX_DIFF)}\n…` : s);

export interface RecoverIo {
  exec?: GitExec;
  mtime?: (p: string) => number | undefined;
  read?: (p: string) => string | undefined;
}

/** The shell step whose run explains a change at `mtime`: the one running then, else the last one started before it. */
export function creditStep(steps: AgentTraceStep[], mtime: number): number | undefined {
  let before: number | undefined;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.kind !== 'tool' || s.area !== 'shell' || s.ts === undefined || s.sidechain) continue;
    if (s.ts > mtime + BEFORE_MS) break;
    const end = s.ts + (s.durationMs ?? 0) + BEFORE_MS;
    if (mtime <= end) return i;
    before = i;
  }
  return before;
}

/**
 * Files of the repository that changed on disk during the session although no tool call names them
 * (formatters, `sed -i`, generators). Baseline: the commit HEAD was on when the session started.
 * Files already dirty before the start are skipped when their mtime predates it.
 */
export async function recoverShellChanges(steps: AgentTraceStep[], cwd: string | undefined, io: RecoverIo = {}): Promise<AgentRecoveredFile[]> {
  const exec = io.exec ?? execGit;
  const mtime = io.mtime ?? mtimeOf;
  const read = io.read ?? readText;
  const times = steps.map((s) => s.ts).filter((v): v is number => v !== undefined);
  if (!cwd || times.length === 0) return [];
  if (!steps.some((s) => s.kind === 'tool' && s.area === 'shell')) return [];
  const start = Math.min(...times);
  const end = Math.max(...times);
  const top = (await exec(cwd, ['rev-parse', '--show-toplevel']))?.trim();
  if (!top) return [];
  const base = (await exec(top, ['rev-list', '-1', `--before=${new Date(start).toISOString()}`, 'HEAD']))?.trim() || 'HEAD';
  const changed = (await exec(top, ['diff', '--name-only', '-z', base]))?.split('\0').filter(Boolean) ?? [];
  const untracked = new Set((await exec(top, ['ls-files', '--others', '--exclude-standard', '-z']))?.split('\0').filter(Boolean) ?? []);
  const known = new Set([...touchedFiles(steps).keys()].map((f) => norm(resolve(cwd, f))));
  const out: AgentRecoveredFile[] = [];
  for (const rel of [...changed, ...untracked].slice(0, MAX_CANDIDATES)) {
    const file = resolve(top, rel);
    if (known.has(norm(file))) continue;
    const m = mtime(file);
    if (m === undefined || m < start - BEFORE_MS || m > end + AFTER_MS) continue;
    const i = creditStep(steps, m);
    let diff: string;
    if (untracked.has(rel)) {
      const text = read(file);
      if (text === undefined) continue;
      diff = text.split('\n').map((l) => `+${l}`).join('\n');
    } else diff = (await exec(top, ['diff', '--no-color', '--no-ext-diff', base, '--', rel])) ?? '';
    out.push({ file, mtimeMs: m, diff: capDiff(diff), ...(i !== undefined ? { i } : {}) });
    if (out.length >= MAX_FILES) break;
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}
