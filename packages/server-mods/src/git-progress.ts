export interface GitProgress {
  /** The phase, e.g. `Receiving objects`. */
  title: string;
  percent?: number;
  current?: number;
  total?: number;
  /** The line came from the remote side (`remote:` prefix). */
  remote: boolean;
}

const LINE = /^([A-Za-z][A-Za-z ]{0,79}):\s+(?:(\d{1,3})%\s*(?:\((\d+)\/(\d+)\))?|(\d+))(?:[,\s].*)?$/;

/** One progress line, e.g. `Receiving objects:  45% (9/20), 1.2 MiB | 2 MiB/s` or `remote: Counting objects: 12`. */
export function parseProgressLine(line: string): GitProgress | undefined {
  let s = line.trim();
  const remote = /^remote:\s*/.test(s);
  if (remote) s = s.replace(/^remote:\s*/, '');
  const m = LINE.exec(s);
  if (!m) return undefined;
  const out: GitProgress = { title: m[1]!.trim(), remote };
  if (m[2] !== undefined) out.percent = Math.min(100, Number(m[2]));
  if (m[3] !== undefined) {
    out.current = Number(m[3]);
    out.total = Number(m[4]);
  }
  if (m[5] !== undefined) out.current = Number(m[5]);
  return out;
}

/**
 * The newest progress in a chunk of `git ... --progress` stderr. Git redraws a line with `\r`, so the chunk is
 * split on `\r` and `\n`, and the last fragment that parses wins; a trailing fragment cut mid-line is skipped.
 */
export function latestProgress(chunk: string): GitProgress | undefined {
  const parts = chunk.split(/[\r\n]/);
  const complete = /[\r\n]$/.test(chunk) ? parts : parts.slice(0, -1);
  for (let i = complete.length - 1; i >= 0; i--) {
    const p = parseProgressLine(complete[i]!);
    if (p) return p;
  }
  return undefined;
}
