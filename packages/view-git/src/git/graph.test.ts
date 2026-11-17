import { describe, expect, test } from 'bun:test';
import { buildGraph, type CommitSummary } from './graph.ts';

const c = (hash: string, ...parents: string[]): CommitSummary => ({ hash, parents });

describe('buildGraph', () => {
  test('linear history stays on lane 0 with one colour and one segment', () => {
    const g = buildGraph([c('a', 'b'), c('b', 'c'), c('c')]);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(new Set(g.rows.map((r) => r.color)).size).toBe(1);
    expect(g.segments).toEqual([{ color: 0, points: [{ row: 0, lane: 0 }, { row: 2, lane: 0 }] }]);
    expect(g.laneCount).toBe(1);
  });

  test('merge opens a second lane that closes on the parent', () => {
    const g = buildGraph([c('m', 'a', 'b'), c('a', 'r'), c('b', 'r'), c('r')]);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    expect(g.laneCount).toBe(2);
    const side = g.segments.find((s) => s.points[0]!.lane === 1)!;
    expect(side.points).toEqual([{ row: 0, lane: 1 }, { row: 3, lane: 0 }]);
    expect(g.rows[2]!.color).not.toBe(g.rows[0]!.color);
  });

  test('lean skips merge edges', () => {
    const g = buildGraph([c('m', 'a', 'b'), c('a'), c('b')], { lean: true });
    expect(g.laneCount).toBe(1);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  test('a parent beyond the page leaves a truncated line', () => {
    const g = buildGraph([c('a', 'zzz')]);
    expect(g.segments).toEqual([{ color: 0, truncated: true, points: [{ row: 0, lane: 0 }, { row: 1, lane: 0 }] }]);
  });
});
