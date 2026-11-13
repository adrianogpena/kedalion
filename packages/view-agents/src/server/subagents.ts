// The session's subagents read from their own transcripts: `<session>/subagents/agent-<id>.jsonl` for launched agents and
// `<session>/subagents/workflows/<runId>/agent-<id>.jsonl` for the agents of a workflow run (with its `journal.jsonl`).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSubagentInfo, AgentTraceStep } from '../protocol.ts';
import { parseTrace } from './trace.ts';

const MAX_PROMPT = 4000;
const MAX_RESULT = 2000;
/** Parsed transcripts kept between requests. */
const MAX_CACHED = 400;
const SAFE_ID = /^[\w-]{1,80}$/;
/** The preamble Claude Code puts before a workflow agent's computed task. */
const HARNESS = /^\[Workflow harness[^\n]*\n(?:[^\n]*\n)*?[^\n]*computed task text follows:\n/;

type Status = AgentSubagentInfo['status'];
type Summary = Omit<AgentSubagentInfo, 'agentId' | 'status' | 'runId' | 'phase'> & { finished: boolean };

const cache = new Map<string, { stamp: string; summary: Summary }>();

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** The folder holding a session's subagent transcripts. */
export const subagentsDir = (sessionFile: string) => join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');

/** Sums up one agent transcript's steps. */
export function summarize(steps: AgentTraceStep[]): Summary {
  let cost = 0;
  let toolUses = 0;
  let errors = 0;
  let tokens: number | undefined;
  let model: string | undefined;
  let current: string | undefined;
  let result: string | undefined;
  let prompt: string | undefined;
  for (const s of steps) {
    if (s.cost) cost += s.cost.input + s.cost.output + s.cost.cacheRead + s.cost.cacheWrite;
    if (s.tokens) tokens = s.tokens.input + s.tokens.cacheRead + s.tokens.cacheWrite + s.tokens.output;
    if (s.model && s.model !== '<synthetic>') model = s.model;
    if (s.kind === 'user' && prompt === undefined && s.detail) prompt = clip(s.detail.replace(HARNESS, '').replace(/^ {2}/gm, '').trim(), MAX_PROMPT);
    if (s.kind === 'assistant' && s.detail) result = s.detail;
    if (s.kind === 'tool') {
      toolUses++;
      if (s.error) errors++;
    }
  }
  const lastTool = [...steps].reverse().find((s) => s.kind === 'tool');
  if (lastTool?.pending) current = lastTool.label;
  const first = steps.find((s) => s.ts !== undefined)?.ts;
  const last = [...steps].reverse().find((s) => s.ts !== undefined)?.ts;
  const end = steps[steps.length - 1];
  return {
    toolUses,
    errors,
    finished: !!end && end.kind === 'assistant' && !current,
    ...(first !== undefined ? { startedAt: first } : {}),
    ...(last !== undefined ? { endedAt: last } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    ...(cost > 0 ? { cost } : {}),
    ...(model ? { model } : {}),
    ...(current ? { current } : {}),
    ...(prompt ? { prompt } : {}),
    ...(result ? { result: clip(result, MAX_RESULT) } : {}),
  };
}

function summaryOfFile(file: string, windowOf?: (model: string) => number | undefined): Summary | undefined {
  let stamp: string;
  try {
    const st = statSync(file);
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch {
    return undefined;
  }
  const hit = cache.get(file);
  if (hit && hit.stamp === stamp) return hit.summary;
  let summary: Summary;
  try {
    summary = summarize(parseTrace(readFileSync(file, 'utf8'), windowOf));
  } catch {
    return undefined;
  }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(file, { stamp, summary });
  return summary;
}

interface Meta {
  agentType?: string;
  description?: string;
  workflowPhase?: string;
  model?: string;
  finished?: boolean;
}

function metaOf(file: string): Meta {
  try {
    const m = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    return { agentType: s(m.agentType), description: s(m.description), workflowPhase: s(m.workflowPhase), model: s(m.model), finished: m.finished === true };
  } catch {
    return {};
  }
}

const isFailure = (result: unknown): boolean => {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  const status = typeof r.status === 'string' ? r.status.toLowerCase() : '';
  return status === 'failed' || status === 'error' || r.error !== undefined || r.is_error === true;
};

const resultText = (result: unknown): string | undefined => {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'string') return result.trim() || undefined;
  if (typeof result !== 'object') return String(result);
  const r = result as Record<string, unknown>;
  for (const k of ['summary', 'error', 'message', 'text']) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return JSON.stringify(result, null, 2);
};

export interface JournalAgent {
  agentId: string;
  label?: string;
  phase?: string;
  status: Status;
  result?: string;
}

/** A run's `journal.jsonl` (records `launched`, `started` {agentId,label,phase}, `result` {agentId,result}), agents in start order. */
export function parseJournal(text: string): JournalAgent[] {
  const agents = new Map<string, JournalAgent>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const key = typeof rec.agentId === 'string' ? rec.agentId : typeof rec.key === 'string' ? rec.key : undefined;
    if (!key) continue;
    const cur = agents.get(key) ?? { agentId: key, status: 'running' as Status };
    if (rec.type === 'started') {
      if (typeof rec.label === 'string' && rec.label) cur.label = rec.label;
      if (typeof rec.phase === 'string' && rec.phase) cur.phase = rec.phase;
    } else if (rec.type === 'result') {
      cur.status = isFailure(rec.result) ? 'failed' : 'done';
      const text = resultText(rec.result);
      if (text) cur.result = clip(text, MAX_RESULT);
    } else continue;
    agents.set(key, cur);
  }
  return [...agents.values()];
}

const agentFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((n) => /^agent-[\w-]+\.jsonl$/.test(n));
  } catch {
    return [];
  }
};

const info = (dir: string, agentId: string, base: Partial<AgentSubagentInfo>, status: Status | undefined, windowOf?: (model: string) => number | undefined): AgentSubagentInfo => {
  const meta = metaOf(join(dir, `agent-${agentId}.meta.json`));
  const sum = summaryOfFile(join(dir, `agent-${agentId}.jsonl`), windowOf);
  const { finished, ...rest } = sum ?? { finished: false, toolUses: 0, errors: 0 };
  return {
    ...rest,
    ...(meta.agentType ? { type: meta.agentType } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(!rest.model && meta.model ? { model: meta.model } : {}),
    ...(meta.workflowPhase ? { phase: meta.workflowPhase } : {}),
    ...base,
    agentId,
    status: status ?? (meta.finished || finished ? 'done' : 'running'),
  };
};

/** Every subagent of a session: launched agents first, then each workflow run's agents in start order. */
export function subagentsOf(sessionFile: string, windowOf?: (model: string) => number | undefined): AgentSubagentInfo[] {
  const dir = subagentsDir(sessionFile);
  if (!existsSync(dir)) return [];
  const out: AgentSubagentInfo[] = [];
  for (const name of agentFiles(dir)) out.push(info(dir, name.slice(6, -6), {}, undefined, windowOf));
  const wfDir = join(dir, 'workflows');
  let runs: string[] = [];
  try {
    runs = readdirSync(wfDir).filter((n) => SAFE_ID.test(n));
  } catch {
    runs = [];
  }
  for (const runId of runs) {
    const runDir = join(wfDir, runId);
    let journal: JournalAgent[] = [];
    try {
      journal = parseJournal(readFileSync(join(runDir, 'journal.jsonl'), 'utf8'));
    } catch {
      journal = [];
    }
    const seen = new Set<string>();
    for (const j of journal) {
      if (!SAFE_ID.test(j.agentId)) continue;
      seen.add(j.agentId);
      const base: Partial<AgentSubagentInfo> = { runId, ...(j.label ? { description: j.label } : {}), ...(j.phase ? { phase: j.phase } : {}) };
      const a = info(runDir, j.agentId, base, j.status, windowOf);
      if (j.result) a.result = j.result;
      out.push(a);
    }
    for (const name of agentFiles(runDir)) {
      const agentId = name.slice(6, -6);
      if (!seen.has(agentId)) out.push(info(runDir, agentId, { runId }, undefined, windowOf));
    }
  }
  return out;
}

/** The transcript of one subagent, or undefined for an id that is not a plain name or a file that is not there. */
export function subagentFile(sessionFile: string, agentId: string, runId?: string): string | undefined {
  if (!SAFE_ID.test(agentId) || (runId !== undefined && !SAFE_ID.test(runId))) return undefined;
  const dir = runId ? join(subagentsDir(sessionFile), 'workflows', runId) : subagentsDir(sessionFile);
  const file = join(dir, `agent-${agentId}.jsonl`);
  return existsSync(file) ? file : undefined;
}
