import type { AgentTraceStep, AgentTraceTodo } from '../../protocol';
import { resultTokens } from './model';

const stepCost = (s: AgentTraceStep) => (s.cost ? s.cost.input + s.cost.output + s.cost.cacheRead + s.cost.cacheWrite : 0);

export interface CommandRow {
  i: number;
  ts?: number;
  command: string;
  error: boolean;
  exitCode?: number;
  durationMs?: number;
  tokens?: number;
  pending: boolean;
}

export function commandsOf(steps: AgentTraceStep[]): CommandRow[] {
  const out: CommandRow[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || s.tool !== 'Bash' || !s.command) return;
    const tokens = resultTokens(s);
    out.push({ i, command: s.command, error: s.error === true, pending: s.pending === true, ...(s.ts !== undefined ? { ts: s.ts } : {}), ...(s.exitCode !== undefined ? { exitCode: s.exitCode } : {}), ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}), ...(tokens !== undefined ? { tokens } : {}) });
  });
  return out;
}

export interface TodoWrite {
  i: number;
  ts?: number;
  todos: AgentTraceTodo[];
  added: string[];
  completed: string[];
  done: number;
}

export interface TodoHistory {
  writes: TodoWrite[];
  /** The list as last written. */
  last: AgentTraceTodo[];
  open: AgentTraceTodo[];
}

export function todosOf(steps: AgentTraceStep[]): TodoHistory {
  const writes: TodoWrite[] = [];
  let prev = new Map<string, AgentTraceTodo['status']>();
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || !s.todos) return;
    const now = new Map(s.todos.map((x) => [x.content, x.status]));
    const added = s.todos.filter((x) => !prev.has(x.content)).map((x) => x.content);
    const completed = s.todos.filter((x) => x.status === 'completed' && prev.get(x.content) !== 'completed' && prev.has(x.content)).map((x) => x.content);
    writes.push({ i, todos: s.todos, added, completed, done: s.todos.filter((x) => x.status === 'completed').length, ...(s.ts !== undefined ? { ts: s.ts } : {}) });
    prev = now;
  });
  const last = writes[writes.length - 1]?.todos ?? [];
  return { writes, last, open: last.filter((x) => x.status !== 'completed') };
}

export interface AgentRow {
  i: number;
  ts?: number;
  type: string;
  description: string;
  model?: string;
  prompt?: string;
  background: boolean;
  status: 'running' | 'done' | 'failed';
  summary?: string;
  result?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** Position of the notification step that reported the end of a background agent. */
  noticeI?: number;
}

export function agentsOf(steps: AgentTraceStep[]): AgentRow[] {
  const notices = new Map<string, { i: number; step: AgentTraceStep }>();
  steps.forEach((s, i) => {
    if (s.notice) notices.set(s.notice.toolUseId, { i, step: s });
  });
  const out: AgentRow[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || !s.subagent) return;
    const sub = s.subagent;
    const n = s.toolUseId ? notices.get(s.toolUseId) : undefined;
    const notice = n?.step.notice;
    const background = sub.background === true;
    const failed = s.error === true || (notice?.status !== undefined && notice.status !== 'completed');
    const finished = background ? notice !== undefined : !s.pending;
    const tokens = notice?.tokens ?? sub.tokens;
    const toolUses = notice?.toolUses ?? sub.toolUses;
    const durationMs = notice?.durationMs ?? sub.durationMs ?? (background ? undefined : s.durationMs);
    out.push({
      i,
      type: sub.type ?? 'general-purpose',
      description: sub.description ?? s.label,
      background,
      status: failed ? 'failed' : finished ? 'done' : 'running',
      ...(s.ts !== undefined ? { ts: s.ts } : {}),
      ...(sub.model ? { model: sub.model } : {}),
      ...(sub.prompt ? { prompt: sub.prompt } : {}),
      ...(notice?.summary ? { summary: notice.summary } : {}),
      ...(sub.result ? { result: sub.result } : {}),
      ...(tokens !== undefined ? { tokens } : {}),
      ...(toolUses !== undefined ? { toolUses } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(n ? { noticeI: n.i } : {}),
    });
  });
  return out;
}

export interface PromptRow {
  /** Position of the prompt step. */
  i: number;
  ts?: number;
  label: string;
  /** Steps up to the next prompt. */
  steps: number;
  calls: number;
  errors: number;
  cost: number;
  /** Prompt to the first reply. */
  answerMs?: number;
  /** Prompt to the last step of its turn. */
  durationMs?: number;
  files: number;
  interrupted: boolean;
}

/** One row per prompt you typed, with what the turn that followed it did and cost. */
export function promptRows(steps: AgentTraceStep[]): PromptRow[] {
  const heads: number[] = [];
  steps.forEach((s, i) => {
    if (s.kind === 'user' && !s.sidechain && !s.source) heads.push(i);
  });
  return heads.map((i, k) => {
    const end = heads[k + 1] ?? steps.length;
    const head = steps[i]!;
    const row: PromptRow = { i, label: head.label, steps: end - i - 1, calls: 0, errors: 0, cost: 0, files: 0, interrupted: false, ...(head.ts !== undefined ? { ts: head.ts } : {}) };
    const files = new Set<string>();
    let lastTs = head.ts;
    for (let j = i + 1; j < end; j++) {
      const s = steps[j]!;
      row.cost += stepCost(s);
      if (s.ts !== undefined) lastTs = s.ts;
      if (row.answerMs === undefined && s.ts !== undefined && head.ts !== undefined && (s.kind === 'assistant' || s.kind === 'thinking' || s.kind === 'tool')) row.answerMs = s.ts - head.ts;
      if (s.marker === 'interrupt') row.interrupted = true;
      if (s.kind !== 'tool') continue;
      row.calls++;
      if (s.error) row.errors++;
      if (s.file && s.edits) files.add(s.file.replace(/\\/g, '/').toLowerCase());
      for (const f of s.shellFiles ?? []) if (f.op !== 'restore') files.add(f.path.replace(/\\/g, '/').toLowerCase());
    }
    row.files = files.size;
    if (lastTs !== undefined && head.ts !== undefined && lastTs >= head.ts) row.durationMs = lastTs - head.ts;
    return row;
  });
}

export interface WebCall {
  i: number;
  ts?: number;
  /** `web` or the MCP server name. */
  group: string;
  tool: string;
  target: string;
  error: boolean;
  durationMs?: number;
  tokens?: number;
}

export function webCallsOf(steps: AgentTraceStep[]): WebCall[] {
  const out: WebCall[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || !s.tool) return;
    const mcp = /^mcp__(.+?)__(.+)$/.exec(s.tool);
    if (!mcp && s.tool !== 'WebFetch' && s.tool !== 'WebSearch') return;
    const tokens = resultTokens(s);
    const label = s.label.replace(/^[^(]*\(/, '').replace(/\)$/, '');
    out.push({ i, group: mcp ? mcp[1]! : 'web', tool: mcp ? mcp[2]! : s.tool, target: s.target ?? label, error: s.error === true, ...(s.ts !== undefined ? { ts: s.ts } : {}), ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}), ...(tokens !== undefined ? { tokens } : {}) });
  });
  return out;
}
