import { renderConflicts, type ConflictResolution, type ConflictSegment, type Segment } from './git-conflict.ts';

/** Why a conflict was resolved automatically; shown next to the hunk. */
export type AutoRule = 'identical' | 'oursOnly' | 'theirsOnly' | 'perLine' | 'whitespace';

export interface AutoPick {
  rule: AutoRule;
  resolution: ConflictResolution;
  /** The text for a `merged` resolution. */
  merged?: string;
}

export interface AutoOptions {
  /**
   * Also resolve hunks whose sides differ only in whitespace, keeping ours. Off by default: indentation
   * can carry meaning (Python, YAML, Makefiles), so only an explicit action should turn it on.
   */
  whitespace?: boolean;
}

const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** True when the two texts differ, but only in whitespace. */
export const isWhitespaceOnlyDiff = (a: string, b: string) => a !== b && a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

/**
 * Per-line 3-way merge of sides with the same number of lines as the base: each line takes the side that
 * changed it. Undefined when the counts differ or one line was changed differently on both sides.
 */
export function perLineMerge(base: string, ours: string, theirs: string): string | undefined {
  const b = lines(base);
  const o = lines(ours);
  const t = lines(theirs);
  if (o.length !== b.length || t.length !== b.length) return undefined;
  let out = '';
  for (let i = 0; i < b.length; i++) {
    if (o[i] === t[i] || t[i] === b[i]) out += o[i];
    else if (o[i] === b[i]) out += t[i];
    else return undefined;
  }
  return out;
}

/**
 * The safe pick for one conflict, tried in order: both sides equal; only one side changed from the base;
 * a line-by-line merge; (opt-in) a whitespace-only difference. Undefined when a person must decide.
 */
export function autoResolvePick(s: ConflictSegment, options: AutoOptions = {}): AutoPick | undefined {
  if (s.ours === s.theirs) return { rule: 'identical', resolution: 'ours' };
  if (s.base !== undefined) {
    if (s.theirs === s.base) return { rule: 'oursOnly', resolution: 'ours' };
    if (s.ours === s.base) return { rule: 'theirsOnly', resolution: 'theirs' };
    const merged = perLineMerge(s.base, s.ours, s.theirs);
    if (merged !== undefined) return { rule: 'perLine', resolution: 'merged', merged };
  }
  if (options.whitespace && isWhitespaceOnlyDiff(s.ours, s.theirs)) return { rule: 'whitespace', resolution: 'ours' };
  return undefined;
}

export interface AutoResult {
  segments: Segment[];
  /** Index among conflicts and the rule, for each hunk resolved here. */
  applied: { index: number; rule: AutoRule }[];
}

/** Resolves every still unresolved conflict that has a safe pick; the others are left alone. */
export function autoResolve(segments: Segment[], options: AutoOptions = {}): AutoResult {
  const applied: AutoResult['applied'] = [];
  let k = -1;
  const out = segments.map((s): Segment => {
    if (s.kind !== 'conflict') return s;
    k++;
    if (s.resolution !== 'unresolved') return s;
    const pick = autoResolvePick(s, options);
    if (!pick) return s;
    applied.push({ index: k, rule: pick.rule });
    return pick.merged !== undefined ? { ...s, resolution: 'merged', merged: pick.merged } : { ...s, resolution: pick.resolution };
  });
  return { segments: out, applied };
}

/**
 * The resolution an edited hunk text corresponds to: a side, both sides in either order, or the base when it
 * equals one; else `merged` (a manual edit). Sides that are equal resolve to the first in that order.
 */
export function resolutionForText(s: ConflictSegment, text: string): { resolution: ConflictResolution; merged?: string } {
  const candidates: ConflictResolution[] = ['ours', 'theirs', 'both', 'bothReverse', ...(s.base !== undefined ? (['base'] as const) : [])];
  for (const resolution of candidates) {
    if (renderConflicts([{ ...s, resolution }]) === text) return { resolution };
  }
  return { resolution: 'merged', merged: text };
}

/** Whether a file's text still holds a conflict start marker; reads at most `maxChars`. */
export function hasConflictMarkers(text: string, maxChars = 4_000_000): boolean {
  return /(^|\n)<{7}(?:[ \r\n]|$)/.test(text.length > maxChars ? text.slice(0, maxChars) : text);
}
