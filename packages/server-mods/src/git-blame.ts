import type { GitBlameLine } from '@kedalion/server-core';

const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/;

/** Parses `git blame --porcelain`: metadata appears once per commit, then is reused for later lines of it. */
export function parseBlame(text: string): GitBlameLine[] {
  const meta = new Map<string, { author: string; time: number; summary: string }>();
  const out: GitBlameLine[] = [];
  let sha = '';
  let line = 0;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('\t')) {
      const m = meta.get(sha);
      out.push({ line, sha, author: m?.author ?? '', time: m?.time ?? 0, summary: m?.summary ?? '', text: raw.slice(1).replace(/\r$/, '') });
      continue;
    }
    const h = HEADER.exec(raw);
    if (h) {
      sha = h[1]!;
      line = Number(h[2]);
      if (!meta.has(sha)) meta.set(sha, { author: '', time: 0, summary: '' });
      continue;
    }
    const m = meta.get(sha);
    if (!m) continue;
    if (raw.startsWith('author ')) m.author = raw.slice(7);
    else if (raw.startsWith('author-time ')) m.time = Number(raw.slice(12)) || 0;
    else if (raw.startsWith('summary ')) m.summary = raw.slice(8);
  }
  return out;
}
