export interface TextDiff {
  appeared: string[];
  disappeared: string[];
}

/** Multiset difference of two lists of visible text nodes. */
export function diffTexts(before: string[], after: string[]): TextDiff {
  const count = (list: string[]) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const b = count(before);
  const a = count(after);
  const gain = (x: Map<string, number>, y: Map<string, number>) => {
    const out: string[] = [];
    for (const [t, n] of x) for (let k = y.get(t) ?? 0; k < n; k++) out.push(t);
    return out;
  };
  return { appeared: gain(a, b), disappeared: gain(b, a) };
}

export interface Effect {
  focus: string;
  diff: TextDiff;
  requests: number;
  errors: string[];
}

const list = (label: string, items: string[], cap: number) => {
  if (!items.length) return null;
  const shown = items.slice(0, cap).map((t) => JSON.stringify(t.length > 60 ? `${t.slice(0, 59)}...` : t));
  return `${label}: ${shown.join(', ')}${items.length > cap ? ` (+${items.length - cap} more)` : ''}`;
};

/** Short text of what an action changed; each part is capped. */
export function formatEffect(e: Effect, cap = 6): string {
  const lines = [
    e.focus ? `Focus: ${e.focus}` : null,
    list('Appeared', e.diff.appeared, cap),
    list('Disappeared', e.diff.disappeared, cap),
    `Requests started: ${e.requests}`,
    e.errors.length ? `Console errors (${e.errors.length}): ${e.errors.slice(0, 3).map((t) => (t.length > 120 ? `${t.slice(0, 119)}...` : t)).join(' | ')}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
