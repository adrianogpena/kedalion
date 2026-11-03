export interface RowLike {
  id: number;
  url: string;
  done: boolean;
  startedAt?: number | undefined;
}

export interface NetMark {
  id: number;
  ts: number;
}

export const SLICE_SIZE = 20000;
export const CONSOLE_LINK_MS = 2000;
export const DEFAULT_PENDING_SECS = 10;

/** Seconds a request has been pending, or undefined when it is done or has no start time. */
export function pendingAge(e: RowLike, now: number): number | undefined {
  if (e.done || e.startedAt === undefined) return undefined;
  return Math.max(0, Math.floor((now - e.startedAt) / 1000));
}

export const isStuck = (e: RowLike, now: number, secs: number): boolean => {
  const age = pendingAge(e, now);
  return age !== undefined && age >= secs;
};

export interface RowFilter<E extends RowLike> {
  text: string;
  matchType?: (e: E) => boolean;
  /** Ids whose recorded bodies contain the body search text; null when no body search is active. */
  bodyIds: ReadonlySet<number> | null;
  mark: NetMark | null;
  sinceMark: boolean;
  pendingOnly: boolean;
  now: number;
  pendingSecs: number;
}

export function filterRows<E extends RowLike>(entries: E[], f: RowFilter<E>): E[] {
  const needle = f.text.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (!f.matchType || f.matchType(e)) &&
      (!needle || e.url.toLowerCase().includes(needle)) &&
      (f.bodyIds === null || f.bodyIds.has(e.id)) &&
      (!f.sinceMark || !f.mark || e.id > f.mark.id) &&
      (!f.pendingOnly || pendingAge(e, f.now) !== undefined),
  );
}

export const countSinceMark = (entries: RowLike[], mark: NetMark | null): number => (mark ? entries.filter((e) => e.id > mark.id).length : 0);

export const errorsSinceMark = (entries: { ts: number; level: string }[], mark: NetMark | null): number =>
  mark ? entries.filter((e) => e.level === 'error' && e.ts >= mark.ts).length : 0;

/** Requests that started up to `windowMs` before `ts` (or at it), oldest first. */
export function requestsBefore<E extends RowLike>(entries: E[], ts: number, windowMs = CONSOLE_LINK_MS): E[] {
  return entries.filter((e) => e.startedAt !== undefined && e.startedAt <= ts && ts - e.startedAt <= windowMs);
}

/** Server side: ids of recorded bodies (request or response) that contain the text, case-insensitive. */
export function bodyMatches(rec: { postData?: string; body?: string } | undefined, needle: string, decoded?: string): boolean {
  const n = needle.toLowerCase();
  if (!n || !rec) return false;
  return [rec.postData, decoded, rec.body].some((s) => s !== undefined && s.toLowerCase().includes(n));
}

/** Text split into plain and matching parts for highlighting. */
export function splitMatches(text: string, needle: string, max = 500): { text: string; hit: boolean }[] {
  const n = needle.toLowerCase();
  if (!n) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let from = 0;
  let count = 0;
  while (count < max) {
    const i = lower.indexOf(n, from);
    if (i < 0) break;
    if (i > from) parts.push({ text: text.slice(from, i), hit: false });
    parts.push({ text: text.slice(i, i + n.length), hit: true });
    from = i + n.length;
    count++;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

export interface Slice {
  text: string;
  index: number;
  count: number;
}

/** The `index`-th piece of `size` characters; the index is clamped. */
export function sliceBody(body: string, index: number, size = SLICE_SIZE): Slice {
  const count = Math.max(1, Math.ceil(body.length / size));
  const i = Math.min(Math.max(index, 0), count - 1);
  return { text: body.slice(i * size, (i + 1) * size), index: i, count };
}

/** Lines containing the text with `context` lines around them; separated groups are joined by `--`. */
export function grepLines(body: string, needle: string, context = 2, maxLines = 400): { lines: string[]; matches: number } {
  const n = needle.toLowerCase();
  if (!n) return { lines: [], matches: 0 };
  const all = body.split('\n');
  const hits = all.flatMap((l, i) => (l.toLowerCase().includes(n) ? [i] : []));
  const out: string[] = [];
  let last = -1;
  for (const h of hits) {
    const from = Math.max(h - context, 0);
    const to = Math.min(h + context, all.length - 1);
    if (last >= 0 && from > last + 1) out.push('--');
    for (let i = Math.max(from, last + 1); i <= to; i++) out.push(`${i + 1}: ${all[i]}`);
    last = Math.max(last, to);
    if (out.length >= maxLines) break;
  }
  return { lines: out.slice(0, maxLines), matches: hits.length };
}
