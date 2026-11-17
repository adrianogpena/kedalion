import { readdir, readFile, stat } from 'node:fs/promises';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

const FILES = new Set(['HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'index', 'packed-refs']);

/** Whether a change at `rel` (relative to the git dir) can alter status, branch or history. Lock files are noise. */
export function isRelevantEvent(rel: string): boolean {
  const p = rel.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  if (p.endsWith('.lock') || p.split('/').pop()!.startsWith('.watchman-cookie-')) return false;
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
  /** Fires at the latest this long after the first event of a burst, even if events keep coming (default 5000). */
  maxDelayMs?: number;
  watch?: WatchFn;
  /** When set, `onChange` fires only if the snapshot differs from the previous one. */
  fingerprint?: () => Promise<GitFingerprint>;
}

/**
 * Watches a git dir and calls `onChange` once per quiet period of relevant events, or `maxDelayMs` after the
 * first event of a burst that never goes quiet (a long rebase or fetch); returns `stop()`. An event without a
 * file name (the backend lost track) counts as relevant; the fingerprint, when set, drops it if nothing changed.
 */
export function startGitWatch(opts: GitWatchOptions): () => void {
  const wait = opts.debounceMs ?? 1500;
  const maxDelay = Math.max(wait, opts.maxDelayMs ?? 5000);
  const watch = opts.watch ?? (fsWatch as unknown as WatchFn);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt: number | undefined;
  let last: GitFingerprint | undefined;
  let stopped = false;
  const fire = async () => {
    timer = undefined;
    firstAt = undefined;
    if (stopped) return;
    if (opts.fingerprint) {
      let next: GitFingerprint | undefined;
      try {
        next = await opts.fingerprint();
      } catch {
        next = undefined;
      }
      // An unreadable snapshot is a change: better one refresh too many than a stale screen.
      const same = next !== undefined && last !== undefined && fingerprintsEqual(last, next);
      last = next;
      if (same || stopped) return;
    }
    opts.onChange();
  };
  if (opts.fingerprint) void opts.fingerprint().then((f) => (last ??= f), () => undefined);
  const watcher = watch(opts.gitDir, { recursive: true }, (_event, filename) => {
    if (stopped || (filename && !isRelevantEvent(String(filename)))) return;
    const now = Date.now();
    firstAt ??= now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void fire(), Math.max(0, Math.min(wait, firstAt + maxDelay - now)));
  });
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
