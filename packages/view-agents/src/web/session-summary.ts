import type { ChatEvent } from '../chat-protocol.ts';

export interface SessionSummary {
  /** First user prompt. */
  goal?: string;
  lastPrompt?: string;
  lastReply?: string;
  model?: string;
  turns: number;
  durationMs: number;
  costUsd: number;
  /** Unique paths edited by Edit / Write / NotebookEdit, in first-edit order. */
  files: string[];
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** Goal, last exchange, model, totals and edited files, derived from the loaded history events. */
export function summarize(events: ChatEvent[]): SessionSummary {
  const s: SessionSummary = { turns: 0, durationMs: 0, costUsd: 0, files: [] };
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type === 'user') {
      s.turns++;
      s.goal ??= e.text;
      s.lastPrompt = e.text;
    } else if (e.type === 'text' && !e.parentId) s.lastReply = e.text;
    else if (e.type === 'init' && e.model) s.model = e.model;
    else if (e.type === 'result') {
      s.durationMs += e.durationMs ?? 0;
      s.costUsd += e.costUsd ?? 0;
    } else if (e.type === 'tool_use' && !e.parentId && EDIT_TOOLS.has(e.name) && e.input && typeof e.input === 'object') {
      const o = e.input as Record<string, unknown>;
      const p = o.file_path ?? o.notebook_path;
      if (typeof p === 'string' && !seen.has(p)) {
        seen.add(p);
        s.files.push(p);
      }
    }
  }
  return s;
}

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

export interface ToolStats {
  /** Top-level tool calls, most used first. */
  tools: Array<[name: string, count: number]>;
  total: number;
  subagents: number;
  /** Workflow runs launched (each a group of agents). */
  workflows: number;
}

/** Tool-call totals and the number of subagents and workflow runs launched, from the loaded history events. */
export function toolStats(events: ChatEvent[]): ToolStats {
  const counts = new Map<string, number>();
  let total = 0;
  let subagents = 0;
  let workflows = 0;
  for (const e of events) {
    if (e.type !== 'tool_use' || e.parentId) continue;
    total++;
    counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    if (SUBAGENT_TOOLS.has(e.name)) subagents++;
    if (e.name === 'Workflow') workflows++;
  }
  return { tools: [...counts].sort((a, b) => b[1] - a[1]), total, subagents, workflows };
}

/** A path relative to the cwd when inside it, else unchanged. Handles both slash styles. */
export function shortPath(path: string, cwd: string): string {
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/');
  const p = norm(path);
  const c = norm(cwd).replace(/\/+$/, '');
  if (c && p.toLowerCase().startsWith(c.toLowerCase() + '/')) return p.slice(c.length + 1);
  return p;
}

export interface CompactTurn {
  /** Absent for events before the first user prompt. */
  prompt?: string;
  /** Tool calls and intermediate assistant text, in order. */
  folded: Array<{ kind: 'tool'; name: string; input: unknown } | { kind: 'text'; text: string }>;
  toolCounts: Array<[name: string, count: number]>;
  toolCalls: number;
  /** The last top-level assistant text of the turn. */
  final?: string;
  /** Failed result / error messages. */
  errors: string[];
}

/** Splits events into turns (one per user prompt) for the compact transcript. */
export function compactTurns(events: ChatEvent[]): CompactTurn[] {
  const turns: CompactTurn[] = [];
  const blank = (prompt?: string): CompactTurn => ({ prompt, folded: [], toolCounts: [], toolCalls: 0, errors: [] });
  let cur: CompactTurn | undefined;
  for (const e of events) {
    if (e.type === 'user') {
      cur = blank(e.text);
      turns.push(cur);
      continue;
    }
    if (!cur) {
      if (e.type === 'init' || e.type === 'thinking' || e.type === 'tool_result') continue;
      cur = blank();
      turns.push(cur);
    }
    if (e.type === 'text') {
      if (e.parentId) cur.folded.push({ kind: 'text', text: e.text });
      else {
        if (cur.final !== undefined) cur.folded.push({ kind: 'text', text: cur.final });
        cur.final = e.text;
      }
    } else if (e.type === 'tool_use') {
      if (cur.final !== undefined) cur.folded.push({ kind: 'text', text: cur.final });
      cur.final = undefined;
      cur.folded.push({ kind: 'tool', name: e.name, input: e.input });
      cur.toolCalls++;
      const hit = cur.toolCounts.find((c) => c[0] === e.name);
      if (hit) hit[1]++;
      else cur.toolCounts.push([e.name, 1]);
    } else if (e.type === 'result') {
      if (e.isError && !e.aborted) cur.errors.push(e.text ?? e.subtype);
    } else if (e.type === 'error') cur.errors.push(e.message);
  }
  return turns;
}
