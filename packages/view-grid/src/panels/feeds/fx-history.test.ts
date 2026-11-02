import { describe, expect, test } from 'bun:test';
import { addFxUpdate, mergeFxHistory } from './fx-history';

const data = (values: number[], live?: boolean) => ({ base: 'EUR', quote: 'BRL', dates: values.map((_, i) => `2026-10-0${i + 1}`), values, live });
const empty = { updates: [], dates: [], values: [] };

describe('addFxUpdate', () => {
  test('saves every fetch, even with the same rate', () => {
    const first = addFxUpdate(empty, data([5, 5.5]), 30, new Date('2026-10-30T10:00:00Z'));
    const second = addFxUpdate(first, data([5, 5.5]), 30, new Date('2026-10-30T10:05:00Z'));
    expect(second.updates.map((u) => u.at)).toEqual(['2026-10-30T10:00:00.000Z', '2026-10-30T10:05:00.000Z']);
    expect(second.updates[1]).toMatchObject({ value: 5.5, change: 0.5, percent: 10 });
  });

  test('keeps the graph series of the last fetch', () => {
    const next = addFxUpdate(empty, data([5, 5.5, 6]), 30, new Date('2026-10-30T10:00:00Z'));
    expect(next.values).toEqual([5, 5.5, 6]);
    expect(next.dates).toHaveLength(3);
  });

  test('drops updates older than the period', () => {
    const old = addFxUpdate(empty, data([5, 6]), 30, new Date('2026-09-01T10:00:00Z'));
    const next = addFxUpdate(old, data([5, 6]), 30, new Date('2026-10-30T10:00:00Z'));
    expect(next.updates).toHaveLength(1);
  });

  test('ignores a fetch without data', () => {
    expect(addFxUpdate(empty, data([]), 30, new Date())).toBe(empty);
  });
});

describe('mergeFxHistory', () => {
  const upd = (at: string, value: number) => ({ at, value, change: 0, percent: 0 });

  test('joins updates once per fetch time, oldest first', () => {
    const prev = { updates: [upd('2026-10-31T10:00:00.000Z', 6), upd('2026-11-01T10:00:00.000Z', 7)], dates: ['a'], values: [1] };
    const extra = { updates: [upd('2026-10-30T10:00:00.000Z', 5), upd('2026-10-31T10:00:00.000Z', 6)], dates: ['b'], values: [2] };
    const merged = mergeFxHistory(prev, extra);
    expect(merged.updates.map((u) => u.at)).toEqual(['2026-10-30T10:00:00.000Z', '2026-10-31T10:00:00.000Z', '2026-11-01T10:00:00.000Z']);
    expect(merged.values).toEqual([1]);
  });

  test('takes the extra series when there is none', () => {
    expect(mergeFxHistory(empty, { updates: [], dates: ['b'], values: [2] }).values).toEqual([2]);
  });
});
