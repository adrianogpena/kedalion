// Query grammar adapted from filebrowser (https://github.com/gtsteffaniak/filebrowser,
// backend/pkg/indexing/iteminfo/searchQuery.go), Copyright the filebrowser authors, Apache-2.0.
// Changes: rewritten in TypeScript; size units (b/kb/mb/gb) and relative ages; `case:exact` compares
// the terms as typed (the original lower-cased them and never matched); filters parse as whole tokens only.

/** Extension groups for `type:`; `file` and `dir` go by the entry kind. */
const TYPE_EXTENSIONS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'avif', 'heic'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'm4v', 'flv'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'],
  doc: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'],
};
const TYPES = new Set(['file', 'dir', ...Object.keys(TYPE_EXTENSIONS)]);
const TYPE_ALIASES: Record<string, string> = { folder: 'dir', document: 'doc', pic: 'image', picture: 'image' };

const UNITS: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 };
const AGES: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
const FILTER = /^(type|case|larger|largerthan|smaller|smallerthan|newer|newerthan|older|olderthan)[:=](.+)$/i;

export interface SearchQuery {
  /** Alternatives (`|`); a name or line matches when every term of one alternative is in it. Empty: every name matches. */
  any: string[][];
  /** `case:exact`: terms compare as typed. */
  exact: boolean;
  /** `type:` values (any of them). */
  types: string[];
  /** Bytes, from `larger:` / `smaller:`; only files have a size. */
  minSize?: number;
  maxSize?: number;
  /** Epoch ms bounds on the modification time, from `newer:` / `older:`. */
  after?: number;
  before?: number;
}

/** Splits on spaces, keeping `"quoted phrases"` together. */
function tokens(q: string): Array<{ text: string; quoted: boolean }> {
  const out: Array<{ text: string; quoted: boolean }> = [];
  for (const m of q.matchAll(/"([^"]*)"?|(\S+)/g)) {
    if (m[1] !== undefined) out.push({ text: m[1], quoted: true });
    else out.push({ text: m[2]!, quoted: false });
  }
  return out;
}

/** `10mb`, `512k`, `2` (MB, as in the original). */
function size(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([a-z]*)$/i.exec(value);
  const unit = m ? UNITS[(m[2] || 'mb').toLowerCase()] : undefined;
  return m && unit ? Math.round(Number(m[1]) * unit) : undefined;
}

/** `2026-01-31` (start of that UTC day), `7d` / `12h` / `2w` (that long before `now`), or a plain number of days. */
function time(value: string, now: number): number | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(`${value}T00:00:00Z`);
    return Number.isNaN(ms) ? undefined : ms;
  }
  const m = /^(\d+(?:\.\d+)?)([hdw]?)$/i.exec(value);
  return m ? now - Number(m[1]) * AGES[(m[2] || 'd').toLowerCase()]! : undefined;
}

/**
 * Parses a search box query: free terms (all must match), `"quoted phrases"`, `|` between alternatives,
 * and the filters `type:file|dir|image|video|audio|archive|doc`, `case:exact`, `larger:10mb`, `smaller:1gb`,
 * `newer:7d`, `older:2026-01-31` (`largerThan=` style also works). A token that isn't a valid filter is a term.
 */
export function parseSearchQuery(q: string, now = Date.now()): SearchQuery {
  const query: SearchQuery = { any: [], exact: false, types: [] };
  let current: string[] = [];
  const close = () => {
    if (current.length) query.any.push(current);
    current = [];
  };
  for (const tok of tokens(q)) {
    if (tok.quoted) {
      if (tok.text) current.push(tok.text);
      continue;
    }
    const m = FILTER.exec(tok.text);
    if (m) {
      const key = m[1]!.toLowerCase().replace(/than$/, '');
      const value = m[2]!;
      const lower = value.toLowerCase();
      if (key === 'case' && lower === 'exact') {
        query.exact = true;
        continue;
      }
      if (key === 'type') {
        const types = lower.split(/[|,]/).map((x) => TYPE_ALIASES[x] ?? x);
        if (types.every((x) => TYPES.has(x))) {
          query.types.push(...types);
          continue;
        }
      }
      const n = key === 'larger' || key === 'smaller' ? size(value) : key === 'newer' || key === 'older' ? time(value, now) : undefined;
      if (n !== undefined) {
        if (key === 'larger') query.minSize = n;
        else if (key === 'smaller') query.maxSize = n;
        else if (key === 'newer') query.after = n;
        else query.before = n;
        continue;
      }
    }
    tok.text.split('|').forEach((part, i) => {
      if (i > 0) close();
      if (part) current.push(part);
    });
  }
  close();
  return query;
}

const fold = (q: SearchQuery, s: string) => (q.exact ? s : s.toLowerCase());

/** Where the first term of the first matching alternative sits in `text`, or -1; 0 when there are no terms. */
export function matchAt(q: SearchQuery, text: string): number {
  if (!q.any.length) return 0;
  const hay = fold(q, text);
  for (const alt of q.any) {
    const at = alt.map((term) => hay.indexOf(fold(q, term)));
    if (at.every((i) => i >= 0)) return at[0]!;
  }
  return -1;
}

/** The `type:` filter on a name and kind (no IO). */
export function typeMatches(q: SearchQuery, name: string, kind: 'file' | 'dir'): boolean {
  if (!q.types.length) return true;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return q.types.some((type) => (type === 'file' || type === 'dir' ? type === kind : kind === 'file' && TYPE_EXTENSIONS[type]!.includes(ext)));
}

/** True when the size or date filters need a `stat` of the entry. */
export const needsStat = (q: SearchQuery) => q.minSize !== undefined || q.maxSize !== undefined || q.after !== undefined || q.before !== undefined;

/** The size and date filters on a stat result. */
export function statMatches(q: SearchQuery, s: { size: number; mtimeMs: number }, kind: 'file' | 'dir'): boolean {
  if ((q.minSize !== undefined || q.maxSize !== undefined) && kind !== 'file') return false;
  if (q.minSize !== undefined && s.size < q.minSize) return false;
  if (q.maxSize !== undefined && s.size > q.maxSize) return false;
  if (q.after !== undefined && s.mtimeMs < q.after) return false;
  if (q.before !== undefined && s.mtimeMs >= q.before) return false;
  return true;
}
