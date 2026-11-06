import type { AgentTraceStep } from '../../protocol';
import { filesOf, resultTokens } from './model';

const PAUSE_MS = 5 * 60_000;
const HIST_BARS = 60;
const COMPACT_DROP = 0.3;

export interface ModelStat {
  model: string;
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface CostStat {
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Share of the context served from the cache: read / (read + input + write). */
  hitRate: number;
  /** Turns whose model has no known price. */
  unpriced: number;
}

export interface TimeStat {
  spanMs: number;
  /** Waiting for the model (assistant and thinking steps). */
  modelMs: number;
  /** Tool calls, call to result. */
  toolMs: number;
  /** Between a reply and your next prompt. */
  idleMs: number;
}

export interface ContextPoint {
  i: number;
  context: number;
  percent?: number;
  /** The context fell sharply from the previous request: a compaction or a cleared session. */
  drop: boolean;
}

export interface HeavyResult {
  i: number;
  label: string;
  tokens: number;
}

export interface PromptStat {
  you: number;
  skill: number;
  agent: number;
  task: number;
  shell: number;
  system: number;
}

export interface SubagentStat {
  steps: number;
  tools: number;
  turns: number;
  tokens: number;
  cost: number;
}

export interface ErrorStat {
  tool: string;
  calls: number;
  errors: number;
  /** Failed calls directly followed (within three tool calls) by the same tool again. */
  retries: number;
}

export interface Activity {
  bucketMs: number;
  start: number;
  counts: number[];
  pauses: number;
  longestPauseMs: number;
}

export interface FileRollup {
  read: number;
  edited: number;
  created: number;
  deleted: number;
  added: number;
  removed: number;
  bash: number;
}

export interface ToolDetail {
  tool: string;
  /** Share of all tool time, 0-100. */
  pct: number;
  p50: number;
  p95: number;
  /** Estimated tokens its results added to the context. */
  resultTokens: number;
}

export function modelsOf(steps: AgentTraceStep[]): ModelStat[] {
  const m = new Map<string, ModelStat>();
  for (const s of steps) {
    if (!s.tokens) continue;
    const key = s.model ?? '?';
    const x = m.get(key) ?? { model: key, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    x.turns++;
    x.input += s.tokens.input;
    x.output += s.tokens.output;
    x.cacheRead += s.tokens.cacheRead;
    x.cacheWrite += s.tokens.cacheWrite;
    if (s.cost) x.cost += s.cost.input + s.cost.output + s.cost.cacheRead + s.cost.cacheWrite;
    m.set(key, x);
  }
  return [...m.values()].sort((a, b) => b.turns - a.turns);
}

export function costOfSteps(steps: AgentTraceStep[]): CostStat {
  const c: CostStat = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, hitRate: 0, unpriced: 0 };
  let read = 0;
  let all = 0;
  for (const s of steps) {
    if (!s.tokens) continue;
    read += s.tokens.cacheRead;
    all += s.tokens.cacheRead + s.tokens.input + s.tokens.cacheWrite;
    if (!s.cost) {
      c.unpriced++;
      continue;
    }
    c.input += s.cost.input;
    c.output += s.cost.output;
    c.cacheRead += s.cost.cacheRead;
    c.cacheWrite += s.cost.cacheWrite;
  }
  c.total = c.input + c.output + c.cacheRead + c.cacheWrite;
  c.hitRate = all > 0 ? read / all : 0;
  return c;
}

export function timeOf(steps: AgentTraceStep[]): TimeStat {
  const t: TimeStat = { spanMs: 0, modelMs: 0, toolMs: 0, idleMs: 0 };
  let first: number | undefined;
  let last: number | undefined;
  let prev: number | undefined;
  for (const s of steps) {
    if (s.ts !== undefined) {
      first ??= s.ts;
      last = s.ts;
    }
    if (s.kind === 'tool') t.toolMs += s.durationMs ?? 0;
    else if (s.kind === 'assistant' || s.kind === 'thinking') t.modelMs += s.durationMs ?? 0;
    else if (s.kind === 'user' && !s.sidechain && !s.source && prev !== undefined && s.ts !== undefined && s.ts > prev) t.idleMs += s.ts - prev;
    if (s.ts !== undefined) prev = s.ts;
  }
  if (first !== undefined && last !== undefined) t.spanMs = last - first;
  return t;
}

export function contextSeries(steps: AgentTraceStep[]): ContextPoint[] {
  const out: ContextPoint[] = [];
  let prev: number | undefined;
  steps.forEach((s, i) => {
    if (s.context === undefined || s.sidechain) return;
    out.push({ i, context: s.context, ...(s.contextPercent !== undefined ? { percent: s.contextPercent } : {}), drop: prev !== undefined && prev > 0 && s.context < prev * (1 - COMPACT_DROP) });
    prev = s.context;
  });
  return out;
}

export function heaviestResults(steps: AgentTraceStep[], n = 10): HeavyResult[] {
  const rows: HeavyResult[] = [];
  steps.forEach((s, i) => {
    const tokens = s.kind === 'tool' ? resultTokens(s) : undefined;
    if (tokens) rows.push({ i, label: s.label, tokens });
  });
  return rows.sort((a, b) => b.tokens - a.tokens).slice(0, n);
}

export function promptsOf(steps: AgentTraceStep[]): PromptStat {
  const p: PromptStat = { you: 0, skill: 0, agent: 0, task: 0, shell: 0, system: 0 };
  for (const s of steps) {
    if (s.kind !== 'user' || s.sidechain) continue;
    p[s.source ?? 'you']++;
  }
  return p;
}

export function subagentOf(steps: AgentTraceStep[]): { main: SubagentStat; sub: SubagentStat } {
  const blank = (): SubagentStat => ({ steps: 0, tools: 0, turns: 0, tokens: 0, cost: 0 });
  const main = blank();
  const sub = blank();
  for (const s of steps) {
    const x = s.sidechain ? sub : main;
    x.steps++;
    if (s.kind === 'tool') x.tools++;
    if (s.tokens) {
      x.turns++;
      x.tokens += s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;
    }
    if (s.cost) x.cost += s.cost.input + s.cost.output + s.cost.cacheRead + s.cost.cacheWrite;
  }
  return { main, sub };
}

export function errorsOf(steps: AgentTraceStep[]): ErrorStat[] {
  const m = new Map<string, ErrorStat>();
  const tools = steps.filter((s) => s.kind === 'tool' && s.tool);
  tools.forEach((s, k) => {
    const x = m.get(s.tool!) ?? { tool: s.tool!, calls: 0, errors: 0, retries: 0 };
    x.calls++;
    if (s.error) {
      x.errors++;
      if (tools.slice(k + 1, k + 4).some((n) => n.tool === s.tool)) x.retries++;
    }
    m.set(s.tool!, x);
  });
  return [...m.values()].filter((e) => e.errors > 0).sort((a, b) => b.errors / b.calls - a.errors / a.calls || b.errors - a.errors);
}

export function activityOf(steps: AgentTraceStep[]): Activity | undefined {
  const ts = steps.map((s) => s.ts).filter((v): v is number => v !== undefined);
  if (ts.length < 2) return undefined;
  const start = ts[0]!;
  const span = ts[ts.length - 1]! - start;
  const bucketMs = Math.max(60_000, Math.ceil(span / HIST_BARS / 60_000) * 60_000);
  const counts = new Array<number>(Math.floor(span / bucketMs) + 1).fill(0);
  let pauses = 0;
  let longestPauseMs = 0;
  ts.forEach((v, k) => {
    counts[Math.floor((v - start) / bucketMs)]!++;
    const gap = k > 0 ? v - ts[k - 1]! : 0;
    if (gap >= PAUSE_MS) {
      pauses++;
      longestPauseMs = Math.max(longestPauseMs, gap);
    }
  });
  return { bucketMs, start, counts, pauses, longestPauseMs };
}

export function fileRollup(steps: AgentTraceStep[]): FileRollup {
  const r: FileRollup = { read: 0, edited: 0, created: 0, deleted: 0, added: 0, removed: 0, bash: steps.filter((s) => s.kind === 'tool' && s.tool === 'Bash').length };
  for (const f of filesOf(steps)) {
    if (f.kind === 'read') r.read++;
    else if (f.kind === 'created') r.created++;
    else if (f.kind === 'deleted') r.deleted++;
    else r.edited++;
    r.added += f.added;
    r.removed += f.removed;
  }
  return r;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

export function toolDetails(steps: AgentTraceStep[]): Map<string, ToolDetail> {
  const durations = new Map<string, number[]>();
  const tokens = new Map<string, number>();
  let all = 0;
  for (const s of steps) {
    if (s.kind !== 'tool' || !s.tool) continue;
    const d = s.durationMs ?? 0;
    durations.set(s.tool, [...(durations.get(s.tool) ?? []), d]);
    tokens.set(s.tool, (tokens.get(s.tool) ?? 0) + (resultTokens(s) ?? 0));
    all += d;
  }
  const out = new Map<string, ToolDetail>();
  for (const [tool, list] of durations) {
    const sorted = [...list].sort((a, b) => a - b);
    out.set(tool, { tool, pct: all > 0 ? (list.reduce((a, b) => a + b, 0) / all) * 100 : 0, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), resultTokens: tokens.get(tool) ?? 0 });
  }
  return out;
}
