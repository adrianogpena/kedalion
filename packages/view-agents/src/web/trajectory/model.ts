import type { AgentTraceStep } from '../../protocol';

export type StepKind = AgentTraceStep['kind'];
export const STEP_KINDS: StepKind[] = ['user', 'assistant', 'thinking', 'tool'];

/** A step with its position in the session (0 = oldest). */
export interface Entry {
  step: AgentTraceStep;
  i: number;
}

export interface Filters {
  kinds: StepKind[];
  tool: string;
  errorsOnly: boolean;
  query: string;
}

export const NO_FILTERS: Filters = { kinds: [...STEP_KINDS], tool: '', errorsOnly: false, query: '' };

export const filtersActive = (f: Filters) => f.kinds.length !== STEP_KINDS.length || !!f.tool || f.errorsOnly || !!f.query.trim();

export const entriesOf = (steps: AgentTraceStep[]): Entry[] => steps.map((step, i) => ({ step, i }));

export function applyFilters(entries: Entry[], f: Filters): Entry[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter(({ step: s }) => {
    if (!f.kinds.includes(s.kind)) return false;
    if (f.tool && s.tool !== f.tool) return false;
    if (f.errorsOnly && !s.error) return false;
    if (q && !`${s.label}\n${s.detail}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Names of the tools the session called, most used first. */
export function toolNames(steps: AgentTraceStep[]): string[] {
  const n = new Map<string, number>();
  for (const s of steps) if (s.tool) n.set(s.tool, (n.get(s.tool) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

/** The nearest entry before (`dir` -1) or after (`dir` 1) position `from` that satisfies `match`; undefined when none. */
export function findFrom(entries: Entry[], from: number, dir: 1 | -1, match: (s: AgentTraceStep) => boolean): Entry | undefined {
  for (let k = from + dir; k >= 0 && k < entries.length; k += dir) if (match(entries[k]!.step)) return entries[k];
  return undefined;
}

export const isError = (s: AgentTraceStep) => s.error === true;
export const isPrompt = (s: AgentTraceStep) => s.kind === 'user' && !s.sidechain;

export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtTokens(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtClock(ts: number | undefined): string {
  if (ts === undefined) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface ToolStat {
  tool: string;
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  /** Position of the slowest call. */
  slowest: number;
}

export function toolStats(steps: AgentTraceStep[]): ToolStat[] {
  const m = new Map<string, ToolStat>();
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || !s.tool) return;
    const x = m.get(s.tool) ?? { tool: s.tool, calls: 0, errors: 0, totalMs: 0, maxMs: 0, slowest: i };
    x.calls++;
    if (s.error) x.errors++;
    const d = s.durationMs ?? 0;
    x.totalMs += d;
    if (d > x.maxMs) {
      x.maxMs = d;
      x.slowest = i;
    }
    m.set(s.tool, x);
  });
  return [...m.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
}

export interface SessionTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  peakContext: number;
  turns: number;
  /** First to last entry, ms. */
  spanMs: number;
}

export function totalsOf(steps: AgentTraceStep[]): SessionTotals {
  const t: SessionTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, peakContext: 0, turns: 0, spanMs: 0 };
  let first: number | undefined;
  let last: number | undefined;
  for (const s of steps) {
    if (s.ts !== undefined) {
      first ??= s.ts;
      last = s.ts;
    }
    if (s.tokens) {
      t.turns++;
      t.input += s.tokens.input;
      t.output += s.tokens.output;
      t.cacheRead += s.tokens.cacheRead;
      t.cacheWrite += s.tokens.cacheWrite;
    }
    if (s.context && s.context > t.peakContext) t.peakContext = s.context;
  }
  if (first !== undefined && last !== undefined) t.spanMs = last - first;
  return t;
}

export interface StepInfo {
  /** Position of the first step of the same request, when this is not it. */
  head?: number;
  /** Steps of the request this one belongs to (1 when alone). */
  group: number;
  /** Positions of every step of that request (empty when alone). */
  members: number[];
  /** Context change since the previous request that reported one. */
  delta?: number;
}

/** Request grouping and context change per step. */
export function infoOf(steps: AgentTraceStep[]): StepInfo[] {
  const first = new Map<string, number>();
  const all = new Map<string, number[]>();
  steps.forEach((s, i) => {
    if (!s.messageId) return;
    if (!first.has(s.messageId)) first.set(s.messageId, i);
    all.set(s.messageId, [...(all.get(s.messageId) ?? []), i]);
  });
  let prev: number | undefined;
  return steps.map((s, i) => {
    const h = s.messageId ? first.get(s.messageId) : undefined;
    const members = s.messageId ? (all.get(s.messageId) ?? []) : [];
    const info: StepInfo = { group: Math.max(1, members.length), members: members.length > 1 ? members : [] };
    if (h !== undefined && h !== i) info.head = h;
    if (s.context !== undefined) {
      if (prev !== undefined) info.delta = s.context - prev;
      prev = s.context;
    }
    return info;
  });
}

/** Tokens a tool result adds to the next request, estimated at 4 characters each. */
export const resultTokens = (s: AgentTraceStep): number | undefined => (s.resultChars !== undefined ? Math.ceil(s.resultChars / 4) : undefined);

export const fmtDelta = (n: number): string => `${n >= 0 ? '+' : '−'}${fmtTokens(Math.abs(n))}`;

export interface FileEntry {
  file: string;
  reads: number;
  edits: Array<{ i: number; old: string; new: string; error: boolean }>;
}

/** Files the session read or changed, most changed first. */
export function filesOf(steps: AgentTraceStep[]): FileEntry[] {
  const m = new Map<string, FileEntry>();
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || !s.file) return;
    const x = m.get(s.file) ?? { file: s.file, reads: 0, edits: [] };
    if (s.edits) for (const e of s.edits) x.edits.push({ i, old: e.old, new: e.new, error: s.error === true });
    else x.reads++;
    m.set(s.file, x);
  });
  return [...m.values()].sort((a, b) => b.edits.length - a.edits.length || b.reads - a.reads || a.file.localeCompare(b.file));
}

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

const MAX_DIFF_LINES = 1500;

/** Line diff of two texts (LCS); falls back to "all removed, all added" past `MAX_DIFF_LINES` lines. */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...a.map((text): DiffLine => ({ kind: 'del', text })), ...b.map((text): DiffLine => ({ kind: 'add', text }))];
  }
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) out.push({ kind: 'del', text: a[i++]! });
    else out.push({ kind: 'add', text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

/** The step as markdown, for copying. */
export function stepMarkdown(s: AgentTraceStep, kindLabel: string): string {
  const head = `**${kindLabel}:** ${s.label}`;
  return s.kind === 'tool' ? `${head}\n\n\`\`\`\n${s.detail}\n\`\`\`` : `${head}\n\n${s.detail}`;
}

/** What "Show on session" sends to the transcript view: a tool call by id, else a message by its text (and which of the equal ones). */
export interface StepFocus {
  at: number;
  toolUseId?: string;
  kind?: 'user' | 'assistant';
  text?: string;
  nth?: number;
}

export function focusOf(steps: AgentTraceStep[], i: number, at: number): StepFocus | undefined {
  const s = steps[i];
  if (!s) return undefined;
  if (s.kind === 'tool') return s.toolUseId ? { at, toolUseId: s.toolUseId } : undefined;
  if (s.kind === 'thinking') return undefined;
  const text = s.detail.trim();
  let nth = 0;
  for (let k = 0; k < i; k++) if (steps[k]!.kind === s.kind && steps[k]!.detail.trim() === text) nth++;
  return { at, kind: s.kind, text, nth };
}

/** Parses the `focus` param of the agent panel. */
export function readFocus(v: unknown): StepFocus | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'number') return undefined;
  return {
    at: o.at,
    ...(typeof o.toolUseId === 'string' ? { toolUseId: o.toolUseId } : {}),
    ...(o.kind === 'user' || o.kind === 'assistant' ? { kind: o.kind } : {}),
    ...(typeof o.text === 'string' ? { text: o.text } : {}),
    ...(typeof o.nth === 'number' ? { nth: o.nth } : {}),
  };
}
