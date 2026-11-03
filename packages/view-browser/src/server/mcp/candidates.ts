export interface Candidate {
  i: number;
  tag: string;
  text: string;
  /** Every string the element answers to (visible text, aria-label, title, or field labels). */
  texts: string[];
  x: number;
  y: number;
}

export interface Match {
  tier: 'exact' | 'contains' | 'none';
  hits: Candidate[];
}

export const normText = (s: string): string => s.replace(/\s+/g, ' ').trim().replace(/\s*[:：]$/, '').toLowerCase();

/** Candidates whose text equals the query; when none do, those that contain it. */
export function matchCandidates(cands: Candidate[], query: string): Match {
  const q = normText(query);
  if (!q) return { tier: 'none', hits: [] };
  const exact = cands.filter((c) => c.texts.some((t) => normText(t) === q));
  if (exact.length) return { tier: 'exact', hits: exact };
  const contains = cands.filter((c) => c.texts.some((t) => normText(t).includes(q)));
  return contains.length ? { tier: 'contains', hits: contains } : { tier: 'none', hits: [] };
}

export const REF_RE = /^e[1-9]\d*$/;
export const isRef = (s: string): boolean => REF_RE.test(s);

/** One line per ambiguous candidate: ref, tag, text, position. */
export function describeCandidates(hits: Candidate[], refs: string[], max = 8): string {
  const lines = hits.slice(0, max).map((c, k) => `- ${refs[k] ?? '?'} <${c.tag}> "${c.text}" at ${c.x},${c.y}`);
  if (hits.length > max) lines.push(`... +${hits.length - max} more`);
  return lines.join('\n');
}
