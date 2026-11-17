import { renderConflicts, type ConflictSegment, type Segment } from './git-conflict.ts';

/** A conflict's place in the file: its index among conflicts and its first and last line (1-based, markers included). */
export interface ConflictRange {
  index: number;
  start: number;
  end: number;
}

const lineCount = (text: string) => (text.match(/\n/g) ?? []).length;

/** The line ranges of the conflicts in the text `renderConflicts` gives for these segments. */
export function conflictRanges(segments: Segment[]): ConflictRange[] {
  const out: ConflictRange[] = [];
  let line = 1;
  let k = -1;
  for (const s of segments) {
    const text = renderConflicts([s]);
    const n = lineCount(text);
    if (s.kind === 'conflict') {
      k++;
      out.push({ index: k, start: line, end: line + Math.max(0, n - (text.endsWith('\n') ? 1 : 0)) });
    }
    line += n;
  }
  return out;
}

/** The conflict whose range holds `line` (binary search over sorted ranges), else undefined. */
export function conflictIndexForLine(ranges: ConflictRange[], line: number): number | undefined {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (line < r.start) hi = mid - 1;
    else if (line > r.end) lo = mid + 1;
    else return r.index;
  }
  return undefined;
}

const conflictsOf = (segments: Segment[]) => segments.filter((s): s is ConflictSegment => s.kind === 'conflict');

/**
 * The next (`dir` 1) or previous (-1) conflict from `current`, wrapping; with `unresolvedOnly`, resolved
 * hunks are skipped. When the only target is `current` itself it is returned, so the arrows keep working
 * with one conflict left; undefined when there is none.
 */
export function stepConflict(segments: Segment[], current: number | undefined, dir: 1 | -1, unresolvedOnly = false): number | undefined {
  const all = conflictsOf(segments);
  const targets = all.map((s, i) => (!unresolvedOnly || s.resolution === 'unresolved' ? i : -1)).filter((i) => i >= 0);
  if (!targets.length) return undefined;
  if (current === undefined) return dir > 0 ? targets[0] : targets[targets.length - 1];
  if (dir > 0) return targets.find((i) => i > current) ?? targets[0];
  return [...targets].reverse().find((i) => i < current) ?? targets[targets.length - 1];
}

/**
 * Keeps the conflict cursor on the same hunk after the file is parsed again (after a save or an external
 * change): the first conflict with the same sides, searching outward from the old position; else the
 * nearest by order (clamped); undefined when no conflict is left.
 */
export function reconcileConflictIndex(before: Segment[], after: Segment[], index: number | undefined): number | undefined {
  const next = conflictsOf(after);
  if (!next.length) return undefined;
  if (index === undefined) return undefined;
  const old = conflictsOf(before)[index];
  if (old) {
    const same = (s: ConflictSegment) => s.ours === old.ours && s.theirs === old.theirs && s.base === old.base;
    for (let d = 0; d < next.length; d++) {
      if (index - d >= 0 && index - d < next.length && same(next[index - d]!)) return index - d;
      if (d && index + d < next.length && same(next[index + d]!)) return index + d;
    }
  }
  return Math.min(index, next.length - 1);
}
