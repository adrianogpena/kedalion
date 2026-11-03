import { describe, expect, test } from 'bun:test';
import type { HttpResponseInfo } from '@kedalion/server-core/protocol';
import { diffResponses } from '../src/response-diff.ts';

const res = (over: Partial<HttpResponseInfo> = {}): HttpResponseInfo => ({
  id: 'x',
  status: 200,
  statusText: 'OK',
  url: 'http://x',
  redirected: false,
  headers: [],
  ms: 10,
  totalMs: 20,
  size: 5,
  truncated: false,
  contentType: 'text/plain',
  fileName: 'f',
  text: 'a\nb',
  ...over,
});

describe('diffResponses', () => {
  test('identical responses are same', () => {
    expect(diffResponses(res(), res({ totalMs: 99 })).same).toBe(true);
  });

  test('status change', () => {
    const d = diffResponses(res(), res({ status: 404 }));
    expect(d.status).toEqual({ from: 200, to: 404, changed: true });
    expect(d.same).toBe(false);
  });

  test('timing delta', () => {
    expect(diffResponses(res(), res({ totalMs: 50 })).time.delta).toBe(30);
  });

  test('headers added, removed and changed by lowercase name', () => {
    const d = diffResponses(
      res({ headers: [['Content-Type', 'a'], ['X-Gone', '1'], ['X-Same', 's']] }),
      res({ headers: [['content-type', 'b'], ['X-New', '2'], ['x-same', 's']] }),
    );
    expect(d.headers.added).toEqual([['X-New', '2']]);
    expect(d.headers.removed).toEqual([['X-Gone', '1']]);
    expect(d.headers.changed).toEqual([['content-type', 'a', 'b']]);
  });

  test('body line diff', () => {
    const d = diffResponses(res({ text: 'a\nb\nc' }), res({ text: 'a\nx\nc' }));
    expect(d.body?.lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
    expect(d.same).toBe(false);
  });

  test('reformatted JSON is same', () => {
    const json = { contentType: 'application/json' };
    const d = diffResponses(res({ ...json, text: '{"a":1,"b":[1,2]}' }), res({ ...json, text: '{\n  "a": 1,\n  "b": [1, 2]\n}' }));
    expect(d.same).toBe(true);
    expect(d.body?.partial).toBe(false);
  });

  test('binary diffs only status, headers, size', () => {
    const bin = { text: undefined, binary: true as const };
    const d = diffResponses(res(bin), res({ ...bin, size: 9 }));
    expect(d.body).toBeUndefined();
    expect(d.same).toBe(false);
    expect(diffResponses(res(bin), res(bin)).same).toBe(true);
  });

  test('truncated body is partial', () => {
    expect(diffResponses(res(), res({ truncated: true })).body?.partial).toBe(true);
  });

  test('huge bodies fall back to a plain listing and are partial', () => {
    const big = Array.from({ length: 2100 }, (_, i) => String(i)).join('\n');
    const d = diffResponses(res({ text: big }), res({ text: 'z' }));
    expect(d.body?.partial).toBe(true);
    expect(d.body?.lines.filter((l) => l.kind === 'add')).toHaveLength(1);
  });
});
