export type Rgb = [number, number, number];

/** Parses `#rgb` or `#rrggbb`; null for anything else. */
export function parseHex(color: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Mix of `a` and `b`: t 0 gives a, 1 gives b (t is clamped). Returns `a` when either is not a hex colour. */
export function blend(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(1, t));
  return `#${x.map((v, i) => hex2(v + (y[i]! - v) * k)).join('')}`;
}

/** Background for a changed hunk: the base colour tinted towards the accent by `strength` (0..1). */
export const hunkBg = (base: string, accent: string, strength = 0.18): string => blend(base, accent, strength);

/** The same mix as a CSS value, for themes that stay in CSS variables. */
export const cssColorMix = (accent: string, base: string, accentPercent: number): string =>
  `color-mix(in srgb, ${accent} ${Math.round(accentPercent)}%, ${base})`;
