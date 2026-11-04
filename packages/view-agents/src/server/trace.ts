import { readFileSync } from 'node:fs';
import { contextPercentOf } from './discovery.ts';
import type { AgentTraceEdit, AgentTraceStep } from '../protocol.ts';

const MAX_LABEL = 72;
const PRIMARY_KEYS = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description'];

const cap = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
/** Who really wrote a `user` transcript entry, when it was not the person. */
function userSource(e: { isMeta?: boolean; origin?: { kind?: string } }, text: string): AgentTraceStep['source'] {
  if (text.startsWith('Base directory for this skill')) return 'skill';
  const kind = e.origin?.kind;
  if (kind === 'peer') return 'agent';
  if (kind === 'task-notification') return 'task';
  if (/^<local-command-(stdout|stderr|caveat)>/.test(text) || text.startsWith('This session is being continued from a previous')) return 'system';
  if (e.isMeta || (kind !== undefined && kind !== 'human')) return 'system';
  return undefined;
}

const firstLine = (s: string) => cap(s.trim().split('\n')[0]!.trim());

interface Block {
  type?: string;
  text?: unknown;
  id?: string;
  name?: unknown;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: unknown;
  thinking?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: Block) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: Block) => b.text as string)
    .join('\n\n');
}

function toolLabel(name: unknown, input: unknown): string {
  const n = typeof name === 'string' && name ? name : 'tool';
  let arg = '';
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    const key = PRIMARY_KEYS.find((k) => rec[k] !== undefined && rec[k] !== null);
    const v = key ? rec[key] : undefined;
    if (typeof v === 'string' && v) arg = v.replace(/\s+/g, ' ').trim();
  }
  return cap(arg ? `${n}(${arg})` : n);
}

const MAX_EDIT = 20_000;
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const capEdit = (s: unknown) => (typeof s === 'string' ? (s.length > MAX_EDIT ? `${s.slice(0, MAX_EDIT)}\n…` : s) : '');

function editsOf(name: string, input: unknown): AgentTraceEdit[] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  if (name === 'Edit') return [{ old: capEdit(i.old_string), new: capEdit(i.new_string) }];
  if (name === 'Write') return [{ old: '', new: capEdit(i.content) }];
  if (name === 'MultiEdit' && Array.isArray(i.edits)) {
    return (i.edits as Array<Record<string, unknown>>).map((x) => ({ old: capEdit(x?.old_string), new: capEdit(x?.new_string) }));
  }
  return undefined;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Ordered steps (user prompts, assistant replies, tool calls with their results) of a session jsonl. */
export function parseTrace(jsonl: string, windowOf?: (model: string) => number | undefined): AgentTraceStep[] {
  const steps: AgentTraceStep[] = [];
  const tools = new Map<string, AgentTraceStep>();
  const usageSeen = new Set<string>();
  let prevTs: number | undefined;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let e: { type?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; origin?: { kind?: string }; message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, unknown> } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e?.message?.content;
    const parsedTs = e?.timestamp ? Date.parse(e.timestamp) : Number.NaN;
    const ts = Number.isFinite(parsedTs) ? parsedTs : undefined;
    const sidechain = e?.isSidechain === true ? true : undefined;
    const since = ts !== undefined && prevTs !== undefined && ts >= prevTs ? ts - prevTs : undefined;
    const base = { ...(ts !== undefined ? { ts } : {}), ...(sidechain ? { sidechain } : {}) };
    if (e?.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content as Block[]) {
          if (b?.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
          const step = tools.get(b.tool_use_id);
          if (!step) continue;
          const text = textOf(b.content).trim();
          const err = !!b.is_error;
          step.detail += `\n\n${err ? 'Error:' : 'Result:'} ${text || '(empty)'}`;
          delete step.pending;
          step.resultChars = text.length;
          if (ts !== undefined && step.ts !== undefined && ts >= step.ts) step.durationMs = ts - step.ts;
          if (err) step.error = true;
        }
      }
      const text = textOf(content).trim();
      if (text) {
        const source = userSource(e, text);
        steps.push({ kind: 'user', label: firstLine(text), detail: text, ...(source ? { source } : {}), ...base });
      }
      if (ts !== undefined) prevTs = ts;
    } else if (e?.type === 'assistant') {
      const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      const before = steps.length;
      const u = e.message?.usage;
      const mid = e.message?.id;
      let meta: Partial<AgentTraceStep> | undefined;
      if (u && (!mid || !usageSeen.has(mid))) {
        if (mid) usageSeen.add(mid);
        const input = num(u.input_tokens);
        const cacheRead = num(u.cache_read_input_tokens);
        const cacheWrite = num(u.cache_creation_input_tokens);
        meta = { tokens: { input, output: num(u.output_tokens), cacheRead, cacheWrite }, context: input + cacheRead + cacheWrite, ...(contextPercentOf(e.message?.model, input + cacheRead + cacheWrite, e.message?.model ? windowOf?.(e.message.model) : undefined) !== undefined ? { contextPercent: contextPercentOf(e.message?.model, input + cacheRead + cacheWrite, e.message?.model ? windowOf?.(e.message.model) : undefined) } : {}), ...(e.message?.model ? { model: e.message.model } : {}) };
      }
      const take = (): Partial<AgentTraceStep> => {
        const m = meta;
        meta = undefined;
        return { ...base, ...(mid ? { messageId: mid } : {}), ...(m ?? {}) };
      };
      for (const b of blocks) {
        if (b?.type === 'thinking') {
          const text = typeof b.thinking === 'string' ? b.thinking.trim() : '';
          if (text) steps.push({ kind: 'thinking', label: firstLine(text), detail: text, ...take() });
        } else if (b?.type === 'text' && typeof b.text === 'string') {
          const text = b.text.trim();
          if (text) steps.push({ kind: 'assistant', label: firstLine(text), detail: text, ...take() });
        } else if (b?.type === 'tool_use') {
          const name = typeof b.name === 'string' && b.name ? b.name : 'tool';
          const rec = b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {};
          const file = FILE_TOOLS.has(name) ? [rec.file_path, rec.notebook_path].find((v): v is string => typeof v === 'string' && !!v) : undefined;
          const edits = editsOf(name, b.input);
          const command = name === 'Bash' && typeof rec.command === 'string' ? rec.command : undefined;
          const step: AgentTraceStep = {
            kind: 'tool',
            label: toolLabel(b.name, b.input),
            detail: `${name}\n${b.input === undefined ? 'undefined' : JSON.stringify(b.input, null, 2)}`,
            tool: name,
            pending: true,
            ...(typeof b.id === 'string' ? { toolUseId: b.id } : {}),
            ...(file ? { file } : {}),
            ...(edits ? { edits } : {}),
            ...(command ? { command } : {}),
            ...take(),
          };
          steps.push(step);
          if (typeof b.id === 'string') tools.set(b.id, step);
        }
      }
      if (since !== undefined) {
        const first = steps[before];
        if (first && first.kind !== 'tool') first.durationMs = since;
      }
      if (ts !== undefined) prevTs = ts;
    }
  }
  return steps;
}

export function readTrace(file: string, windowOf?: (model: string) => number | undefined): AgentTraceStep[] {
  try {
    return parseTrace(readFileSync(file, 'utf8'), windowOf);
  } catch {
    return [];
  }
}
