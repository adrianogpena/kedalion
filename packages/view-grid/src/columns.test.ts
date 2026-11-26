import { describe, expect, test } from 'bun:test';
import { isHttpUrl, joinColumns, splitColumns } from './columns';

describe('splitColumns', () => {
  test('splits lines on whitespace into the column count', () => {
    expect(splitColumns('ctx ns api\n\n  c2   n2   web  ', 3)).toEqual([['ctx', 'ns', 'api'], ['c2', 'n2', 'web']]);
  });
  test('pads missing cells and keeps extra text in the last cell', () => {
    expect(splitColumns('ctx ns', 3)).toEqual([['ctx', 'ns', '']]);
    expect(splitColumns('ctx ns a b', 3)).toEqual([['ctx', 'ns', 'a b']]);
  });
  test('uses join and separator', () => {
    expect(splitColumns('EUR>BRL, USD>BRL', 2, { join: '>', separator: ', ' })).toEqual([['EUR', 'BRL'], ['USD', 'BRL']]);
  });
});

describe('joinColumns', () => {
  test('joins cells and rows, dropping incomplete rows', () => {
    expect(joinColumns([['ctx', 'ns', 'api'], ['c2', '', 'x']])).toBe('ctx ns api');
  });
  test('uses join and separator', () => {
    expect(joinColumns([['EUR', 'BRL'], ['USD', 'BRL']], { join: '>', separator: ', ' })).toBe('EUR>BRL, USD>BRL');
  });
  test('removes the delimiters from cells', () => {
    expect(joinColumns([['a b', 'c']])).toBe('ab c');
  });
});

describe('isHttpUrl', () => {
  test('accepts http and https only', () => {
    expect(isHttpUrl('https://example.com/a.ics')).toBe(true);
    expect(isHttpUrl('webcal://example.com')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
  });
});
