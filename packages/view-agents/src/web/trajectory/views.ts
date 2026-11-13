import { type AgentSubagentInfo, type AgentTraceStep, type AgentTraceTodo, shortModel } from '../../protocol';
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
  status: 'running' | 'done' | 'failed' | 'stopped';
  summary?: string;
  result?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** Position of the notification step that reported the end of a background agent. */
  noticeI?: number;
  /** Its own transcript can be opened. */
  agentId?: string;
  runId?: string;
  cost?: number;
  /** Tool call it is waiting on. */
  current?: string;
  phase?: string;
  /** Workflow run: its name, declared phases and agents. */
  workflow?: { name?: string; phases: string[]; agents: AgentRow[] };
}

/** Phases of a run in order (declared first, then as agents report them), with how many of their agents ended. */
export function phaseProgress(row: AgentRow): Array<{ phase: string; ended: number; total: number }> {
  const wf = row.workflow;
  if (!wf) return [];
  const order = [...wf.phases];
  for (const a of wf.agents) if (a.phase && !order.includes(a.phase)) order.push(a.phase);
  return order.map((phase) => {
    const of = wf.agents.filter((a) => a.phase === phase);
    return { phase, ended: of.filter((a) => a.status !== 'running').length, total: of.length };
  });
}

/** A row for one agent of a workflow run; a run that ended leaves its unfinished agents `stopped`. */
function memberRow(a: AgentSubagentInfo, i: number, ended: boolean): AgentRow {
  const durationMs = a.startedAt !== undefined && a.endedAt !== undefined ? a.endedAt - a.startedAt : undefined;
  return {
    i,
    type: a.type ?? 'general-purpose',
    description: a.description ?? a.agentId,
    background: false,
    status: a.status === 'running' && ended ? 'stopped' : a.status,
    agentId: a.agentId,
    toolUses: a.toolUses,
    ...(a.runId ? { runId: a.runId } : {}),
    ...(a.phase ? { phase: a.phase } : {}),
    ...(a.startedAt !== undefined ? { ts: a.startedAt } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(a.prompt ? { prompt: a.prompt } : {}),
    ...(a.result ? { result: a.result } : {}),
    ...(a.tokens !== undefined ? { tokens: a.tokens } : {}),
    ...(a.cost !== undefined ? { cost: a.cost } : {}),
    ...(a.current && !ended ? { current: a.current } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

const sum = (rows: AgentRow[], key: 'tokens' | 'cost' | 'toolUses'): number | undefined => {
  const vals = rows.flatMap((r) => (r[key] !== undefined ? [r[key]!] : []));
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : undefined;
};

/** Subagents and workflow runs launched in the session, merged with what their own transcripts say (`infos`). */
export function agentsOf(steps: AgentTraceStep[], infos: AgentSubagentInfo[] = []): AgentRow[] {
  const own = new Map(infos.filter((a) => !a.runId).map((a) => [a.agentId, a]));
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
    const status: AgentRow['status'] = failed ? 'failed' : finished ? 'done' : 'running';
    const wf = sub.workflow;
    const members = wf?.runId ? infos.filter((a) => a.runId === wf.runId).map((a) => memberRow(a, i, status !== 'running')) : [];
    const info = sub.agentId ? own.get(sub.agentId) : undefined;
    const tokens = wf ? sum(members, 'tokens') : (notice?.tokens ?? sub.tokens ?? info?.tokens);
    const toolUses = wf ? sum(members, 'toolUses') : (notice?.toolUses ?? sub.toolUses ?? (info ? info.toolUses : undefined));
    const cost = wf ? sum(members, 'cost') : info?.cost;
    const durationMs = notice?.durationMs ?? sub.durationMs ?? (background ? (info?.startedAt !== undefined && info.endedAt !== undefined && finished ? info.endedAt - info.startedAt : undefined) : s.durationMs);
    const model = sub.model ?? (info?.model ? shortModel(info.model) : undefined);
    out.push({
      i,
      type: sub.type ?? 'general-purpose',
      description: sub.description ?? s.label,
      background,
      status,
      ...(s.ts !== undefined ? { ts: s.ts } : {}),
      ...(model ? { model } : {}),
      ...(sub.prompt ? { prompt: sub.prompt } : {}),
      ...(notice?.summary ? { summary: notice.summary } : {}),
      ...(sub.result ? { result: sub.result } : wf && notice?.result ? { result: notice.result } : !finished || !info?.result ? {} : { result: info.result }),
      ...(tokens !== undefined ? { tokens } : {}),
      ...(toolUses !== undefined ? { toolUses } : {}),
      ...(cost !== undefined ? { cost } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(n ? { noticeI: n.i } : {}),
      ...(info ? { agentId: info.agentId } : {}),
      ...(info?.current && !finished ? { current: info.current } : {}),
      ...(wf ? { workflow: { ...(wf.name ? { name: wf.name } : {}), phases: wf.phases ?? [], agents: members }, ...(wf.runId ? { runId: wf.runId } : {}) } : {}),
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
  /** Tokens of the turn's requests (input, output and cache). */
  tokens: number;
  files: number;
  interrupted: boolean;
}

/** Step positions of the prompts you typed. */
export function promptHeads(steps: AgentTraceStep[]): number[] {
  const heads: number[] = [];
  steps.forEach((s, i) => {
    if (s.kind === 'user' && !s.sidechain && !s.source) heads.push(i);
  });
  return heads;
}

/** For each step, the position of the prompt whose turn it belongs to (-1 before the first prompt). */
export function turnOf(steps: AgentTraceStep[]): number[] {
  const out: number[] = [];
  let head = -1;
  steps.forEach((s, i) => {
    if (s.kind === 'user' && !s.sidechain && !s.source) head = i;
    out.push(head);
  });
  return out;
}

/** Tool calls that never got a result and never will: the session moved on past them, or it is not running. */
export function unknownResults(steps: AgentTraceStep[], running: boolean): Set<number> {
  const out = new Set<number>();
  let later = false;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.kind === 'tool' && s.pending && (!running || later)) out.add(i);
    if (s.kind === 'user' || s.kind === 'assistant') later = true;
  }
  return out;
}

export interface FailedCall {
  i: number;
  tool: string;
  label: string;
  /** The first later successful call of the same tool on the same target in the same turn. */
  fixedAt?: number;
}

const targetOf = (s: AgentTraceStep) => (s.file ? s.file.replace(/\\/g, '/').toLowerCase() : s.command ? (s.command.trim().split(/\s+/)[0] ?? '') : '');

/** Every failed tool call, paired with the call that later did the same thing successfully, if any. */
export function failedCalls(steps: AgentTraceStep[]): FailedCall[] {
  const turns = turnOf(steps);
  const out: FailedCall[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== 'tool' || !s.error || s.sidechain) return;
    const target = targetOf(s);
    let fixedAt: number | undefined;
    for (let j = i + 1; j < steps.length && turns[j] === turns[i]; j++) {
      const n = steps[j]!;
      if (n.kind === 'tool' && !n.sidechain && n.tool === s.tool && !n.error && !n.pending && targetOf(n) === target) {
        fixedAt = j;
        break;
      }
    }
    out.push({ i, tool: s.tool ?? 'tool', label: s.label, ...(fixedAt !== undefined ? { fixedAt } : {}) });
  });
  return out;
}

/** One row per prompt you typed, with what the turn that followed it did and cost. */
export function promptRows(steps: AgentTraceStep[]): PromptRow[] {
  const heads = promptHeads(steps);
  return heads.map((i, k) => {
    const end = heads[k + 1] ?? steps.length;
    const head = steps[i]!;
    const row: PromptRow = { i, label: head.label, steps: end - i - 1, calls: 0, errors: 0, cost: 0, tokens: 0, files: 0, interrupted: false, ...(head.ts !== undefined ? { ts: head.ts } : {}) };
    const files = new Set<string>();
    let lastTs = head.ts;
    for (let j = i + 1; j < end; j++) {
      const s = steps[j]!;
      row.cost += stepCost(s);
      if (s.tokens) row.tokens += s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;
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
