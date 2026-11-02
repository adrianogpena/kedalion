import { describe, expect, test } from 'bun:test';
import type { CdpSession } from '@kedalion/cdp';
import { breakpointCondition, createDebugState } from './debug-state.ts';
import { pageSession } from './page-util.ts';
import { debugTools } from './tools-debug.ts';
import type { ToolContext } from './types.ts';

function fakeSession() {
  const sent: Array<{ method: string; params?: any }> = [];
  const handlers = new Map<string, Array<(p: any) => void>>();
  const replies: Record<string, any> = {};
  const session: CdpSession = {
    send: async (method, params) => {
      sent.push({ method, params });
      return replies[method] ?? {};
    },
    on: (event, cb) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      return () => undefined;
    },
  };
  return { session, sent, replies, emit: (event: string, p: any) => handlers.get(event)?.forEach((h) => h(p)) };
}

function setup() {
  const fake = fakeSession();
  const debug = createDebugState();
  const ctx = {
    service: { tabs: () => ({ list: () => [{ id: 't1' }], session: () => fake.session }), activeTab: () => 't1' },
    ready: async () => undefined,
    dataDir: '.',
    debug,
  } as unknown as ToolContext;
  const tool = (name: string) => debugTools.find((t) => t.name === name)!;
  return { fake, debug, ctx, tool };
}

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content[0]!.text!;

describe('breakpointCondition', () => {
  test('logpoints log and never pause', () => {
    expect(breakpointCondition(undefined, '"x", x')).toBe('(console.log("x", x), false)');
    expect(breakpointCondition('x > 1', '"x"')).toBe('(x > 1) && (console.log("x"), false)');
    expect(breakpointCondition('x > 1')).toBe('x > 1');
    expect(breakpointCondition()).toBeUndefined();
  });
});

describe('debugger tools', () => {
  test('breakpoint_set enables the debugger once, converts to 0-based and lists it', async () => {
    const { fake, ctx, tool } = setup();
    fake.replies['Debugger.setBreakpointByUrl'] = { breakpointId: 'bp1', locations: [{}] };
    const r = await tool('browser_breakpoint_set').run({ url: 'http://x/app.js', line: 12, column: 3, logMessage: '"hit"' }, ctx);
    expect(text(r)).toContain('bp1');
    const set = fake.sent.find((s) => s.method === 'Debugger.setBreakpointByUrl')!;
    expect(set.params).toMatchObject({ url: 'http://x/app.js', lineNumber: 11, columnNumber: 2, condition: '(console.log("hit"), false)' });
    expect(text(await tool('browser_breakpoint_list').run({}, ctx))).toContain('http://x/app.js:12:3');
    await tool('browser_breakpoint_set').run({ url: 'http://x/app.js', line: 5 }, ctx);
    expect(fake.sent.filter((s) => s.method === 'Debugger.enable')).toHaveLength(1);
  });

  test('state reports the pause and page tools refuse while paused', async () => {
    const { fake, ctx, tool } = setup();
    await tool('browser_debugger_state').run({}, ctx);
    fake.replies['Runtime.getProperties'] = { result: [{ name: 'a', value: { type: 'number', value: 1, description: '1' } }] };
    fake.emit('Debugger.paused', {
      reason: 'other',
      hitBreakpoints: ['bp1'],
      callFrames: [{ callFrameId: 'f0', functionName: 'go', url: 'http://x/app.js', location: { scriptId: '1', lineNumber: 11, columnNumber: 0 }, scopeChain: [{ type: 'local', object: { objectId: 'o1' } }] }],
    });
    const out = text(await tool('browser_debugger_state').run({}, ctx));
    expect(out).toContain('Paused: other');
    expect(out).toContain('#0 go  http://x/app.js:12:1');
    expect(out).toContain('a = ');
    await expect(pageSession(ctx, {})).rejects.toThrow('page is paused at a breakpoint');
    fake.emit('Debugger.resumed', {});
    expect((await pageSession(ctx, {})).tab).toBe('t1');
  });

  test('debugger_eval needs a pause', async () => {
    const { ctx, tool } = setup();
    const r = await tool('browser_debugger_eval').run({ frame: 0, expression: '1' }, ctx);
    expect(r.isError).toBe(true);
  });
});
