/** One result cell as short text: NULL for null, `<binary N bytes>` for bytes, ISO for dates; cut to `max` characters. */
export function cellText(value: unknown, max: number): string {
  let text: string;
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string') text = value;
  else if (value instanceof Date) text = value.toISOString();
  else if (value instanceof Uint8Array) return `<binary ${value.length} bytes>`;
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  text = text.replace(/[\t\r\n]+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…(+${text.length - max})` : text;
}

/** Header line and one line per row, tab separated: the cheapest table form for a model to read. */
export function tsv(columns: readonly string[], rows: readonly unknown[][], maxCell: number): string {
  return [columns.join('\t'), ...rows.map((r) => r.map((c) => cellText(c, maxCell)).join('\t'))].join('\n');
}

/** The rows as objects keyed by column name, as JSON (cells cut like `cellText` for strings only). */
export function jsonRows(columns: readonly string[], rows: readonly unknown[][], maxCell: number): string {
  const clip = (v: unknown) => (typeof v === 'string' && v.length > maxCell ? `${v.slice(0, maxCell)}…(+${v.length - maxCell})` : v instanceof Uint8Array ? `<binary ${v.length} bytes>` : typeof v === 'bigint' ? String(v) : v);
  return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, clip(r[i])]))));
}

/** The statement without leading whitespace, comments and opening parentheses. */
function stripLead(sql: string): string {
  let s = sql;
  for (;;) {
    const next = s.replace(/^[\s(]+/, '').replace(/^--[^\n]*/, '').replace(/^\/\*[\s\S]*?\*\//, '');
    if (next === s) return s;
    s = next;
  }
}

/** Why `sql` is not a plain read (the reason to show), or undefined when it is a SELECT/WITH without FOR UPDATE. */
export function writeReason(sql: string): string | undefined {
  const lead = stripLead(sql);
  const word = /^[A-Za-z]+/.exec(lead)?.[0]?.toLowerCase() ?? '';
  if (word !== 'select' && word !== 'with') return word ? `${word.toUpperCase()} is not a read` : 'empty statement';
  const bare = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/\bfor\s+update\b/i.test(bare)) return 'SELECT ... FOR UPDATE locks rows';
  return undefined;
}

/** A value of `value` at a path like `$.a.b[0].c` (also `a.b`, `a[0]`); undefined when absent. */
export function jsonPick(value: unknown, path: string): unknown {
  const parts = [...path.replace(/^\$\.?/, '').matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]!));
  let cur: unknown = value;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[part];
  }
  return cur;
}

/** Lines of `text` that contain `needle`, each with `context` lines around it, `--` between groups. */
export function grepLines(text: string, needle: string, context = 1): string {
  const lines = text.split('\n');
  const low = needle.toLowerCase();
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(low)) for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j);
  });
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1 && out.length) out.push('--');
    out.push(lines[i]!);
    last = i;
  }
  return out.join('\n');
}
