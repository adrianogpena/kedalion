import type { AgentTraceNotice, AgentTraceStep, AgentTraceSubagent, AgentTraceTodo } from '../protocol.ts';

const MAX_RESULT = 2000;
const MAX_PROMPT = 4000;
const MAX_TARGET = 300;
const DENIED = /doesn't want to proceed|tool use was rejected|permission to use .* has been denied|was denied by/i;
const USAGE = {
  tokens: /<(?:subagent_tokens|total_tokens)>(\d+)<|total_tokens:\s*(\d+)/,
  toolUses: /<tool_uses>(\d+)<|tool_uses:\s*(\d+)/,
  durationMs: /<duration_ms>(\d+)<|duration_ms:\s*(\d+)/,
};

const usageOf = (text: string, key: keyof typeof USAGE): number | undefined => {
  const m = USAGE[key].exec(text);
  const v = m?.[1] ?? m?.[2];
  return v === undefined ? undefined : Number(v);
};

const tag = (text: string, name: string): string | undefined => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();

export const isSubagentTool = (name: string) => name === 'Agent' || name === 'Task';

const quoted = (src: string, key: string): string | undefined => {
  const m = new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`).exec(src);
  return m?.[2]?.replace(/\\(.)/g, '$1').trim() || undefined;
};

/** `name`, `description` and phase titles of a workflow script's `export const meta = {…}` (a pure literal). */
export function workflowMeta(script: string): { name?: string; description?: string; phases: string[] } {
  const start = script.search(/export\s+const\s+meta\s*=\s*\{/);
  if (start < 0) return { phases: [] };
  let depth = 0;
  let end = script.length;
  for (let i = script.indexOf('{', start); i < script.length; i++) {
    const c = script[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
  const src = script.slice(start, end);
  const phasesAt = src.search(/\bphases\s*:\s*\[/);
  const head = phasesAt < 0 ? src : src.slice(0, phasesAt);
  const phases = phasesAt < 0 ? [] : [...src.slice(phasesAt).matchAll(/\btitle\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]!.replace(/\\(.)/g, '$1').trim()).filter(Boolean);
  const name = quoted(head, 'name');
  const description = quoted(head, 'description');
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), phases };
}

/** Step fields only a tool's input carries: todo list, launched subagent, web target. */
export function inputExtras(name: string, input: unknown): Partial<AgentTraceStep> {
  const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  if (name === 'TodoWrite' && Array.isArray(rec.todos)) {
    const todos = (rec.todos as Array<Record<string, unknown>>).flatMap((x): AgentTraceTodo[] => {
      const content = str(x?.content) ?? str(x?.subject);
      const status = x?.status === 'completed' || x?.status === 'in_progress' ? x.status : 'pending';
      return content ? [{ content, status }] : [];
    });
    return { todos };
  }
  if (isSubagentTool(name)) {
    const prompt = str(rec.prompt);
    const sub: AgentTraceSubagent = {
      ...(str(rec.subagent_type) ? { type: str(rec.subagent_type) } : {}),
      ...(str(rec.description) ? { description: str(rec.description) } : {}),
      ...(str(rec.model) ? { model: str(rec.model) } : {}),
      ...(prompt ? { prompt: prompt.slice(0, MAX_PROMPT) } : {}),
      ...(rec.run_in_background === true ? { background: true } : {}),
    };
    return { subagent: sub };
  }
  if (name === 'Workflow') {
    const meta = workflowMeta(str(rec.script) ?? '');
    const saved = str(rec.name) ?? (str(rec.scriptPath) ? /([^/\\]+?)(?:-wf_[\w-]+)?\.js$/.exec(str(rec.scriptPath)!)?.[1] : undefined);
    const wfName = meta.name ?? saved;
    return {
      subagent: {
        type: 'workflow',
        background: true,
        ...(meta.description ? { description: meta.description } : wfName ? { description: wfName } : {}),
        workflow: { ...(wfName ? { name: wfName } : {}), ...(meta.phases.length > 0 ? { phases: meta.phases } : {}) },
      },
    };
  }
  if (name === 'WebFetch' || name === 'WebSearch') {
    const target = str(rec.url) ?? str(rec.query);
    return target ? { target: target.slice(0, MAX_TARGET) } : {};
  }
  return {};
}

/** Fields a tool result adds: Bash exit code, permission denial, subagent outcome. */
export function resultExtras(step: AgentTraceStep, text: string, err: boolean, toolUseResult?: unknown): void {
  const tur = toolUseResult && typeof toolUseResult === 'object' ? (toolUseResult as Record<string, unknown>) : {};
  const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,80}$/.test(v) ? v : undefined);
  if (step.subagent) {
    const agentId = id(tur.agentId);
    if (agentId) step.subagent.agentId = agentId;
    if (step.subagent.workflow) {
      const runId = id(tur.runId) ?? /Run ID: (wf_[\w-]+)/.exec(text)?.[1];
      if (runId) step.subagent.workflow.runId = runId;
      if (!step.subagent.workflow.name && typeof tur.workflowName === 'string' && tur.workflowName) step.subagent.workflow.name = tur.workflowName;
    }
  }
  if (step.tool === 'Bash' && err) {
    const m = /Exit code (\d+)/.exec(text);
    if (m) step.exitCode = Number(m[1]);
  }
  if (err && DENIED.test(text)) step.marker = 'denied';
  if (step.subagent && !step.subagent.workflow) {
    const sub = step.subagent;
    sub.result = text.slice(0, MAX_RESULT);
    if (/output_file:/.test(text)) sub.background = true;
    const tokens = usageOf(text, 'tokens');
    const toolUses = usageOf(text, 'toolUses');
    const durationMs = usageOf(text, 'durationMs');
    if (tokens !== undefined) sub.tokens = tokens;
    if (toolUses !== undefined) sub.toolUses = toolUses;
    if (durationMs !== undefined) sub.durationMs = durationMs;
  }
}

/** Marker of a user entry the person did not type as a prompt. */
export function userMarker(text: string): AgentTraceStep['marker'] {
  if (text.startsWith('[Request interrupted by user')) return 'interrupt';
  if (text.startsWith('This session is being continued from a previous')) return 'continued';
  return undefined;
}

/** The background agent a `<task-notification>` turn reports on. */
export function noticeOf(text: string): AgentTraceNotice | undefined {
  if (!text.includes('<task-notification>')) return undefined;
  const toolUseId = tag(text, 'tool-use-id');
  if (!toolUseId) return undefined;
  const status = tag(text, 'status');
  const summary = tag(text, 'summary');
  const tokens = usageOf(text, 'tokens');
  const toolUses = usageOf(text, 'toolUses');
  const durationMs = usageOf(text, 'durationMs');
  const result = tag(text, 'result');
  return { toolUseId, ...(status ? { status } : {}), ...(summary ? { summary } : {}), ...(result ? { result: result.slice(0, MAX_RESULT) } : {}),...(tokens !== undefined ? { tokens } : {}), ...(toolUses !== undefined ? { toolUses } : {}), ...(durationMs !== undefined ? { durationMs } : {}) };
}
