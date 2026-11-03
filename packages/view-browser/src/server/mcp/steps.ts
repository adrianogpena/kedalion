import type { NetworkEntry } from '@kedalion/cdp';
import { summarizeRequest } from '../../ops.ts';

export const STEP_CAP = 500;
const SUMMARY_CAP = 120;

export interface Step {
  n: number;
  tool: string;
  args: string;
  ok: boolean;
  ms: number;
  at: string;
  result: string;
  requests: string[];
  consoleErrors: number;
}

interface Mark {
  name: string;
  /** Step number the run starts at. */
  from: number;
}

export interface StepLog {
  steps: Step[];
  marks: Mark[];
  seq: number;
  networkMarks: Map<string, number>;
}

export const createStepLog = (): StepLog => ({ steps: [], marks: [], seq: 0, networkMarks: new Map() });

const oneLine = (s: string, cap: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > cap ? `${t.slice(0, cap - 3)}...` : t;
};

export const summarizeArgs = (args: Record<string, unknown>): string => {
  const { tab: _tab, ...rest } = args;
  return Object.keys(rest).length ? oneLine(JSON.stringify(rest), SUMMARY_CAP) : '';
};

export const summarizeResult = (text: string): string => oneLine(text, SUMMARY_CAP);

/** Stable description of a request for run comparison (no ids, no timing). */
export function describeRequest(e: NetworkEntry, postData?: string): string {
  let path = e.url;
  try {
    const u = new URL(e.url);
    path = u.pathname + u.search;
  } catch {
    // keep the raw url
  }
  const ops = summarizeRequest({ url: e.url, postData });
  return `${e.method} ${e.status ?? (e.failed ? 'FAILED' : '...')} ${path}${ops ? `  [${ops}]` : ''}`;
}

export function addStep(log: StepLog, s: Omit<Step, 'n'>): Step {
  const step = { ...s, n: ++log.seq };
  log.steps.push(step);
  while (log.steps.length > STEP_CAP) log.steps.shift();
  return step;
}

export function startRun(log: StepLog, name: string): void {
  log.marks = log.marks.filter((m) => m.name !== name);
  log.marks.push({ name, from: log.seq + 1 });
}

/** Steps of the named run: from its mark up to the next mark that started after it. */
export function runSteps(log: StepLog, name: string): Step[] | undefined {
  const mark = log.marks.find((m) => m.name === name);
  if (!mark) return undefined;
  const next = log.marks.filter((m) => m.from > mark.from).reduce((min, m) => Math.min(min, m.from), Infinity);
  return log.steps.filter((s) => s.n >= mark.from && s.n < next);
}

const sameStep = (a: Step, b: Step) => a.tool === b.tool && a.args === b.args;

/** Differences between two runs, compared step by step in order. */
export function diffRuns(a: readonly Step[], b: readonly Step[]): string {
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    const label = `step ${i + 1}`;
    if (!x) {
      out.push(`${label}: only in b: ${y!.tool} ${y!.args}`);
      continue;
    }
    if (!y) {
      out.push(`${label}: only in a: ${x.tool} ${x.args}`);
      continue;
    }
    if (!sameStep(x, y)) {
      out.push(`${label}: different call: a=${x.tool} ${x.args} | b=${y.tool} ${y.args}`);
      continue;
    }
    const diffs: string[] = [];
    if (x.ok !== y.ok) diffs.push(`ok a=${x.ok} b=${y.ok}`);
    else if (x.result !== y.result) diffs.push(`result a="${x.result}" b="${y.result}"`);
    if (x.consoleErrors !== y.consoleErrors) diffs.push(`console errors a=${x.consoleErrors} b=${y.consoleErrors}`);
    const onlyA = x.requests.filter((r) => !y.requests.includes(r));
    const onlyB = y.requests.filter((r) => !x.requests.includes(r));
    for (const r of onlyA) diffs.push(`request only in a: ${r}`);
    for (const r of onlyB) diffs.push(`request only in b: ${r}`);
    if (diffs.length) out.push(`${label} (${x.tool} ${x.args}): ${diffs.join('; ')}`);
  }
  return out.length ? out.join('\n') : `No differences in ${max} step${max === 1 ? '' : 's'}.`;
}

export function renderSteps(steps: readonly Step[], format: 'json' | 'md'): string {
  if (format === 'json') return JSON.stringify(steps, null, 2);
  const lines = ['# Browser steps', ''];
  for (const s of steps) {
    lines.push(`## ${s.n}. ${s.tool}${s.args ? ` ${s.args}` : ''}`, '', `- ${s.ok ? 'ok' : 'error'}, ${s.ms}ms, ${s.at}, console errors: ${s.consoleErrors}`, `- result: ${s.result}`);
    for (const r of s.requests) lines.push(`- request: ${r}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderStepLine(s: Step): string {
  return `#${s.n} ${s.tool}${s.args ? ` ${s.args}` : ''} ${s.ok ? 'ok' : 'ERROR'} ${s.ms}ms${s.requests.length ? ` req:${s.requests.length}` : ''}${s.consoleErrors ? ` consoleErrors:${s.consoleErrors}` : ''} -> ${s.result}`;
}

const logs = new WeakMap<object, StepLog>();
/** The step log of a browser service (one per session). */
export function stepLogFor(service: object): StepLog {
  let log = logs.get(service);
  if (!log) logs.set(service, (log = createStepLog()));
  return log;
}
