import type { HttpResponseInfo } from '@kedalion/server-core/protocol';

export interface ResponseDiff {
  status: { from: number; to: number; changed: boolean };
  time: { from: number; to: number; delta: number };
  size: { from: number; to: number };
  headers: { added: [string, string][]; removed: [string, string][]; changed: [name: string, from: string, to: string][] };
  /** Undefined when either side has no text. */
  body?: { lines: { kind: 'same' | 'add' | 'del'; text: string }[]; partial: boolean };
  /** Nothing differs (timing ignored). */
  same: boolean;
}

type Line = { kind: 'same' | 'add' | 'del'; text: string };

/** Per side; larger bodies get a plain removed/added listing. */
const MAX_LINES = 2000;

function prettyJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return undefined;
  }
}

function headerMap(headers: Array<[string, string]>): Map<string, [string, string]> {
  const map = new Map<string, [string, string]>();
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    const prev = map.get(key);
    map.set(key, prev ? [prev[0], `${prev[1]}, ${value}`] : [name, value]);
  }
  return map;
}

function lineDiff(a: string[], b: string[]): Line[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: Line[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i]! });
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i]! });
      i++;
      j++;
    } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) {
      out.push({ kind: 'del', text: x[i++]! });
    } else {
      out.push({ kind: 'add', text: y[j++]! });
    }
  }
  while (i < n) out.push({ kind: 'del', text: x[i++]! });
  while (j < m) out.push({ kind: 'add', text: y[j++]! });
  for (let k = endA; k < a.length; k++) out.push({ kind: 'same', text: a[k]! });
  return out;
}

function diffBody(base: HttpResponseInfo, live: HttpResponseInfo): ResponseDiff['body'] {
  if (base.text === undefined || live.text === undefined) return undefined;
  let a = base.text;
  let b = live.text;
  if (/json/i.test(base.contentType) && /json/i.test(live.contentType)) {
    const pa = prettyJson(a);
    const pb = prettyJson(b);
    if (pa !== undefined && pb !== undefined) {
      a = pa;
      b = pb;
    }
  }
  const partial = base.truncated || live.truncated;
  const la = a === '' ? [] : a.split(/\r?\n/);
  const lb = b === '' ? [] : b.split(/\r?\n/);
  if (la.length > MAX_LINES || lb.length > MAX_LINES) {
    const lines: Line[] = [...la.map((text): Line => ({ kind: 'del', text })), ...lb.map((text): Line => ({ kind: 'add', text }))];
    return { lines, partial: true };
  }
  return { lines: lineDiff(la, lb), partial };
}

export function diffResponses(base: HttpResponseInfo, live: HttpResponseInfo): ResponseDiff {
  const hb = headerMap(base.headers);
  const hl = headerMap(live.headers);
  const added: [string, string][] = [];
  const removed: [string, string][] = [];
  const changed: [string, string, string][] = [];
  for (const [key, [name, value]] of hl) {
    const old = hb.get(key);
    if (!old) added.push([name, value]);
    else if (old[1] !== value) changed.push([name, old[1], value]);
  }
  for (const [key, [name, value]] of hb) if (!hl.has(key)) removed.push([name, value]);

  const body = diffBody(base, live);
  const statusChanged = base.status !== live.status;
  const bodySame = !body || body.lines.every((l) => l.kind === 'same');
  return {
    status: { from: base.status, to: live.status, changed: statusChanged },
    time: { from: base.totalMs, to: live.totalMs, delta: live.totalMs - base.totalMs },
    size: { from: base.size, to: live.size },
    headers: { added, removed, changed },
    body,
    same: !statusChanged && !added.length && !removed.length && !changed.length && bodySame && (body ? true : base.size === live.size),
  };
}
