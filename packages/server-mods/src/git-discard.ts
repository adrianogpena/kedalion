import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitFile } from '@kedalion/server-core';

/** Command-line budget per git call: Windows caps a command line near 32k chars. */
export const MAX_BATCH_BYTES = 28_000;
export const MAX_BATCH_PATHS = 1024;

/** Splits paths into batches that fit one command line. */
export function batchPaths(paths: readonly string[], maxBytes = MAX_BATCH_BYTES, maxPaths = MAX_BATCH_PATHS): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let bytes = 0;
  for (const p of paths) {
    const size = Buffer.byteLength(p) + 1;
    if (cur.length && (cur.length >= maxPaths || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(p);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The arguments and stdin for `--pathspec-from-file=- --pathspec-file-nul`, for path lists of any length. */
export function pathspecStdin(paths: readonly string[]): { args: string[]; stdin: string } {
  return { args: ['--pathspec-from-file=-', '--pathspec-file-nul'], stdin: paths.map((p) => p + '\0').join('') };
}

export type DiscardStep = 'keepOurs' | 'removeAdded' | 'restoreHead' | 'cleanUntracked' | 'resetSubmodule';

/**
 * The git calls that discard changes to `files`, in the order that cannot fail on an earlier step's output:
 * conflicted files take our side; files added in the index are removed (`rm -f`, index and disk); tracked
 * files go back to HEAD (index and working tree); untracked files and folders are cleaned; submodules
 * (paths in `submodules`) are checked out again at their recorded commit. Each call gets `--` before paths.
 */
export function discardPlan(files: readonly GitFile[], submodules: ReadonlySet<string> = new Set()): { step: DiscardStep; args: string[] }[] {
  const by: Record<DiscardStep, Set<string>> = { keepOurs: new Set(), removeAdded: new Set(), restoreHead: new Set(), cleanUntracked: new Set(), resetSubmodule: new Set() };
  for (const f of files) {
    if (submodules.has(f.path)) by.resetSubmodule.add(f.path);
    else if (f.group === 'conflict') by.keepOurs.add(f.path);
    else if (f.group === 'untracked') by.cleanUntracked.add(f.path);
    else if (f.index === 'A' || f.index === 'C') by.removeAdded.add(f.path);
    else if (f.index === 'R') {
      // The new name is not in HEAD: remove it and bring back the old one.
      by.removeAdded.add(f.path);
      if (f.origPath) by.restoreHead.add(f.origPath);
    } else by.restoreHead.add(f.path);
  }
  const head: Record<DiscardStep, string[]> = {
    keepOurs: ['checkout', '--ours'],
    removeAdded: ['rm', '-f', '-q'],
    restoreHead: ['restore', '--source=HEAD', '--staged', '--worktree'],
    cleanUntracked: ['clean', '-f', '-d', '-q'],
    resetSubmodule: ['submodule', 'update', '--checkout', '--force'],
  };
  const order: DiscardStep[] = ['keepOurs', 'removeAdded', 'restoreHead', 'cleanUntracked', 'resetSubmodule'];
  return order.flatMap((step) => batchPaths([...by[step]]).map((batch) => ({ step, args: [...head[step], '--', ...batch] })));
}

export type CheckoutBlocker = { kind: 'dirAtPath'; path: string } | { kind: 'fileAtParent'; path: string };

const kindAt = async (full: string) => {
  try {
    const s = await lstat(full);
    return s.isDirectory() ? 'dir' : 'file';
  } catch {
    return undefined;
  }
};

/**
 * What stops git from writing `path` (a file in HEAD) back under `root`: a folder now sits at the path, or a
 * file sits where one of its parent folders should be. Checked before a discard so the user gets a clear
 * reason instead of git's error; the disk can still change between this check and the checkout.
 */
export async function checkoutBlocker(root: string, path: string): Promise<CheckoutBlocker | undefined> {
  const parts = path.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    const kind = await kindAt(join(root, parent));
    if (kind === undefined) return undefined;
    if (kind === 'file') return { kind: 'fileAtParent', path: parent };
  }
  return (await kindAt(join(root, path))) === 'dir' ? { kind: 'dirAtPath', path } : undefined;
}

/** The message shown when a discard is blocked. */
export function blockedDiscardMessage(b: CheckoutBlocker): string {
  return b.kind === 'dirAtPath'
    ? `Cannot restore "${b.path}": a folder now exists at that path. Move or delete the folder first.`
    : `Cannot restore a file under "${b.path}": "${b.path}" is now a file, not a folder. Move or delete it first.`;
}
