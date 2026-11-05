import { describe, expect, test } from 'bun:test';
import { format, lineCol, minify, validate } from './json-tools';

describe('json-tools', () => {
  test('format uses 2 spaces', () => {
    expect(format('{"a":[1,2]}')).toEqual({ ok: true, text: '{\n  "a": [\n    1,\n    2\n  ]\n}' });
  });

  test('minify strips whitespace', () => {
    expect(minify('{ "a": [1, 2] }')).toEqual({ ok: true, text: '{"a":[1,2]}' });
  });

  test('validate reports line and column of the error', () => {
    const r = validate('{\n  "a": 1,\n  b: 2\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.line).toBe(3);
  });

  test('truncated input points at the end', () => {
    const r = validate('{"a":');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.line).toBe(1);
  });

  test('lineCol counts from 1', () => {
    expect(lineCol('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
  });
});
