import type { GitWorktree } from '@kedalion/server-core';

const norm = (p: string) => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
};

/** Parses `git worktree list --porcelain`: blocks split on blank lines; `current` is the entry equal to `toplevel`. */
export function parseWorktrees(text: string, toplevel: string): GitWorktree[] {
  const top = norm(toplevel);
  const out: GitWorktree[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const wt: GitWorktree = { path: '', head: '', bare: false, detached: false, locked: false, current: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9);
      else if (line.startsWith('HEAD ')) wt.head = line.slice(5);
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'bare') wt.bare = true;
      else if (line === 'detached') wt.detached = true;
      else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true;
    }
    if (!wt.path) continue;
    wt.current = norm(wt.path) === top;
    out.push(wt);
  }
  return out;
}
