import { describe, expect, test } from 'bun:test';
import { buildMcpConfig } from './config.ts';
import { checkArgs, handleRpc, mcpRoutes } from './rpc.ts';
import { failResult, type McpTool, TEXT_CAP, textResult, type ToolContext } from './types.ts';

const ctx = () => ({}) as ToolContext;
const echo: McpTool = {
  name: 'echo',
  description: 'Echo',
  inputSchema: { type: 'object', properties: { text: { type: 'string' }, n: { type: 'integer' }, mode: { type: 'string', enum: ['a', 'b'] } }, required: ['text'] },
  run: async (a) => textResult(String(a.text)),
};
const boom: McpTool = {
  name: 'boom',
  description: 'Fails',
  inputSchema: { type: 'object', properties: {} },
  run: async () => {
    throw new Error('exploded');
  },
};
const soft: McpTool = { name: 'soft', description: 'Soft failure', inputSchema: { type: 'object', properties: {} }, run: async () => failResult('nope') };
const big: McpTool = { name: 'big', description: 'Big', inputSchema: { type: 'object', properties: {} }, run: async () => textResult('x'.repeat(TEXT_CAP + 500), 'Pass limit.') };
const tools = [echo, boom, soft, big];
const rpc = (method: string, params?: unknown, id: number | undefined = 1) => handleRpc({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, ...(params !== undefined ? { params } : {}) }, tools, ctx);
const err = (r: { body?: unknown }) => (r.body as { error: { code: number } }).error.code;
const result = (r: { body?: unknown }) => (r.body as { result: any }).result;

describe('handleRpc', () => {
  test('initialize answers a supported protocol version and falls back otherwise', async () => {
    expect(result(await rpc('initialize', { protocolVersion: '2024-11-05' })).protocolVersion).toBe('2024-11-05');
    const r = result(await rpc('initialize', { protocolVersion: '1999-01-01' }));
    expect(r.protocolVersion).toBe('2025-06-18');
    expect(r.serverInfo.name).toBe('kedalion-browser');
    expect(r.capabilities).toEqual({ tools: {} });
  });

  test('notifications get 202 and no body', async () => {
    expect(await rpc('notifications/initialized', undefined, undefined)).toEqual({ status: 202 });
  });

  test('ping and tools/list', async () => {
    expect(result(await rpc('ping'))).toEqual({});
    expect(result(await rpc('tools/list')).tools.map((t: { name: string }) => t.name)).toEqual(['echo', 'boom', 'soft', 'big']);
  });

  test('protocol errors', async () => {
    expect(err(await handleRpc(undefined, tools, ctx))).toBe(-32700);
    expect(err(await handleRpc([], tools, ctx))).toBe(-32600);
    expect(err(await handleRpc({ id: 1, method: 'ping' }, tools, ctx))).toBe(-32600);
    expect(err(await rpc('nope'))).toBe(-32601);
    expect(err(await rpc('tools/call', { name: 'missing' }))).toBe(-32602);
    expect(err(await rpc('tools/call', { name: 'echo', arguments: {} }))).toBe(-32602);
    expect(err(await rpc('tools/call', { name: 'echo', arguments: { text: 1 } }))).toBe(-32602);
    expect(err(await rpc('tools/call', { name: 'echo', arguments: { text: 'x', mode: 'c' } }))).toBe(-32602);
  });

  test('tools/call returns the tool result', async () => {
    expect(result(await rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } }))).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  test('a failing tool is a normal result with isError', async () => {
    const r = result(await rpc('tools/call', { name: 'boom' }));
    expect(r).toEqual({ content: [{ type: 'text', text: 'exploded' }], isError: true });
    expect(result(await rpc('tools/call', { name: 'soft' })).isError).toBe(true);
  });

  test('text over the cap is cut and ends with the hint', async () => {
    const text = result(await rpc('tools/call', { name: 'big' })).content[0].text as string;
    expect(text.length).toBeLessThanOrEqual(TEXT_CAP);
    expect(text.endsWith('Pass limit.')).toBe(true);
  });
});

describe('checkArgs', () => {
  test('accepts valid and flags the first problem', () => {
    expect(checkArgs(echo.inputSchema, { text: 'a', n: 2 })).toBeUndefined();
    expect(checkArgs(echo.inputSchema, { text: 'a', n: 1.5 })).toContain('n must be');
  });
});

describe('mcpRoutes', () => {
  const routes = mcpRoutes({ secret: 'sekret', tools, context: ctx });
  const post = (headers: Record<string, string>, body: string) =>
    routes['POST /api/browser/mcp']!({ req: new Request('http://127.0.0.1/api/browser/mcp', { method: 'POST', headers, body }) } as never) as Promise<Response>;

  test('refuses a missing or wrong bearer', async () => {
    expect((await post({}, '{}')).status).toBe(401);
    expect((await post({ authorization: 'Bearer wrong' }, '{}')).status).toBe(401);
  });

  test('answers a request, a notification and bad JSON', async () => {
    const auth = { authorization: 'Bearer sekret' };
    const ok = await post(auth, JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
    expect((await post(auth, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status).toBe(202);
    const bad = await post(auth, '{nope');
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });

  test('GET answers 405', async () => {
    const res = (await routes['GET /api/browser/mcp']!({ req: new Request('http://127.0.0.1/api/browser/mcp', { headers: { authorization: 'Bearer sekret' } }) } as never)) as Response;
    expect(res.status).toBe(405);
  });

  test('disabled endpoint answers 403', async () => {
    const off = mcpRoutes({ secret: 's', tools, context: ctx, enabled: () => false });
    const res = (await off['POST /api/browser/mcp']!({ req: new Request('http://x/', { method: 'POST', headers: { authorization: 'Bearer s' }, body: '{}' }) } as never)) as Response;
    expect(res.status).toBe(403);
  });
});

describe('buildMcpConfig', () => {
  test('points Claude at the endpoint with the bearer', () => {
    expect(buildMcpConfig('http://127.0.0.1:5000', 'abc')).toEqual({
      mcpServers: { 'kedalion-browser': { type: 'http', url: 'http://127.0.0.1:5000/api/browser/mcp', headers: { Authorization: 'Bearer abc' } } },
    });
  });
});
