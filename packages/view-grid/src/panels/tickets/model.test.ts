import { describe, expect, test } from 'bun:test';
import { add, columns, extractKey, move, parsePcr, remove, update, type Ticket } from './model';

const build = (): Ticket[] => {
  let t: Ticket[] = [];
  t = add(t, 'A-1', 'Open', '', 'a');
  t = add(t, 'A-2', 'Open', '', 'b');
  t = add(t, 'A-3', 'Done', '', 'c');
  return t;
};

describe('extractKey', () => {
  test('upper-cases and anchors at the start', () => {
    expect(extractKey('abc-123 fix')).toBe('ABC-123');
    expect(extractKey('see abc-123')).toBeNull();
  });
  test('custom pattern and invalid pattern fallback', () => {
    expect(extractKey('xy-9', 'XY-\\d+')).toBe('XY-9');
    expect(extractKey('abc-1', '(')).toBe('ABC-1');
  });
});

describe('move', () => {
  test('inserts at an index in another column', () => {
    const t = move(build(), 'c', 'Open', 1, 5);
    const cols = columns(t, ['Open', 'Done']);
    expect(cols[0]!.tickets.map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(cols[1]!.tickets).toEqual([]);
    expect(t.find((x) => x.id === 'c')!.movedAt).toBe(5);
  });
  test('reorders within a column', () => {
    const t = move(build(), 'a', 'Open', 1);
    expect(columns(t, ['Open', 'Done'])[0]!.tickets.map((x) => x.id)).toEqual(['b', 'a']);
    expect(t.find((x) => x.id === 'a')!.movedAt).toBeUndefined();
  });
  test('appends to an empty column', () => {
    const t = move(build(), 'a', 'Review', 0);
    expect(columns(t, ['Open', 'Review', 'Done'])[1]!.tickets.map((x) => x.id)).toEqual(['a']);
  });
});

describe('update, remove, columns', () => {
  test('update and remove', () => {
    expect(update(build(), 'a', { description: 'x' })[0]!.description).toBe('x');
    const t = remove(build(), 'b');
    expect(t.map((x) => x.order)).toEqual([0, 1]);
  });
  test('unknown status goes to the first column', () => {
    const t = add([], 'A-1', 'Gone', '', 'a');
    expect(columns(t, ['Open', 'Done'])[0]!.tickets).toHaveLength(1);
  });
});

test('parsePcr keeps the digits and add stores the pcr', () => {
  expect(parsePcr('PCR#163')).toBe('163');
  expect(parsePcr('#12 ')).toBe('12');
  expect(parsePcr('none')).toBe('');
  expect(add([], 'A-1', 'Open', '', 'id', '163')[0]!.pcr).toBe('163');
  expect(add([], 'A-1', 'Open', '', 'id')[0]!.pcr).toBeUndefined();
});
