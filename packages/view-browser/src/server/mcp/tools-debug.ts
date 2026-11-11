import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type CdpClient, connectCdp, previewValue } from '@kedalion/cdp';
import { breakpointCondition, filterScripts, formatTraceSummary, type PausedState, resolveScriptUrl, summarizeTrace, type TraceEvent } from './debug-state.ts';
import { describeEval, EVAL_TIMEOUT_MS, num, resolveTab, str, withTimeout } from './page-util.ts';
import { failResult, type McpTool, textResult, type ToolContext, type ToolSchema } from './types.ts';

const TAB = { type: 'string', description: 'Tab id from browser_tabs; default the active tab.' } as const;
const schema = (properties: ToolSchema['properties'], required: string[] = []): ToolSchema => ({
  type: 'object',
  properties: { ...properties, tab: TAB },
  ...(required.length ? { required } : {}),
});

const MAX_FRAMES = 10;
const STEPS = { resume: 'Debugger.resume', over: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut' } as const;

/** A tab with the Debugger domain enabled. */
async function debugTab(ctx: ToolContext, args: Record<string, unknown>) {
  const tab = await resolveTab(ctx, args);
  const session = ctx.service.tabs().session(tab);
  await ctx.debug.enable(tab, session);
  return { tab, session };
}

const frameLine = (f: any, i: number) => `#${i} ${f.functionName || '(anonymous)'}  ${f.url || `script ${f.location?.scriptId}`}:${(f.location?.lineNumber ?? 0) + 1}:${(f.location?.columnNumber ?? 0) + 1}`;

async function describePaused(session: { send(m: string, p?: object): Promise<any> }, p: PausedState): Promise<string> {
  const lines = [`Paused: ${p.reason}${p.hitBreakpoints.length ? ` (breakpoints ${p.hitBreakpoints.join(', ')})` : ''}`, 'Call stack:'];
  p.callFrames.slice(0, MAX_FRAMES).forEach((f, i) => lines.push(frameLine(f, i)));
  if (p.callFrames.length > MAX_FRAMES) lines.push(`... ${p.callFrames.length - MAX_FRAMES} more frames`);
  const top = p.callFrames[0];
  if (top?.this) lines.push(`this = ${previewValue(top.this)}`);
  for (const scope of (top?.scopeChain ?? []) as any[]) {
    if (!scope.object?.objectId) continue;
    const props = await withTimeout(session.send('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true, generatePreview: true }), EVAL_TIMEOUT_MS, `Reading the ${scope.type} scope timed out`).catch(() => undefined);
    const cap = scope.type === 'global' ? MAX_GLOBAL_VARS : MAX_SCOPE_VARS;
    const all = ((props?.result ?? []) as any[]).filter((x) => x.value);
    const vars = all.slice(0, cap).map((x) => `  ${x.name} = ${previewValue(x.value)}`);
    if (all.length > cap) vars.push(`  ... ${all.length - cap} more`);
    if (vars.length) lines.push(`${scopeTitle(scope)} of frame #0:`, ...vars);
  }
  return lines.join('\n');
}

const MAX_SCOPE_VARS = 20;
const MAX_GLOBAL_VARS = 10;
const scopeTitle = (s: any) => (s.type === 'local' ? 'Locals' : `${s.type[0].toUpperCase()}${s.type.slice(1)} scope${s.name ? ` (${s.name})` : ''}`);

async function waitPause(ctx: ToolContext, tab: string, before: PausedState | undefined, ms: number): Promise<PausedState | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = ctx.debug.paused(tab);
    if (now && now !== before) return now;
    await new Promise((r) => setTimeout(r, 50));
  }
  return ctx.debug.paused(tab);
}

/** Waits for the next real state: a new pause, or a resume that is not followed by a pause within graceMs; bounded by maxMs. */
async function waitSettled(ctx: ToolContext, tab: string, before: PausedState | undefined, graceMs: number, maxMs: number): Promise<PausedState | undefined> {
  const end = Date.now() + maxMs;
  let resumedAt: number | undefined;
  while (Date.now() < end) {
    const now = ctx.debug.paused(tab);
    if (now && now !== before) return now;
    if (!now) {
      resumedAt ??= Date.now();
      if (Date.now() - resumedAt >= graceMs) return undefined;
    } else resumedAt = undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
  return ctx.debug.paused(tab);
}

const EXCEPTION_MODES = ['uncaught', 'all', 'none'] as const;
const PAUSE_ON_EXCEPTIONS = { type: 'string', enum: [...EXCEPTION_MODES], description: 'Pause on exceptions: uncaught, all or none (applies to the tab until changed).' } as const;

async function applyExceptionMode(session: { send(m: string, p?: object): Promise<any> }, a: Record<string, unknown>): Promise<string | undefined> {
  const mode = str(a, 'pauseOnExceptions');
  if (!mode) return undefined;
  if (!(EXCEPTION_MODES as readonly string[]).includes(mode)) throw new Error(`pauseOnExceptions must be one of ${EXCEPTION_MODES.join(', ')}`);
  await session.send('Debugger.setPauseOnExceptions', { state: mode });
  return `Pause on exceptions: ${mode}.`;
}

const MAX_SCRIPT_ROWS = 100;
const MAX_SOURCE_CHARS = 20_000;
const MAX_MB = 1024 * 1024;
const MAX_SUMMARY_BYTES = 200 * MAX_MB;

interface Trace {
  client: CdpClient;
  startedAt: number;
}
const traces = new Map<string, Trace>();

async function browserClient(ctx: ToolContext, tab: string): Promise<CdpClient> {
  const host = new URL(ctx.service.devtoolsUrl(tab)).host;
  const res = await fetch(`http://${host}/json/version`);
  const info = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!info.webSocketDebuggerUrl) throw new Error('The browser does not expose a debugging socket');
  return connectCdp(info.webSocketDebuggerUrl);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export const debugTools: McpTool[] = [
  {
    name: 'browser_breakpoint_set',
    description: 'Set a breakpoint by script URL and 1-based line. With logMessage it is a logpoint: the message (a console.log argument list, e.g. `"x =", x`) is logged and the page never pauses.',
    inputSchema: schema(
      {
        url: { type: 'string', description: 'URL of the script; a part of it is enough when exactly one script from browser_scripts contains it.' },
        line: { type: 'integer', description: '1-based line.' },
        column: { type: 'integer', description: '1-based column.' },
        condition: { type: 'string', description: 'JavaScript condition; pauses only when true.' },
        logMessage: { type: 'string' },
      },
      ['url', 'line'],
    ),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const line = a.line as number;
      if (line < 1) return failResult('line is 1-based');
      const column = num(a, 'column');
      const condition = breakpointCondition(str(a, 'condition'), str(a, 'logMessage'));
      const resolved = resolveScriptUrl(ctx.debug.scripts(tab), a.url as string);
      if ('error' in resolved) return failResult(resolved.error);
      const url = resolved.url;
      const r = await session.send('Debugger.setBreakpointByUrl', {
        url,
        lineNumber: line - 1,
        ...(column ? { columnNumber: column - 1 } : {}),
        ...(condition ? { condition } : {}),
      });
      const id = String(r.breakpointId);
      ctx.debug.breakpoints.set(id, {
        id,
        tab,
        url,
        line,
        ...(column ? { column } : {}),
        ...(str(a, 'condition') ? { condition: str(a, 'condition')! } : {}),
        ...(str(a, 'logMessage') ? { logMessage: str(a, 'logMessage')! } : {}),
      });
      const bound = (r.locations as unknown[] | undefined)?.length ? 'bound' : 'not bound yet (it binds when a script with this URL loads)';
      return textResult(`Breakpoint ${id} set at ${url}:${line}, ${bound}`);
    },
  },
  {
    name: 'browser_breakpoint_remove',
    description: 'Remove a breakpoint by the id browser_breakpoint_set returned.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(a, ctx) {
      const info = ctx.debug.breakpoints.get(a.id as string);
      if (!info) return failResult(`Unknown breakpoint: ${a.id}`);
      await ctx.ready();
      await ctx.service.tabs().session(info.tab).send('Debugger.removeBreakpoint', { breakpointId: info.id });
      ctx.debug.breakpoints.delete(info.id);
      return textResult(`Removed breakpoint ${info.id}`);
    },
  },
  {
    name: 'browser_breakpoint_list',
    description: 'List the breakpoints and logpoints set through these tools.',
    inputSchema: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const list = [...ctx.debug.breakpoints.values()];
      if (!list.length) return textResult('No breakpoints.');
      return textResult(list.map((b) => `${b.id}  ${b.url}:${b.line}${b.column ? `:${b.column}` : ''}  tab ${b.tab}${b.logMessage ? `  logpoint: ${b.logMessage}` : ''}${b.condition ? `  if ${b.condition}` : ''}`).join('\n'));
    },
  },
  {
    name: 'browser_debugger_state',
    description: 'Whether the page is paused at a breakpoint: the reason, the top 10 call frames, `this` and the local, closure and global variables of the top frame (capped). Optionally sets pauseOnExceptions.',
    inputSchema: schema({ pauseOnExceptions: PAUSE_ON_EXCEPTIONS }),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const note = await applyExceptionMode(session, a);
      const p = ctx.debug.paused(tab);
      return textResult([note, p ? await describePaused(session, p) : 'Not paused.'].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'browser_debugger_pause',
    description: 'Pause the running page at the next statement (Debugger.pause) and return the pause. With pauseOnExceptions it also sets that mode; pause=false only sets the mode.',
    inputSchema: schema({ pauseOnExceptions: PAUSE_ON_EXCEPTIONS, pause: { type: 'boolean', description: 'Default true.' } }),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const note = await applyExceptionMode(session, a);
      if (a.pause === false) return textResult(note ?? 'Nothing to do.');
      const before = ctx.debug.paused(tab);
      if (before) return textResult([note, 'Already paused.', await describePaused(session, before)].filter(Boolean).join('\n'));
      await session.send('Debugger.pause');
      const now = await waitPause(ctx, tab, undefined, 3000);
      const out = now ? await describePaused(session, now) : 'Pause requested; the page has not stopped yet (no JavaScript running). It pauses when the next script runs.';
      return textResult([note, out].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'browser_scripts',
    description: 'List the scripts the page parsed (url, scriptId, sourceMapURL), optionally filtered by text. With source=<scriptId> returns that script\'s source (capped).',
    inputSchema: schema({
      text: { type: 'string', description: 'Keep scripts whose URL or source map URL contains this.' },
      source: { type: 'string', description: 'scriptId whose source to return.' },
    }),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const id = str(a, 'source');
      if (id) {
        const r = await withTimeout(session.send('Debugger.getScriptSource', { scriptId: id }), EVAL_TIMEOUT_MS, 'Reading the script source timed out');
        const src = String(r.scriptSource ?? '');
        return textResult(src.length > MAX_SOURCE_CHARS ? `${src.slice(0, MAX_SOURCE_CHARS)}\n... truncated, ${src.length - MAX_SOURCE_CHARS} more characters` : src);
      }
      const list = filterScripts(ctx.debug.scripts(tab).filter((s) => s.url), str(a, 'text'));
      if (!list.length) return textResult('No scripts.');
      const rows = list.slice(0, MAX_SCRIPT_ROWS).map((s) => `${s.scriptId}  ${s.url}${s.sourceMapURL ? `  map: ${s.sourceMapURL}` : ''}`);
      if (list.length > MAX_SCRIPT_ROWS) rows.push(`... ${list.length - MAX_SCRIPT_ROWS} more; filter with text`);
      return textResult(rows.join('\n'));
    },
  },
  {
    name: 'browser_debugger_eval',
    description: 'Evaluate an expression in a call frame of the paused page (frame = index from browser_debugger_state).',
    inputSchema: schema({ frame: { type: 'integer', description: 'Call frame index, 0 is the top.' }, expression: { type: 'string' } }, ['frame', 'expression']),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const p = ctx.debug.paused(tab);
      if (!p) return failResult('The page is not paused.');
      const frame = p.callFrames[a.frame as number];
      if (!frame) return failResult(`No call frame ${a.frame}; there are ${p.callFrames.length}`);
      const r = await withTimeout(
        session.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: a.expression, generatePreview: true, returnByValue: false }),
        EVAL_TIMEOUT_MS,
        'The evaluation timed out',
      );
      const out = describeEval(r);
      return out.ok ? textResult(out.text, 'Return less from the expression.') : failResult(out.text);
    },
  },
  {
    name: 'browser_debugger_step',
    description: 'Resume the paused page or step over, into or out of the current call. Returns the new pause, if any.',
    inputSchema: schema({ action: { type: 'string', enum: ['resume', 'over', 'into', 'out'] } }, ['action']),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const before = ctx.debug.paused(tab);
      if (!before) return failResult('The page is not paused.');
      await session.send(STEPS[a.action as keyof typeof STEPS]);
      const now = await waitSettled(ctx, tab, before, a.action === 'resume' ? 300 : 1000, 3000);
      if (now && now !== before) return textResult(await describePaused(session, now));
      return textResult(now ? 'No state change within 3 s; the page is still paused at the same place.' : 'Resumed; the page is running.');
    },
  },
  {
    name: 'browser_trace_start',
    description: 'Start a performance trace of the whole browser, tracked per tab. Stop it with browser_trace_stop (same tab).',
    inputSchema: schema({ categories: { type: 'string', description: 'Comma-separated trace categories; default the browser defaults.' } }),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      if (traces.has(tab)) return failResult(`A trace is already running for tab ${tab}; stop it with browser_trace_stop.`);
      const client = await browserClient(ctx, tab);
      try {
        await client.send('Tracing.start', { transferMode: 'ReturnAsStream', ...(str(a, 'categories') ? { categories: str(a, 'categories') } : {}) });
      } catch (e) {
        client.close();
        throw e;
      }
      client.onClose(() => {
        if (traces.get(tab)?.client === client) traces.delete(tab);
      });
      traces.set(tab, { client, startedAt: Date.now() });
      return textResult('Tracing started.');
    },
  },
  {
    name: 'browser_trace_stop',
    description: 'Stop the trace of the tab and write it to a JSON file (loadable in the DevTools Performance panel); returns the path, duration, the 5 longest tasks over 50 ms and the LCP when present.',
    inputSchema: schema({}),
    async run(a, ctx) {
      const tab = await resolveTab(ctx, a);
      const t = traces.get(tab);
      if (!t) return failResult(`No trace is running for tab ${tab}; start one with browser_trace_start.`);
      traces.delete(tab);
      const durationMs = Date.now() - t.startedAt;
      try {
        const complete = new Promise<{ stream?: string }>((resolve) => {
          const off = t.client.on('Tracing.tracingComplete', (p) => {
            off();
            resolve(p ?? {});
          });
        });
        await t.client.send('Tracing.end');
        const { stream } = await withTimeout(complete, 60_000, 'The trace did not complete');
        if (!stream) return failResult('The browser returned no trace data');
        const dir = join(ctx.dataDir, 'traces');
        await mkdir(dir, { recursive: true });
        const file = join(dir, `${stamp()}.json`);
        await Bun.write(file, '');
        for (;;) {
          const chunk = await t.client.send('IO.read', { handle: stream, size: 1024 * 1024 });
          const data = chunk.base64Encoded ? Buffer.from(String(chunk.data), 'base64') : String(chunk.data ?? '');
          await appendFile(file, data);
          if (chunk.eof) break;
        }
        await t.client.send('IO.close', { handle: stream }).catch(() => undefined);
        const size = (await stat(file)).size;
        let summary = '';
        if (size <= MAX_SUMMARY_BYTES) {
          try {
            const json = (await Bun.file(file).json()) as { traceEvents?: TraceEvent[] } | TraceEvent[];
            summary = `\n${formatTraceSummary(summarizeTrace(Array.isArray(json) ? json : (json.traceEvents ?? [])))}`;
          } catch {
            summary = '\n(The trace could not be summarised.)';
          }
        } else summary = '\n(Trace too large to summarise.)';
        return textResult(`Trace written to ${file} (${Math.round(size / 1024)} KB, ${(durationMs / 1000).toFixed(1)} s)${summary}`);
      } finally {
        t.client.close();
      }
    },
  },
];
