import { describe, expect, test } from 'bun:test';
import type { DbSessions } from '@kedalion/db';
import type { HttpResponseInfo } from '@kedalion/server-core/protocol';
import { grepLines, jsonPick, tsv, writeReason } from './format.ts';
import { handleRpc, type McpTool } from './mcp.ts';
import { restTools } from './rest.ts';
import { sqlTools } from './sql.ts';

const call = async (tools: McpTool[], name: string, args: Record<string, unknown>) => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, tools);
  const body = r.body as { result?: { content: Array<{ text: string }>; isError?: boolean }; error?: { message: string } };
  return { text: body.result?.content[0]?.text ?? body.error?.message ?? '', isError: body.result?.isError === true, rpcError: body.error !== undefined };
};

describe('format', () => {
  test('writeReason lets reads through and flags everything else', () => {
    expect(writeReason('select 1 from dual')).toBeUndefined();
    expect(writeReason('  -- note\n /* c */ WITH a AS (select 1 x from dual) select * from a')).toBeUndefined();
    expect(writeReason('(select 1 from dual)')).toBeUndefined();
    expect(writeReason('select * from t where x = \'for update\'')).toBeUndefined();
    expect(writeReason('delete from t')).toContain('DELETE');
    expect(writeReason('begin null; end;')).toContain('BEGIN');
    expect(writeReason('select * from t for  update')).toContain('FOR UPDATE');
    expect(writeReason('')).toBe('empty statement');
  });

  test('tsv, jsonPick and grepLines', () => {
    expect(tsv(['A', 'B'], [[1, null], ['x\ty', new Uint8Array(3)]], 10)).toBe('A\tB\n1\tNULL\nx y\t<binary 3 bytes>');
    expect(jsonPick({ a: { b: [{ c: 5 }] } }, '$.a.b[0].c')).toBe(5);
    expect(jsonPick({ a: 1 }, '$.x.y')).toBeUndefined();
    expect(grepLines('a\nb\nneedle\nc\nd\ne\nneedle2', 'needle', 0)).toBe('needle\n--\nneedle2');
  });
});

describe('sql tools', () => {
  const calls: string[] = [];
  let pending = false;
  const sessions = {
    run: async (_id: string, _c: unknown, sql: string) => {
      calls.push(sql);
      if (/^select/i.test(sql)) return { kind: 'rows', run: 'r1', columns: [{ name: 'ID', type: 'number' }, { name: 'NAME', type: 'text' }] };
      pending = true;
      return { kind: 'done', rowsAffected: 2 };
    },
    rows: async (_run: string, emit: (i: unknown) => Promise<void>) => {
      await emit([1, 'a']);
      await emit([2, 'b']);
      await emit({ $truncated: true });
    },
    status: () => ({ connected: true, pending, busy: false }),
    commit: async () => {
      pending = false;
      return { connected: true, pending, busy: false };
    },
  } as unknown as DbSessions;
  const one = [{ id: 'c1', name: 'Dev', url: 'u', user: 'me' }];
  const make = (connections = one) => sqlTools({ connections: async () => connections, credentials: async () => ({ connectString: 'x', user: 'me', password: 'pw' }), sessions });

  test('a select returns a tab separated table and notes more rows', async () => {
    const r = await call(make(), 'sql_run', { sql: 'select * from t;', connection: 'Dev' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('[Dev] 2 rows');
    expect(r.text).toContain('more rows exist');
    expect(r.text).toContain('ID\tNAME\n1\ta\n2\tb');
    expect(calls.at(-1)).toBe('select * from t');
  });

  test('a write is refused unless allowed, then reports uncommitted changes', async () => {
    const before = calls.length;
    const refused = await call(make(), 'sql_run', { sql: 'update t set x = 1', connection: 'Dev' });
    expect(refused.isError).toBe(true);
    expect(calls.length).toBe(before);
    const done = await call(make(), 'sql_run', { sql: 'update t set x = 1', allowWrite: true, connection: 'Dev' });
    expect(done.text).toContain('2 rows affected');
    expect(done.text).toContain('UNCOMMITTED');
    expect((await call(make(), 'sql_commit', { connection: 'Dev' })).text).toContain('committed');
  });

  test('a missing connection is never assumed, even with a single saved one', async () => {
    const r = await call(make(), 'sql_run', { sql: 'select 1 from dual' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Ask the user which connection');
  });

  test('an unknown or missing connection names the saved ones', async () => {
    const two = [...one, { id: 'c2', name: 'Test', url: 'u', user: 'me' }];
    expect((await call(make(two), 'sql_run', { sql: 'select 1 from dual' })).text).toContain('Ask the user which connection to use; do not choose one. Saved: Dev, Test');
    expect((await call(make(two), 'sql_run', { sql: 'select 1 from dual', connection: 'nope' })).text).toContain('Unknown connection "nope"');
    expect((await call(make(two), 'sql_run', { sql: 'select 1 from dual', connection: 'test' })).isError).toBe(false);
  });
});

describe('rest tools', () => {
  const sent: Array<Record<string, unknown>> = [];
  const response = (over: Partial<HttpResponseInfo> = {}): HttpResponseInfo => ({
    id: 'r1',
    status: 200,
    statusText: 'OK',
    url: 'http://x/api',
    redirected: false,
    headers: [['Content-Type', 'application/json'], ['X-Other', 'no']],
    ms: 3,
    totalMs: 5,
    size: 30,
    truncated: false,
    contentType: 'application/json',
    fileName: 'f',
    text: '{"status":"ok","items":[{"id":7}]}',
    ...over,
  });
  const make = (res = response()) =>
    restTools({
      send: async (input) => {
        sent.push(input);
        return res;
      },
      body: () => ({ bytes: new TextEncoder().encode('line1\nline2 needle\nline3'), contentType: 'text/plain', url: 'http://x' }),
      environments: async () => [{ id: 'e1', name: 'Local', vars: [{ name: 'host', value: 'h', secret: false, enabled: true }, { name: 'token', value: '', secret: true, enabled: true, set: true }] }],
    });

  test('sends with query, json content type and environment, and prints the body indented', async () => {
    const r = await call(make(), 'rest_send', { url: 'http://x/api', method: 'post', body: '{"a":1}', query: { q: 'a b' }, environment: 'local' });
    expect(sent.at(-1)).toMatchObject({ environment: 'e1', request: { method: 'POST', url: 'http://x/api?q=a%20b', headers: [['Content-Type', 'application/json']] } });
    expect(r.text).toContain('200 OK  5 ms');
    expect(r.text).toContain('headers: content-type=application/json');
    expect(r.text).not.toContain('x-other');
    expect(r.text).toContain('"status": "ok"');
  });

  test('assertions pass or fail the call', async () => {
    const pass = await call(make(), 'rest_send', { url: 'http://x', expectStatus: '2xx', expectJson: { '$.items[0].id': '7' }, expectBody: 'ok' });
    expect(pass.text).toContain('ASSERT PASS (3/3)');
    expect(pass.isError).toBe(false);
    const fail = await call(make(), 'rest_send', { url: 'http://x', expectStatus: '201,204', expectJson: { '$.status': 'bad' } });
    expect(fail.isError).toBe(true);
    expect(fail.text).toContain('ASSERT FAIL (0/2 passed): status 200, expected 201,204; $.status is ok, expected bad');
  });

  test('select, rest_body grep and environments', async () => {
    expect((await call(make(), 'rest_send', { url: 'http://x', select: '$.items[0].id' })).text).toMatch(/body:\n7$/);
    expect((await call(make(), 'rest_body', { id: 'r1', grep: 'needle', limit: 100 })).text).toBe('line1\nline2 needle\nline3');
    const envs = (await call(make(), 'rest_environments', {})).text;
    expect(envs).toBe('Local: host=h, token=<secret set>');
  });

  test('variables without an environment are never resolved by guessing', async () => {
    const before = sent.length;
    const r = await call(make(), 'rest_send', { url: '{{host}}/api', headers: { Authorization: 'Bearer {{token}}' }, body: '{{$uuid}}' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('{{host}}, {{token}}');
    expect(r.text).toContain('Ask the user which environment to use; do not choose one. Saved: Local');
    expect(sent.length).toBe(before);
    expect((await call(make(), 'rest_send', { url: '{{host}}/api', vars: { host: 'http://x' } })).isError).toBe(false);
    expect((await call(make(), 'rest_send', { url: 'http://x/{{$uuid}}' })).isError).toBe(false);
  });

  test('an unknown environment is an error that lists the saved ones', async () => {
    const r = await call(make(), 'rest_send', { url: 'http://x', environment: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Saved: Local');
  });
});

describe('rpc', () => {
  test('lists tools, rejects bad arguments and unknown tools', async () => {
    const tools = restTools({ send: async () => ({}) as HttpResponseInfo, body: () => undefined, environments: async () => [] });
    const list = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tools);
    expect((list.body as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)).toEqual(['rest_send', 'rest_body', 'rest_environments']);
    expect((await call(tools, 'rest_send', {})).text).toBe('Missing argument: url');
    expect((await call(tools, 'rest_send', { url: 1 })).text).toBe('Argument url must be a string');
    expect((await call(tools, 'nope', {})).rpcError).toBe(true);
  });
});
