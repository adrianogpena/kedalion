import { expect, test } from 'bun:test';
import { mergeHeaders, mockHeaders } from './intercept.ts';
import { failureText, previewValue } from './logs.ts';

test('previewValue renders object, array and map previews', () => {
  const obj = { type: 'object', description: 'Object', preview: { type: 'object', description: 'Object', overflow: true, properties: [{ name: 'a', type: 'number', value: '1' }, { name: 'b', type: 'string', value: 'x' }] } };
  expect(previewValue(obj)).toBe('{a: 1, b: "x", ...}');
  const arr = { type: 'object', subtype: 'array', description: 'Array(2)', preview: { type: 'object', subtype: 'array', description: 'Array(2)', properties: [{ name: '0', type: 'number', value: '1' }, { name: '1', type: 'number', value: '2' }] } };
  expect(previewValue(arr)).toBe('[1, 2]');
  const map = { type: 'object', subtype: 'map', description: 'Map(1)', preview: { type: 'object', subtype: 'map', description: 'Map(1)', properties: [], entries: [{ key: { type: 'string', description: 'k' }, value: { type: 'number', description: '1' } }] } };
  expect(previewValue(map)).toBe('Map(1) {"k" => 1}');
});

test('failureText joins the failure parts', () => {
  expect(failureText({ errorText: 'net::ERR_FAILED', blockedReason: 'inspector', corsErrorStatus: { corsError: 'MissingAllowOriginHeader' } })).toBe('net::ERR_FAILED / inspector / MissingAllowOriginHeader');
  expect(failureText({})).toBe('failed');
});

test('mockHeaders echoes the request origin with credentials, else *', () => {
  const rule = { id: 'r', enabled: true, pattern: 'x', action: 'mock' as const, headers: { 'x-a': '1' } };
  expect(mockHeaders(rule, { Origin: 'http://a.test' })).toEqual([
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Access-Control-Allow-Origin', value: 'http://a.test' },
    { name: 'Access-Control-Allow-Credentials', value: 'true' },
    { name: 'x-a', value: '1' },
  ]);
  expect(mockHeaders(rule, {}).find((h) => h.name === 'Access-Control-Allow-Origin')?.value).toBe('*');
  expect(mergeHeaders([{ name: 'Accept', value: 'a' }], { accept: 'b' })).toEqual([{ name: 'accept', value: 'b' }]);
});
