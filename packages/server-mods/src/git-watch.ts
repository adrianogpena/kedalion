import { readdir, readFile, stat } from 'node:fs/promises';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

const FILES = new Set(['HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'index', 'packed-refs']);

/** Whether a change at `rel` (relative to the git dir) can alter status, branch or history. Lock files are noise. */
export function isRelevantEvent(rel: string): boolean {
  const p = rel.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  if (p.endsWith('.lock')) return false;
  return FILES.has(p) || p.startsWith('refs/');
}

export interface GitFingerprint {
  files: Record<string, string>;
  refs: string;
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function walkRefs(dir: string, prefix: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.endsWith('.lock')) continue;
    if (e.isDirectory()) await walkRefs(join(dir, e.name), `${prefix}${e.name}/`, out);
    else out.push(`${prefix}${e.name}=${await readOrEmpty(join(dir, e.name))}`);
  }
}

/** A snapshot of the state files in a git dir (the index by size and mtime, the rest by content). */
export async function gitFingerprint(gitDir: string): Promise<GitFingerprint> {
  const files: Record<string, string> = {};
  for (const name of [...FILES].sort()) {
    if (name === 'index') {
      const s = await stat(join(gitDir, name)).catch(() => undefined);
      files[name] = s ? `${s.size}:${s.mtimeMs}` : '';
    } else files[name] = await readOrEmpty(join(gitDir, name));
  }
  const refs: string[] = [];
  await walkRefs(join(gitDir, 'refs'), '', refs);
  return { files, refs: refs.join('\n') };
}

export function fingerprintsEqual(a: GitFingerprint, b: GitFingerprint): boolean {
  if (a.refs !== b.refs) return false;
  const keys = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  for (const k of keys) if (a.files[k] !== b.files[k]) return false;
  return true;
}

export type WatchFn = (dir: string, options: { recursive: boolean }, listener: (event: string, filename: string | null) => void) => Pick<FSWatcher, 'close'>;

export interface GitWatchOptions {
  gitDir: string;
  onChange: () => void;
  debounceMs?: number;
  watch?: WatchFn;
  /** When set, `onChange` fires only if the snapshot differs from the previous one. */
  fingerprint?: () => Promise<GitFingerprint>;
}

/** Watches a git dir and calls `onChange` once per quiet period of relevant events; returns `stop()`. */
export function startGitWatch(opts: GitWatchOptions): () => void {
  const wait = opts.debounceMs ?? 1500;
  const watch = opts.watch ?? (fsWatch as unknown as WatchFn);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: GitFingerprint | undefined;
  let stopped = false;
  const fire = async () => {
    timer = undefined;
    if (stopped) return;
    if (opts.fingerprint) {
      const next = await opts.fingerprint();
      const same = last !== undefined && fingerprintsEqual(last, next);
      last = next;
      if (same || stopped) return;
    }
    opts.onChange();
  };
  if (opts.fingerprint) void opts.fingerprint().then((f) => (last ??= f), () => undefined);
  const watcher = watch(opts.gitDir, { recursive: true }, (_event, filename) => {
    if (stopped || !filename || !isRelevantEvent(String(filename))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void fire(), wait);
  });
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
