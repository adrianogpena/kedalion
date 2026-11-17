import type { GitBlameLine } from '@kedalion/server-core';

const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/;
const ZERO = /^0+$/;

interface Meta {
  author: string;
  time: number;
  summary: string;
  previous?: string;
}

/**
 * Parses `git blame --porcelain`: metadata appears once per commit, then is reused for later lines of it.
 * `path` is the requested path; a `filename` line that differs from it marks the line's path before a rename.
 */
export function parseBlame(text: string, path?: string): GitBlameLine[] {
  const meta = new Map<string, Meta>();
  const out: GitBlameLine[] = [];
  let sha = '';
  let line = 0;
  // Per header group, not per commit: one commit can touch a file under two names.
  let filename: string | undefined;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('\t')) {
      const m = meta.get(sha);
      out.push({
        line,
        sha,
        author: m?.author ?? '',
        time: m?.time ?? 0,
        summary: m?.summary ?? '',
        text: raw.slice(1).replace(/\r$/, ''),
        ...(ZERO.test(sha) && { uncommitted: true }),
        ...(m?.previous && { previous: m.previous }),
        ...(path !== undefined && filename !== undefined && filename !== path && { origPath: filename }),
      });
      continue;
    }
    const h = HEADER.exec(raw);
    if (h) {
      sha = h[1]!;
      line = Number(h[2]);
      if (!meta.has(sha)) meta.set(sha, { author: '', time: 0, summary: '' });
      continue;
    }
    const value = raw.replace(/\r$/, '');
    if (value.startsWith('filename ')) filename = value.slice(9);
    const m = meta.get(sha);
    if (!m) continue;
    if (value.startsWith('author ')) m.author = value.slice(7);
    else if (value.startsWith('author-time ')) m.time = Number(value.slice(12)) || 0;
    else if (value.startsWith('summary ')) m.summary = value.slice(8);
    else if (value.startsWith('previous ')) m.previous = value.slice(9).split(' ')[0];
  }
  return out;
}

/** Blame for a file git does not track: every line is uncommitted. */
export function uncommittedBlame(text: string): GitBlameLine[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const sha = '0'.repeat(40);
  return lines.map((l, i) => ({ line: i + 1, sha, author: '', time: 0, summary: '', text: l.replace(/\r$/, ''), uncommitted: true }));
}
