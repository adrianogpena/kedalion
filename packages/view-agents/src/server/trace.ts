import { readFileSync } from 'node:fs';
import { contextPercentOf } from './discovery.ts';
import type { AgentTraceEdit, AgentTraceStep } from '../protocol.ts';
import { costParts } from './pricing.ts';
import { shellFileOps } from './shell-files.ts';
import { inputExtras, noticeOf, resultExtras, userMarker } from './trace-extras.ts';

const MAX_LABEL = 72;
const PRIMARY_KEYS = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description'];

const cap = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
const SHELL_TAG = /^<bash-(input|stdout|stderr)>/;

/** Readable text of a `! cmd` turn: `! cmd` for the input, the plain output for stdout/stderr. */
function shellText(text: string): string {
  const input = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)?.[1];
  if (input !== undefined) return `! ${input.trim()}`;
  const out = text
    .replace(/<\/?bash-(stdout|stderr)>/g, '\n')
    .trim();
  return out || '(no output)';
}

/** Who really wrote a `user` transcript entry, when it was not the person. */
function userSource(e: { isMeta?: boolean; origin?: { kind?: string } }, text: string): AgentTraceStep['source'] {
  if (text.startsWith('Base directory for this skill')) return 'skill';
  if (SHELL_TAG.test(text)) return 'shell';
  const kind = e.origin?.kind;
  if (kind === 'peer') return 'agent';
  if (kind === 'task-notification') return 'task';
  if (text.startsWith('[Request interrupted by user')) return 'system';
  if (/^<local-command-(stdout|stderr|caveat)>/.test(text) || text.startsWith('This session is being continued from a previous')) return 'system';
  if (e.isMeta || (kind !== undefined && kind !== 'human')) return 'system';
  return undefined;
}

const MAX_HITS = 300;

function readRangeOf(rec: Record<string, unknown>): { offset?: number; limit?: number } | undefined {
  const offset = typeof rec.offset === 'number' ? rec.offset : undefined;
  const limit = typeof rec.limit === 'number' ? rec.limit : undefined;
  return offset === undefined && limit === undefined ? undefined : { ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) };
}

/** File paths listed in a Grep / Glob result (`path`, or `path:line:text` in content mode). */
function hitsOf(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || !/^([A-Za-z]:)?[\\/]/.test(line)) continue;
    const m = /^((?:[A-Za-z]:)?[^:]+?)(?::\d+[:-].*)?$/.exec(line);
    const p = m?.[1]?.trim();
    if (p) seen.add(p);
    if (seen.size >= MAX_HITS) break;
  }
  return [...seen];
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
export function parseTrace(jsonl: string, windowOf?: (model: string) => number | undefined, out?: { cwd?: string }): AgentTraceStep[] {
  const steps: AgentTraceStep[] = [];
  const tools = new Map<string, AgentTraceStep>();
  const usageSeen = new Set<string>();
  let prevTs: number | undefined;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let e: { type?: string; cwd?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; origin?: { kind?: string }; message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, unknown> } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (out && !out.cwd && typeof e?.cwd === 'string') out.cwd = e.cwd;
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
          resultExtras(step, text, err);
          if ((step.tool === 'Grep' || step.tool === 'Glob') && !err) {
            const hits = hitsOf(text);
            if (hits.length > 0) step.hits = hits;
          }
          if (ts !== undefined && step.ts !== undefined && ts >= step.ts) step.durationMs = ts - step.ts;
          if (err) step.error = true;
        }
      }
      const text = textOf(content).trim();
      if (text) {
        const source = userSource(e, text);
        const shown = source === 'shell' ? shellText(text) : text;
        const marker = userMarker(text);
        const notice = noticeOf(text);
        steps.push({ kind: 'user', label: firstLine(shown), detail: shown, ...(source ? { source } : {}), ...(marker ? { marker } : {}), ...(notice ? { notice } : {}), ...base });
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
        const tk = { input, output: num(u.output_tokens), cacheRead, cacheWrite };
        const cost = costParts(e.message?.model, tk);
        meta = { tokens: tk, ...(cost ? { cost } : {}), context: input + cacheRead + cacheWrite, ...(contextPercentOf(e.message?.model, input + cacheRead + cacheWrite, e.message?.model ? windowOf?.(e.message.model) : undefined) !== undefined ? { contextPercent: contextPercentOf(e.message?.model, input + cacheRead + cacheWrite, e.message?.model ? windowOf?.(e.message.model) : undefined) } : {}), ...(e.message?.model ? { model: e.message.model } : {}) };
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
          const range = name === 'Read' ? readRangeOf(rec) : undefined;
          const command = name === 'Bash' && typeof rec.command === 'string' ? rec.command : undefined;
          const shellFiles = command ? shellFileOps(command, e.cwd ?? out?.cwd) : [];
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
            ...(range ? { readRange: range } : {}),
            ...(shellFiles.length > 0 ? { shellFiles } : {}),
            ...inputExtras(name, b.input),
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
  return readTraceFull(file, windowOf).steps;
}

export function readTraceFull(file: string, windowOf?: (model: string) => number | undefined): { steps: AgentTraceStep[]; cwd?: string } {
  try {
    const out: { cwd?: string } = {};
    const steps = parseTrace(readFileSync(file, 'utf8'), windowOf, out);
    return { steps, ...(out.cwd ? { cwd: out.cwd } : {}) };
  } catch {
    return { steps: [] };
  }
}
