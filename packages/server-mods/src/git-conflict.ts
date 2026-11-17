/** `base` needs diff3 markers; `merged` carries its own text (an automatic per-line merge or a manual edit). */
export type ConflictResolution = 'unresolved' | 'ours' | 'theirs' | 'both' | 'bothReverse' | 'base' | 'merged';

export interface TextSegment {
  kind: 'text';
  text: string;
}

export interface ConflictSegment {
  kind: 'conflict';
  ours: string;
  /** The common ancestor, only in diff3 style (`|||||||`). */
  base?: string;
  theirs: string;
  resolution: ConflictResolution;
  /** The text of a `merged` resolution. */
  merged?: string;
  /** The marker lines as written (with their line endings), so an unresolved hunk renders unchanged. */
  markers: { start: string; base?: string; sep: string; end: string };
}

export type Segment = TextSegment | ConflictSegment;

const isMarker = (line: string, ch: string) => line.startsWith(ch.repeat(7)) && (line.length === 7 || /^[ \r\n]/.test(line[7]!));
const linesOf = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Closes a line so that two sides can be concatenated. */
function terminated(text: string, like: string): string {
  if (!text || text.endsWith('\n')) return text;
  return text + (like.endsWith('\r\n') ? '\r\n' : '\n');
}

/** Parses text with conflict markers. An unterminated conflict stays text; the rest of the file is never dropped. */
export function parseConflicts(text: string): Segment[] {
  const lines = linesOf(text);
  const segments: Segment[] = [];
  let plain = '';
  const flush = () => {
    if (plain) segments.push({ kind: 'text', text: plain });
    plain = '';
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!isMarker(line, '<')) {
      plain += line;
      i++;
      continue;
    }
    let j = i + 1;
    const ours: string[] = [];
    const base: string[] = [];
    const theirs: string[] = [];
    let baseMarker: string | undefined;
    let sep: string | undefined;
    let end: string | undefined;
    let part: 'ours' | 'base' | 'theirs' = 'ours';
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (isMarker(l, '<')) break;
      if (part === 'ours' && isMarker(l, '|')) {
        baseMarker = l;
        part = 'base';
      } else if (part !== 'theirs' && isMarker(l, '=')) {
        sep = l;
        part = 'theirs';
      } else if (part === 'theirs' && isMarker(l, '>')) {
        end = l;
        break;
      } else (part === 'ours' ? ours : part === 'base' ? base : theirs).push(l);
    }
    if (sep === undefined || end === undefined) {
      plain += line;
      i++;
      continue;
    }
    flush();
    segments.push({
      kind: 'conflict',
      ours: ours.join(''),
      ...(baseMarker !== undefined && { base: base.join('') }),
      theirs: theirs.join(''),
      resolution: 'unresolved',
      markers: { start: line, ...(baseMarker !== undefined && { base: baseMarker }), sep, end },
    });
    i = j + 1;
  }
  flush();
  return segments;
}

export const conflictCount = (segments: Segment[]) => segments.filter((s) => s.kind === 'conflict').length;
export const unresolvedCount = (segments: Segment[]) => segments.filter((s) => s.kind === 'conflict' && s.resolution === 'unresolved').length;

/** `s` with `resolution`; `base` without a base (not diff3) and `merged` without text stay unresolved. */
function withResolution(s: ConflictSegment, resolution: ConflictResolution, merged?: string): ConflictSegment {
  if ((resolution === 'base' && s.base === undefined) || (resolution === 'merged' && merged === undefined)) return { ...s, resolution: 'unresolved' };
  const { merged: _old, ...rest } = s;
  return resolution === 'merged' ? { ...rest, resolution, merged } : { ...rest, resolution };
}

/** A copy with the n-th conflict (0-based, among conflicts) resolved; `merged` is the text for `merged`. */
export function resolveConflict(segments: Segment[], n: number, resolution: ConflictResolution, merged?: string): Segment[] {
  let k = -1;
  return segments.map((s) => (s.kind === 'conflict' && ++k === n ? withResolution(s, resolution, merged) : s));
}

export function resolveAll(segments: Segment[], resolution: ConflictResolution): Segment[] {
  return segments.map((s) => (s.kind === 'conflict' ? withResolution(s, resolution) : s));
}

export type ConflictKind = 'bothDeleted' | 'addedByUs' | 'deletedByThem' | 'addedByThem' | 'deletedByUs' | 'bothAdded' | 'bothModified';

/** The kind of an unmerged path from the index stages it has (1 base, 2 ours, 3 theirs). */
export function conflictKindOf(stages: Iterable<number>): ConflictKind | undefined {
  const has = new Set(stages);
  const mask = (has.has(1) ? 1 : 0) | (has.has(2) ? 2 : 0) | (has.has(3) ? 4 : 0);
  const kinds: (ConflictKind | undefined)[] = [undefined, 'bothDeleted', 'addedByUs', 'deletedByThem', 'addedByThem', 'deletedByUs', 'bothAdded', 'bothModified'];
  return kinds[mask];
}

/** The stages of each path in `git ls-files -u -z` output (`<mode> <sha> <stage>\t<path>` records). */
export function parseUnmergedStages(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const record of text.split('\0')) {
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(record);
    if (!m) continue;
    const list = out.get(m[2]!) ?? [];
    list.push(Number(m[1]));
    out.set(m[2]!, list);
  }
  return out;
}

function renderConflict(s: ConflictSegment): string {
  const like = s.markers.start;
  switch (s.resolution) {
    case 'ours':
      return s.ours;
    case 'theirs':
      return s.theirs;
    case 'both':
      return terminated(s.ours, like) + s.theirs;
    case 'bothReverse':
      return terminated(s.theirs, like) + s.ours;
    case 'base':
      if (s.base !== undefined) return s.base;
      break;
    case 'merged':
      if (s.merged !== undefined) return s.merged;
      break;
  }
  return s.markers.start + terminated(s.ours, like) + (s.markers.base !== undefined ? s.markers.base + terminated(s.base ?? '', like) : '') + s.markers.sep + terminated(s.theirs, like) + s.markers.end;
}

/** The file text; with every hunk unresolved it equals the parsed input. */
export function renderConflicts(segments: Segment[]): string {
  return segments.map((s) => (s.kind === 'text' ? s.text : renderConflict(s))).join('');
}
