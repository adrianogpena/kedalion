import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type CdpClient, connectCdp, previewValue } from '@kedalion/cdp';
import { breakpointCondition, type PausedState } from './debug-state.ts';
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
  const local = p.callFrames[0]?.scopeChain?.find((s: any) => s.type === 'local');
  if (local?.object?.objectId) {
    const props = await withTimeout(session.send('Runtime.getProperties', { objectId: local.object.objectId, ownProperties: true, generatePreview: true }), EVAL_TIMEOUT_MS, 'Reading the locals timed out').catch(() => undefined);
    const vars = ((props?.result ?? []) as any[]).filter((x) => x.value).map((x) => `  ${x.name} = ${previewValue(x.value)}`);
    if (vars.length) lines.push('Locals of frame #0:', ...vars);
  }
  return lines.join('\n');
}

async function waitPause(ctx: ToolContext, tab: string, before: PausedState | undefined, ms: number): Promise<PausedState | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = ctx.debug.paused(tab);
    if (now && now !== before) return now;
    await new Promise((r) => setTimeout(r, 50));
  }
  return ctx.debug.paused(tab);
}

interface Trace {
  client: CdpClient;
  startedAt: number;
}
let trace: Trace | undefined;

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
        url: { type: 'string', description: 'Exact URL of the script.' },
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
      const r = await session.send('Debugger.setBreakpointByUrl', {
        url: a.url,
        lineNumber: line - 1,
        ...(column ? { columnNumber: column - 1 } : {}),
        ...(condition ? { condition } : {}),
      });
      const id = String(r.breakpointId);
      ctx.debug.breakpoints.set(id, {
        id,
        tab,
        url: a.url as string,
        line,
        ...(column ? { column } : {}),
        ...(str(a, 'condition') ? { condition: str(a, 'condition')! } : {}),
        ...(str(a, 'logMessage') ? { logMessage: str(a, 'logMessage')! } : {}),
      });
      const bound = (r.locations as unknown[] | undefined)?.length ? 'bound' : 'not bound yet (it binds when a script with this URL loads)';
      return textResult(`Breakpoint ${id} set at ${a.url}:${line}, ${bound}`);
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
    description: 'Whether the page is paused at a breakpoint: the reason, the top 10 call frames and the local variables of the top frame.',
    inputSchema: schema({}),
    async run(a, ctx) {
      const { tab, session } = await debugTab(ctx, a);
      const p = ctx.debug.paused(tab);
      return textResult(p ? await describePaused(session, p) : 'Not paused.');
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
      const now = await waitPause(ctx, tab, before, a.action === 'resume' ? 400 : 1500);
      return textResult(now && now !== before ? await describePaused(session, now) : 'Resumed; the page is running.');
    },
  },
  {
    name: 'browser_trace_start',
    description: 'Start a performance trace of the whole browser. Stop it with browser_trace_stop.',
    inputSchema: { type: 'object', properties: { categories: { type: 'string', description: 'Comma-separated trace categories; default the browser defaults.' } } },
    async run(a, ctx) {
      if (trace) return failResult('A trace is already running; stop it with browser_trace_stop.');
      const tab = await resolveTab(ctx, {});
      const client = await browserClient(ctx, tab);
      try {
        await client.send('Tracing.start', { transferMode: 'ReturnAsStream', ...(str(a, 'categories') ? { categories: str(a, 'categories') } : {}) });
      } catch (e) {
        client.close();
        throw e;
      }
      client.onClose(() => {
        if (trace?.client === client) trace = undefined;
      });
      trace = { client, startedAt: Date.now() };
      return textResult('Tracing started.');
    },
  },
  {
    name: 'browser_trace_stop',
    description: 'Stop the trace and write it to a JSON file (loadable in the DevTools Performance panel); returns the path and duration.',
    inputSchema: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const t = trace;
      if (!t) return failResult('No trace is running; start one with browser_trace_start.');
      trace = undefined;
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
        return textResult(`Trace written to ${file} (${Math.round(size / 1024)} KB, ${(durationMs / 1000).toFixed(1)} s)`);
      } finally {
        t.client.close();
      }
    },
  },
];
