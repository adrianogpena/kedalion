// 'dossier' icon set: the original 24x24 stroke paths redrawn in ink. Every path is made absolute,
// moved through a smooth per-icon displacement field (points that meet keep meeting), straight
// lines get a slight bow and circles a slight squash, so the set reads hand-drawn but keeps the
// original's grid and meaning. Plain data, computed once when the set module loads.

type Pt = [number, number];

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g;

/** Deterministic 0..1 value from a string. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

const n = (v: number) => String(Math.round(v * 100) / 100);

/** `d` with the ink treatment; `seed` (the icon name) varies the wobble per icon. Unparseable input comes back unchanged. */
export function inkPath(d: string, seed: string): string {
  const tokens = d.match(TOKEN) ?? [];
  const s = hash(seed) * Math.PI * 2;
  const amp = 0.2;
  const field = ([x, y]: Pt): Pt => [x + amp * Math.sin(1.7 * x + 2.3 * y + s), y + amp * Math.cos(2.1 * x - 1.3 * y + s)];
  const out: string[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let inkCur: Pt = [0, 0];
  let inkStart: Pt = [0, 0];
  let lastC: Pt | null = null;
  let lastQ: Pt | null = null;
  let seg = 0;
  let i = 0;
  let cmd = '';
  // Endpoint in ink space; tiny moves (dots like `h.01`) keep their exact offset so dots stay dots.
  const end = (p: Pt): Pt => (Math.hypot(p[0] - cur[0], p[1] - cur[1]) < 0.05 ? [inkCur[0] + p[0] - cur[0], inkCur[1] + p[1] - cur[1]] : field(p));
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[a-z]/i.test(t)) { cmd = t; i++; if (cmd.toUpperCase() !== 'Z') continue; }
    else if (!cmd) return d;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const k = ARITY[up]!;
    const a = tokens.slice(i, i + k).map(Number);
    if (a.length < k || a.some((v) => Number.isNaN(v))) return d;
    i += k;
    const P = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    seg++;
    if (up === 'Z') {
      out.push('Z');
      cur = start; inkCur = inkStart; lastC = lastQ = null;
      cmd = '';
      continue;
    }
    if (up === 'M') {
      const p = P(a[0]!, a[1]!);
      cur = start = p; inkCur = inkStart = field(p);
      out.push(`M${n(inkCur[0])} ${n(inkCur[1])}`);
      lastC = lastQ = null;
      cmd = rel ? 'l' : 'L';
      continue;
    }
    let p: Pt;
    if (up === 'L' || up === 'H' || up === 'V') {
      p = up === 'H' ? [rel ? cur[0] + a[0]! : a[0]!, cur[1]] : up === 'V' ? [cur[0], rel ? cur[1] + a[0]! : a[0]!] : P(a[0]!, a[1]!);
      const e = end(p);
      const len = Math.hypot(e[0] - inkCur[0], e[1] - inkCur[1]);
      if (len >= 2) {
        const bow = Math.min(len * 0.025, 0.35) * (hash(`${seed}:${seg}`) < 0.5 ? -1 : 1);
        const mx = (inkCur[0] + e[0]) / 2 - ((e[1] - inkCur[1]) / len) * bow;
        const my = (inkCur[1] + e[1]) / 2 + ((e[0] - inkCur[0]) / len) * bow;
        out.push(`Q${n(mx)} ${n(my)} ${n(e[0])} ${n(e[1])}`);
      } else out.push(`L${n(e[0])} ${n(e[1])}`);
      inkCur = e; lastC = lastQ = null;
    } else if (up === 'C' || up === 'S') {
      const c1: Pt = up === 'C' ? P(a[0]!, a[1]!) : lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur;
      const c2 = up === 'C' ? P(a[2]!, a[3]!) : P(a[0]!, a[1]!);
      p = up === 'C' ? P(a[4]!, a[5]!) : P(a[2]!, a[3]!);
      const tiny = Math.hypot(p[0] - cur[0], p[1] - cur[1]) < 0.05;
      const e = end(p);
      const [k1, k2] = tiny ? [c1, c2].map((c) => [inkCur[0] + c[0] - cur[0], inkCur[1] + c[1] - cur[1]] as Pt) : [field(c1), field(c2)];
      out.push(`C${n(k1![0])} ${n(k1![1])} ${n(k2![0])} ${n(k2![1])} ${n(e[0])} ${n(e[1])}`);
      inkCur = e; lastC = c2; lastQ = null;
    } else if (up === 'Q' || up === 'T') {
      const c: Pt = up === 'Q' ? P(a[0]!, a[1]!) : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur;
      p = up === 'Q' ? P(a[2]!, a[3]!) : P(a[0]!, a[1]!);
      const e = end(p);
      const kc = field(c);
      out.push(`Q${n(kc[0])} ${n(kc[1])} ${n(e[0])} ${n(e[1])}`);
      inkCur = e; lastQ = c; lastC = null;
    } else {
      p = P(a[5]!, a[6]!);
      const tiny = Math.hypot(p[0] - cur[0], p[1] - cur[1]) < 0.05;
      const e = end(p);
      const sq = tiny ? 0 : 0.04;
      const rot = tiny ? a[2]! : Math.round(hash(`${seed}:r`) * 180);
      out.push(`A${n(a[0]! * (1 + sq))} ${n(a[1]! * (1 - sq))} ${rot} ${a[3]} ${a[4]} ${n(e[0])} ${n(e[1])}`);
      inkCur = e; lastC = lastQ = null;
    }
    cur = p;
  }
  return out.join('');
}

/** The ink take on every path of a set, keyed like the source. */
export function inkPaths<K extends string>(paths: Record<K, string>): Record<K, string> {
  return Object.fromEntries(Object.entries<string>(paths).map(([k, d]) => [k, inkPath(d, k)])) as Record<K, string>;
}
