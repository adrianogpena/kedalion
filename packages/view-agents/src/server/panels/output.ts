import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ndjson, notFound } from '@kedalion/server-core';
import { findSessionFile } from '../chat/normalize.ts';
import { encodeFolderName } from '../discovery.ts';
import type { PanelRoutes } from './ctx.ts';

/** Last bytes kept of any output, and of the transcript tail that is searched. */
export const MAX_OUTPUT = 200_000;
const TRANSCRIPT_TAIL = 2_000_000;
/** A background command whose output file has not changed for this long, with no completion notice, counts as done (fallback only). */
const BG_IDLE_MS = 15_000;
/** Runs kept per session. */
export const MAX_RUNS = 20;
/** The push stream looks at the files this often, and re-reads everything at least every `REFRESH_MS` (idle transitions). */
const WATCH_MS = 300;
const REFRESH_MS = 3_000;

export type OutputStatus = 'running' | 'done' | 'error';

export interface BashRun {
  toolUseId: string;
  command: string;
  background: boolean;
  /** Text of the tool_result; undefined while the call has no result yet. */
  result?: string;
  isError: boolean;
  /** Background only: id of the task and the file its output is written to (both from the early result). */
  taskId?: string;
  outputFile?: string;
  /** Background only: a later notice, BashOutput or KillShell says the task ended. */
  ended: boolean;
  /** Background only: the ending says it failed (status or exit code). */
  failed?: boolean;
  /** Exit code when the transcript says it (a BashOutput result, or "Exit code N" of a failed call). */
  exitCode?: number;
  /** Latest stdout/stderr a BashOutput call returned: shown when the output file is gone. */
  polled?: string;
  /** ms epoch of the call, and of its result or ending. */
  startedAt?: number;
  endedAt?: number;
}

export interface OutputState {
  command: string;
  status: OutputStatus;
  output: string;
  /** The output was cut to its last `MAX_OUTPUT` characters. */
  truncated: boolean;
  toolUseId: string;
  background: boolean;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  /** Where `output` came from. */
  source: 'result' | 'file' | 'live' | 'poll';
  /** Size of the transcript read; the client can tell nothing changed when it repeats. */
  offset: number;
}

export interface RunSummary {
  toolUseId: string;
  command: string;
  background: boolean;
  status: OutputStatus;
  startedAt?: number;
}

export interface OutputPayload {
  run: OutputState | null;
  /** Newest first, at most `MAX_RUNS`. */
  runs: RunSummary[];
  /** The live log of the session exists (the PreToolUse hook is installed). */
  live: boolean;
  /** Command to put in the hook setting. */
  hook: string;
}

const ENDED = /<status>\s*(completed|failed|killed|stopped|error)/i;
// eslint-disable-next-line no-control-regex
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// eslint-disable-next-line no-control-regex
const CSI_NOT_SGR = /\u001b\[[0-9;?]*[ -/]*[@-ln-~]/g;

/** The output with every escape except the colors (SGR) removed, and its last `MAX_OUTPUT` characters. */
export function cleanOutput(s: string): string {
  return capOutput(s).output;
}

export function capOutput(s: string): { output: string; truncated: boolean } {
  const out = s.replace(OSC, '').replace(CSI_NOT_SGR, '');
  return out.length > MAX_OUTPUT ? { output: out.slice(-MAX_OUTPUT), truncated: true } : { output: out, truncated: false };
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b: { type?: string; text?: unknown }) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
};

const tag = (text: string, name: string): string | undefined => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1];

/** A BashOutput result or completion notice for a background run. */
function applyPoll(run: BashRun, text: string, at: number | undefined): void {
  const stdout = tag(text, 'stdout');
  const stderr = tag(text, 'stderr');
  const polled = [stdout, stderr].filter((x) => x && x.trim()).join('\n');
  if (polled) run.polled = polled;
  const status = /<status>\s*(\w+)/i.exec(text)?.[1]?.toLowerCase();
  const code = /<exit_code>\s*(-?\d+)/.exec(text)?.[1];
  if (code !== undefined) run.exitCode = Number(code);
  if (status && ENDED.test(`<status>${status}`)) {
    run.ended = true;
    run.endedAt ??= at;
    run.failed = status === 'failed' || status === 'error' || (run.exitCode !== undefined && run.exitCode !== 0);
  }
}

/** The Bash tool calls of a transcript, oldest first (the last `MAX_RUNS`), each paired with its result and later BashOutput / KillShell calls. */
export function parseRuns(jsonl: string): BashRun[] {
  const runs: BashRun[] = [];
  const byId = new Map<string, BashRun>();
  const byTask = new Map<string, BashRun>();
  const followUps = new Map<string, BashRun>();
  const notice = (text: string, at: number | undefined) => {
    if (!ENDED.test(text)) return;
    for (const [id, r] of byTask) if (!r.ended && text.includes(id)) applyPoll(r, text, at);
  };
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry: { timestamp?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    const at = Number.isNaN(parsed) ? undefined : parsed;
    const content = entry.message?.content;
    if (typeof content === 'string') {
      notice(content, at);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<Record<string, unknown>>) {
      if (b?.type === 'tool_use' && b.name === 'Bash') {
        const input = (b.input ?? {}) as { command?: unknown; run_in_background?: unknown };
        const run: BashRun = { toolUseId: String(b.id ?? ''), command: typeof input.command === 'string' ? input.command : '', background: input.run_in_background === true, isError: false, ended: false, startedAt: at };
        runs.push(run);
        byId.set(run.toolUseId, run);
      } else if (b?.type === 'tool_use' && typeof b.name === 'string' && /^(BashOutput|KillShell|KillBash|TaskOutput|TaskStop)$/.test(b.name)) {
        const input = (b.input ?? {}) as Record<string, unknown>;
        const id = [input.shell_id, input.bash_id, input.task_id].find((x) => typeof x === 'string') as string | undefined;
        const target = id ? byTask.get(id) : undefined;
        if (!target) continue;
        followUps.set(String(b.id ?? ''), target);
        if (/^(KillShell|KillBash|TaskStop)$/.test(b.name)) {
          target.ended = true;
          target.endedAt ??= at;
        }
      } else if (b?.type === 'tool_result') {
        const id = String(b.tool_use_id ?? '');
        const text = textOf(b.content);
        const run = byId.get(id);
        const follow = followUps.get(id);
        if (run) {
          run.result = text;
          run.isError = b.is_error === true;
          if (run.background) {
            run.taskId = /\bID:\s*([\w-]+)/.exec(text)?.[1];
            run.outputFile = /(?:written to|output file|Output is being written to):?\s*(\S+)/i.exec(text)?.[1]?.replace(/[.,;]$/, '');
            if (run.taskId) byTask.set(run.taskId, run);
          } else {
            run.endedAt = at;
            if (run.isError) run.exitCode = Number(/^Exit code (\d+)/.exec(text)?.[1] ?? 1);
            else run.exitCode = 0;
          }
        } else if (follow) {
          applyPoll(follow, text, at);
        } else {
          notice(text, at);
        }
      } else if (b?.type === 'text' && typeof b.text === 'string') {
        notice(b.text, at);
      }
    }
  }
  return runs.slice(-MAX_RUNS);
}

/** The most recent Bash tool call of a transcript, paired with its result; undefined when there is none. Other tools never change it. */
export function lastBashRun(jsonl: string): BashRun | undefined {
  return parseRuns(jsonl).at(-1);
}

function readTail(file: string, max: number): { text: string; size: number } {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - max);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return { text, size };
  } finally {
    closeSync(fd);
  }
}

/** The file the PreToolUse hook (`scripts/live-output-hook.ts`) tees a session's foreground output to. */
export const liveLogPath = (agentsDir: string, sessionId: string): string => join(agentsDir, 'live', `${sessionId.replace(/[^\w-]/g, '_')}.log`);

/** A background output file must lie in a `tasks` folder under the system temp dir (where Claude writes it). */
export function isTaskOutputFile(file: string): boolean {
  const rel = relative(resolve(tmpdir()), resolve(file));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  return rel.split(/[\\/]/).slice(0, -1).includes('tasks');
}

export interface StateOptions {
  /** Live log file of the session; only the latest run uses it. */
  live?: string;
  /** The run is the newest of the session (default); an older call without a result was interrupted. */
  latest?: boolean;
}

/**
 * What the panel shows for a run. Foreground: the live log while it runs (when the hook wrote one), then the result.
 * Background: the output file tail, running until a completion notice, BashOutput, a kill, or (fallback) the file idles for `BG_IDLE_MS`.
 */
export function stateOf(run: BashRun, offset: number, now = Date.now(), opts: StateOptions = {}): OutputState {
  const latest = opts.latest ?? true;
  const base = { command: run.command, toolUseId: run.toolUseId, background: run.background, startedAt: run.startedAt, endedAt: run.endedAt, offset };
  if (run.background) {
    let text = '';
    let source: OutputState['source'] = 'poll';
    let idle = Infinity;
    if (run.outputFile && isTaskOutputFile(run.outputFile) && existsSync(run.outputFile)) {
      try {
        text = readTail(run.outputFile, MAX_OUTPUT * 2).text;
        idle = now - statSync(run.outputFile).mtimeMs;
        source = 'file';
      } catch {
        /* file vanished: keep what we have */
      }
    }
    if (source === 'poll') text = run.polled ?? '';
    const running = run.result !== undefined && !run.ended && (source === 'file' ? idle < BG_IDLE_MS : latest);
    const failed = run.isError || run.failed === true;
    return { ...base, status: running || (run.result === undefined && latest) ? 'running' : failed ? 'error' : 'done', ...capOutput(text), source, exitCode: run.exitCode };
  }
  if (run.result === undefined) {
    if (latest && opts.live && existsSync(opts.live)) {
      try {
        const fresh = statSync(opts.live).mtimeMs >= (run.startedAt ?? 0) - 2000;
        if (fresh) return { ...base, status: 'running', ...capOutput(readTail(opts.live, MAX_OUTPUT * 2).text), source: 'live' };
      } catch {
        /* fall through */
      }
    }
    return { ...base, status: latest ? 'running' : 'error', output: '', truncated: false, source: 'result' };
  }
  return { ...base, status: run.isError ? 'error' : 'done', ...capOutput(run.result), source: 'result', exitCode: run.exitCode };
}

const summaryStatus = (run: BashRun, latest: boolean): OutputStatus => {
  if (run.result === undefined && !run.background) return latest ? 'running' : 'error';
  if (run.background && !run.ended) return latest ? 'running' : 'done';
  return run.isError || run.failed ? 'error' : 'done';
};

/** The newest transcript of a project across the accounts (`sessionId` picks one instead). */
export function newestTranscript(accountDirs: string[], project: string, sessionId?: string): string | undefined {
  if (sessionId) {
    for (const dir of accountDirs) {
      const f = findSessionFile(dir, sessionId);
      if (f) return f;
    }
    return undefined;
  }
  const folder = encodeFolderName(project).toLowerCase();
  let best: { file: string; mtime: number } | undefined;
  for (const dir of accountDirs) {
    const root = join(dir, 'projects');
    let names: string[] = [];
    try {
      names = readdirSync(root).filter((n) => n.toLowerCase() === folder);
    } catch {
      continue;
    }
    for (const n of names) {
      let files: string[] = [];
      try {
        files = readdirSync(join(root, n)).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const file = join(root, n, f);
        const mtime = statSync(file).mtimeMs;
        if (!best || mtime > best.mtime) best = { file, mtime };
      }
    }
  }
  return best?.file;
}

/** The hook command to show: the script path when it ships next to the sources, else a placeholder. */
function hookCommand(agentsDir: string): string {
  let script = '<path-to>/live-output-hook.ts';
  try {
    const p = fileURLToPath(new URL('../../../scripts/live-output-hook.ts', import.meta.url));
    if (existsSync(p)) script = p.replace(/\\/g, '/');
  } catch {
    /* bundled build: keep the placeholder */
  }
  return `bun "${script}" "${agentsDir.replace(/\\/g, '/')}"`;
}

const stamp = (file: string | undefined): string => {
  if (!file) return '-';
  try {
    const s = statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return '-';
  }
};

export interface OutputQuery {
  accountDirs: string[];
  agentsDir: string;
  project: string;
  sessionId?: string;
  /** Run to show (a pinned older one); the latest when absent or gone. */
  toolUseId?: string;
}

/** The payload of a request and the files it was read from (a change of any of them is a reason to read again). */
export function buildPayload(q: OutputQuery, now = Date.now()): { payload: OutputPayload; files: string[] } {
  const hook = hookCommand(q.agentsDir);
  const file = newestTranscript(q.accountDirs, q.project, q.sessionId);
  if (!file) return { payload: { run: null, runs: [], live: false, hook }, files: [] };
  const live = liveLogPath(q.agentsDir, basename(file, '.jsonl'));
  const { text, size } = readTail(file, TRANSCRIPT_TAIL);
  const runs = parseRuns(text);
  const files = [file, live];
  const hasLive = existsSync(live);
  if (!runs.length) return { payload: { run: null, runs: [], live: hasLive, hook }, files };
  const last = runs.length - 1;
  let at = q.toolUseId ? runs.findIndex((r) => r.toolUseId === q.toolUseId) : -1;
  if (at < 0) at = last;
  const run = runs[at]!;
  if (run.outputFile && isTaskOutputFile(run.outputFile)) files.push(run.outputFile);
  const state = stateOf(run, size, now, { live, latest: at === last });
  const summaries = runs.map((r, i) => ({ toolUseId: r.toolUseId, command: r.command, background: r.background, status: i === at ? state.status : summaryStatus(r, i === last), startedAt: r.startedAt })).reverse();
  return { payload: { run: state, runs: summaries, live: hasLive, hook }, files };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Server routes of the output panel. `GET /api/agents/output?project=&sessionId=&toolUseId=` is the Bash run of the
 * session (its newest, or the pinned `toolUseId`) plus the run history; without `sessionId` the project's newest
 * transcript is used. `GET /api/agents/output/stream` is the same as ndjson that pushes a payload whenever the
 * transcript, the live log or the background output file changes.
 */
export const routes: PanelRoutes = (ctx) => {
  const query = (q: URLSearchParams): OutputQuery => {
    const project = q.get('project');
    const root = project ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('project', 'Unknown project.');
    return { accountDirs: ctx.accountDirs?.() ?? [], agentsDir: ctx.agentsDir, project: root, sessionId: q.get('sessionId') || undefined, toolUseId: q.get('toolUseId') || undefined };
  };
  return {
    'GET /api/agents/output': ({ query: q }) => buildPayload(query(q)).payload,
    'GET /api/agents/output/stream': ({ req, query: q }) => {
      const oq = query(q);
      return ndjson(req, async (emit, signal) => {
        let sig = '';
        let sent = '';
        let last = 0;
        let files: string[] = [];
        while (!signal.aborted) {
          const now = Date.now();
          const cur = files.map(stamp).join('|');
          if (cur !== sig || now - last >= REFRESH_MS) {
            const built = buildPayload(oq, now);
            files = built.files;
            sig = files.map(stamp).join('|');
            last = now;
            const json = JSON.stringify(built.payload);
            if (json !== sent) {
              sent = json;
              await emit(built.payload);
            }
          }
          await sleep(WATCH_MS);
        }
      });
    },
  };
};
