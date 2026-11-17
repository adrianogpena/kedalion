import type { GitWorktree } from '@kedalion/server-core';

const norm = (p: string) => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
};

/**
 * Arguments for `git worktree add`: `--` before the user's path so it is never an option; a ref that looks
 * like an option is rejected (undefined).
 */
export function worktreeAddArgs(path: string, ref?: string, newBranch?: string): string[] | undefined {
  if (!path || (ref !== undefined && (!ref || ref.startsWith('-'))) || (newBranch !== undefined && (!newBranch || newBranch.startsWith('-')))) return undefined;
  return ['worktree', 'add', ...(newBranch !== undefined ? ['-b', newBranch] : []), '--', path, ...(ref !== undefined ? [ref] : [])];
}

/** Entries as lists of fields: `-z` output (fields end in NUL, an empty field ends an entry), else text split on blank lines. */
function entriesOf(text: string): string[][] {
  if (text.includes('\0')) {
    const out: string[][] = [[]];
    for (const field of text.split('\0')) {
      if (field) out[out.length - 1]!.push(field);
      else if (out[out.length - 1]!.length) out.push([]);
    }
    return out;
  }
  return text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/));
}

/**
 * Parses `git worktree list --porcelain [-z]`; `-z` keeps paths with newlines exact. A `worktree` field
 * also starts a new entry, so a missing separator cannot merge two. `current` is the entry equal to `toplevel`.
 */
export function parseWorktrees(text: string, toplevel: string): GitWorktree[] {
  const top = norm(toplevel);
  const out: GitWorktree[] = [];
  const push = (wt: GitWorktree) => {
    if (!wt.path) return;
    wt.current = norm(wt.path) === top;
    out.push(wt);
  };
  const blank = (): GitWorktree => ({ path: '', head: '', bare: false, detached: false, locked: false, current: false });
  for (const fields of entriesOf(text)) {
    let wt = blank();
    for (const line of fields) {
      if (line.startsWith('worktree ')) {
        push(wt);
        wt = blank();
        wt.path = line.slice(9);
      } else if (line.startsWith('HEAD ')) wt.head = line.slice(5);
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'bare') wt.bare = true;
      else if (line === 'detached') {
        wt.detached = true;
        delete wt.branch;
      } else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true;
    }
    push(wt);
  }
  return out;
}
