import { describe, expect, test } from 'bun:test';
import type { HttpResponseInfo } from '@kedalion/server-core/protocol';
import { evalCapture, parsePath } from './capture';

const response = (text: string, headers: Array<[string, string]> = []): HttpResponseInfo =>
  ({ id: 'x', status: 200, statusText: 'OK', url: '', redirected: false, headers, ms: 0, totalMs: 0, size: text.length, truncated: false, contentType: 'application/json', fileName: 'r.json', text }) as HttpResponseInfo;

describe('parsePath', () => {
  test('reads dots, indexes and quoted keys', () => {
    expect(parsePath('$.a[2]["b c"].d')).toEqual(['a', 2, 'b c', 'd']);
    expect(parsePath('$')).toEqual([]);
  });
  test('rejects other shapes', () => {
    expect(parsePath('a.b')).toBeNull();
    expect(parsePath('$..a')).toBeNull();
    expect(parsePath('$[x]')).toBeNull();
  });
});

describe('evalCapture', () => {
  const body = response('{"token":"abc","n":5,"list":[{"id":7}],"x y":true}');
  test('body paths', () => {
    expect(evalCapture(body, { name: 't', from: 'body', path: '$.token' })).toBe('abc');
    expect(evalCapture(body, { name: 't', from: 'body', path: '$.n' })).toBe('5');
    expect(evalCapture(body, { name: 't', from: 'body', path: '$.list[0].id' })).toBe('7');
    expect(evalCapture(body, { name: 't', from: 'body', path: '$["x y"]' })).toBe('true');
  });
  test('missing values', () => {
    expect(evalCapture(body, { name: 't', from: 'body', path: '$.nope' })).toBeUndefined();
    expect(evalCapture(body, { name: 't', from: 'body', path: '$.token[0]' })).toBeUndefined();
    expect(evalCapture(response('not json'), { name: 't', from: 'body', path: '$.a' })).toBeUndefined();
  });
  test('header names ignore case', () => {
    const r = response('', [['X-Token', 'h1']]);
    expect(evalCapture(r, { name: 't', from: 'header', path: 'x-token' })).toBe('h1');
    expect(evalCapture(r, { name: 't', from: 'header', path: 'other' })).toBeUndefined();
  });
});
