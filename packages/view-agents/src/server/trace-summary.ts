import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AgentSessionSummary, AgentSiblingSession, AgentTraceStep } from '../protocol.ts';
import { parseTrace } from './trace.ts';

const MAX_SIBLINGS = 30;
const PROMPT_BYTES = 64 * 1024;
const NUMERIC = ['cost', 'turns', 'prompts', 'toolCalls', 'errors', 'spanMs', 'outputTokens', 'peakContext', 'filesEdited'] as const;

export function summaryOf(id: string, steps: AgentTraceStep[]): AgentSessionSummary {
  const s: AgentSessionSummary = { id, cost: 0, turns: 0, prompts: 0, toolCalls: 0, errors: 0, spanMs: 0, outputTokens: 0, peakContext: 0, filesEdited: 0 };
  const edited = new Set<string>();
  let first: number | undefined;
  let last: number | undefined;
  for (const x of steps) {
    if (x.ts !== undefined) {
      first ??= x.ts;
      last = x.ts;
    }
    if (x.kind === 'user' && !x.sidechain && !x.source) s.prompts++;
    if (x.kind === 'tool') {
      s.toolCalls++;
      if (x.error) s.errors++;
      if (x.file && x.edits) edited.add(x.file);
      for (const f of x.shellFiles ?? []) if (f.op !== 'restore') edited.add(f.path);
    }
    if (x.tokens) {
      s.turns++;
      s.outputTokens += x.tokens.output;
    }
    if (x.cost) s.cost += x.cost.input + x.cost.output + x.cost.cacheRead + x.cost.cacheWrite;
    if (x.context && x.context > s.peakContext) s.peakContext = x.context;
  }
  s.filesEdited = edited.size;
  if (first !== undefined && last !== undefined) s.spanMs = last - first;
  return s;
}

/** Mean of several summaries. */
export function averageOf(list: AgentSessionSummary[]): AgentSessionSummary | undefined {
  if (list.length === 0) return undefined;
  const avg: AgentSessionSummary = { id: 'average', cost: 0, turns: 0, prompts: 0, toolCalls: 0, errors: 0, spanMs: 0, outputTokens: 0, peakContext: 0, filesEdited: 0 };
  for (const k of NUMERIC) avg[k] = list.reduce((sum, x) => sum + x[k], 0) / list.length;
  return avg;
}

/** The newest other transcripts in the folder of a session file (same project). */
export function siblingFiles(file: string): Array<{ id: string; file: string; mtime: number }> {
  const dir = dirname(file);
  const self = basename(file);
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.jsonl') && n !== self)
      .map((n) => ({ id: n.slice(0, -'.jsonl'.length), file: join(dir, n), mtime: statSync(join(dir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_SIBLINGS);
  } catch {
    return [];
  }
}

function firstPromptOf(file: string): string | undefined {
  try {
    const head = readFileSync(file, 'utf8').slice(0, PROMPT_BYTES);
    return parseTrace(head).find((x) => x.kind === 'user' && !x.source && !x.sidechain)?.label;
  } catch {
    return undefined;
  }
}

export function siblingList(file: string): AgentSiblingSession[] {
  return siblingFiles(file).map(({ id, file: f, mtime }) => {
    const prompt = firstPromptOf(f);
    return { id, mtime, ...(prompt ? { prompt } : {}) };
  });
}

export function summaryOfFile(id: string, file: string): AgentSessionSummary | undefined {
  try {
    return summaryOf(id, parseTrace(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}
