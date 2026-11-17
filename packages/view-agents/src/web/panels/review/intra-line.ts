import type { DiffLine } from './diff-parse';

/** Half-open UTF-16 range [start, end) inside one line's text. */
export interface Range {
  start: number;
  end: number;
}

/** A styled piece of a line; overlays add class names. */
export interface Span {
  text: string;
  className?: string;
}

const isWord = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Sorts ranges, drops empty ones and merges overlapping or touching ones. */
export function normalizeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Share of the longer line that is common prefix plus suffix below which a pair is not highlighted. */
export const MIN_SIMILARITY = 0.4;

/** Changed ranges of an old/new line pair: common prefix and suffix trimmed, then snapped out to whole words. */
export function intraLinePair(oldText: string, newText: string, minSimilarity = MIN_SIMILARITY): { old: Range[]; new: Range[] } | null {
  if (oldText === newText) return null;
  const max = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  if (p > 0 && isHigh(oldText.charCodeAt(p - 1))) p--;
  let s = 0;
  while (s < max - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
  if (s > 0 && isLow(oldText.charCodeAt(oldText.length - s))) s--;
  const longest = Math.max(oldText.length, newText.length);
  if ((p + s) / longest < minSimilarity) return null;
  const snap = (text: string): Range => {
    let start = p;
    let end = text.length - s;
    while (start > 0 && isWord(text[start - 1]!) && start < text.length && isWord(text[start]!)) start--;
    while (end < text.length && end > 0 && isWord(text[end - 1]!) && isWord(text[end]!)) end++;
    return { start, end };
  };
  const o = snap(oldText);
  const n = snap(newText);
  return { old: normalizeRanges([o]), new: normalizeRanges([n]) };
}

/**
 * Word-level highlight ranges per line index. Each run of deleted lines followed by a run of added
 * lines is paired in order; unpaired lines get none.
 */
export function annotateIntraLineDiff(lines: DiffLine[], minSimilarity = MIN_SIMILARITY): (Range[] | undefined)[] {
  const out: (Range[] | undefined)[] = new Array(lines.length);
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== 'del') {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i]!.kind === 'del') i++;
    const addStart = i;
    while (i < lines.length && lines[i]!.kind === 'add') i++;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const r = intraLinePair(lines[delStart + k]!.text, lines[addStart + k]!.text, minSimilarity);
      if (!r) continue;
      out[delStart + k] = r.old;
      out[addStart + k] = r.new;
    }
  }
  return out;
}

/** Splits spans at the range edges and adds `className` to the covered pieces; ranges are normalised first. */
export function overlayRanges(spans: Span[], ranges: Range[], className: string): Span[] {
  const rs = normalizeRanges(ranges);
  if (!rs.length) return spans;
  const out: Span[] = [];
  let pos = 0;
  let ri = 0;
  for (const span of spans) {
    const end = pos + span.text.length;
    let at = pos;
    while (at < end) {
      while (ri < rs.length && rs[ri]!.end <= at) ri++;
      const r = rs[ri];
      if (!r || r.start >= end) {
        out.push({ ...span, text: span.text.slice(at - pos) });
        at = end;
      } else if (r.start > at) {
        out.push({ ...span, text: span.text.slice(at - pos, r.start - pos) });
        at = r.start;
      } else {
        const to = Math.min(r.end, end);
        const cls = span.className ? `${span.className} ${className}` : className;
        out.push({ ...span, text: span.text.slice(at - pos, to - pos), className: cls });
        at = to;
      }
    }
    pos = end;
  }
  return out;
}

export const applyWordDiffToSpans = (spans: Span[], ranges: Range[]): Span[] => overlayRanges(spans, ranges, 'word-diff');

export const highlightSearchMatches = (spans: Span[], ranges: Range[], current = false): Span[] =>
  overlayRanges(spans, ranges, current ? 'search-match search-current' : 'search-match');

/** Case-insensitive, non-overlapping match offsets of `query` in `text`. */
export function searchOffsets(text: string, query: string): Range[] {
  if (!query) return [];
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const out: Range[] = [];
  for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length });
  return out;
}

export interface SearchMatch extends Range {
  line: number;
}

/** Matches of `query` over all lines, in line then column order. */
export function updateSearchMatches(texts: string[], query: string): SearchMatch[] {
  const out: SearchMatch[] = [];
  texts.forEach((text, line) => {
    for (const r of searchOffsets(text, query)) out.push({ line, ...r });
  });
  return out;
}

/** Next (`delta` 1) or previous (-1) hunk index, wrapping at both ends; `current` null starts from the edge. */
export function gotoHunk(current: number | null, count: number, delta: 1 | -1): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

export interface Focusable {
  kind: 'expand' | 'hunk';
  /** Row the item sits on. */
  row: number;
  id: string;
}

/** Focus ring order: by row, expand buttons before the hunk on the same row. */
export function focusableOrder(items: Focusable[]): Focusable[] {
  const rank = (f: Focusable) => (f.kind === 'expand' ? 0 : 1);
  return items
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.row - b.f.row || rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f);
}

/** Next focus index in a ring of `count`; wraps by default, clamps with `wrap` false. */
export function moveFocus(current: number | null, count: number, delta: number, wrap = true): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0 || current >= count) return delta >= 0 ? 0 : count - 1;
  const next = current + delta;
  return wrap ? ((next % count) + count) % count : Math.max(0, Math.min(count - 1, next));
}

export interface HunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface GapState {
  /** Hunk the gap follows, -1 for the gap before the first hunk. */
  after: number;
  /** Hidden-by-default 1-based inclusive line range, old and new side (from > to when nothing is hidden). */
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
  /** Context lines revealed below the previous hunk and above the next one. */
  top: number;
  bottom: number;
  /** Lines still collapsed. */
  hidden: number;
}

export const GAP_CONTEXT = 3;

const firstLine = (start: number, count: number) => (count === 0 ? start + 1 : start);

/**
 * Collapsed gaps between hunks from their header ranges. Each side of a gap reveals min(3, gap / 2) lines.
 * `oldTotal` adds the trailing gap after the last hunk.
 */
export function computeInitialGapStates(hunks: HunkRange[], oldTotal?: number): GapState[] {
  const out: GapState[] = [];
  const make = (after: number, oldFrom: number, oldTo: number, newFrom: number, leading: boolean, trailing: boolean): void => {
    const gap = oldTo - oldFrom + 1;
    if (gap <= 0) return;
    const side = Math.min(GAP_CONTEXT, Math.floor(gap / 2));
    const top = leading ? 0 : side;
    const bottom = trailing ? 0 : side;
    const hidden = gap - top - bottom;
    out.push({ after, oldFrom: oldFrom + top, oldTo: oldTo - bottom, newFrom: newFrom + top, newTo: newFrom + gap - 1 - bottom, top, bottom, hidden });
  };
  hunks.forEach((h, i) => {
    const prevEndOld = i === 0 ? 1 : firstLine(hunks[i - 1]!.oldStart, hunks[i - 1]!.oldCount) + hunks[i - 1]!.oldCount;
    const prevEndNew = i === 0 ? 1 : firstLine(hunks[i - 1]!.newStart, hunks[i - 1]!.newCount) + hunks[i - 1]!.newCount;
    const startOld = firstLine(h.oldStart, h.oldCount);
    make(i - 1, prevEndOld, startOld - 1, prevEndNew, i === 0, false);
  });
  const last = hunks[hunks.length - 1];
  if (last && oldTotal !== undefined) {
    const from = firstLine(last.oldStart, last.oldCount) + last.oldCount;
    const newFrom = firstLine(last.newStart, last.newCount) + last.newCount;
    make(hunks.length - 1, from, oldTotal, newFrom, false, true);
  }
  return out;
}
