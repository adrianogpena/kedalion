import { describe, expect, test } from 'bun:test';
import type { AgentAccountUsage } from '../protocol.ts';
import { createLimitWatch, limitToast } from './limit-alerts.ts';

const crit = { fiveHour: 80, sevenDay: 90 };
const NOW = new Date(2026, 10, 5, 10, 0).getTime();
const acc = (five: number, seven: number, resetsAt = NOW + 3_600_000): AgentAccountUsage => ({
  account: 'a',
  label: 'Work',
  email: 'me@example.com',
  updatedAt: NOW,
  fiveHour: { percent: five, resetsAt },
  sevenDay: { percent: seven, resetsAt },
});

describe('createLimitWatch', () => {
  test('first observation is silent, crossing the critical percent fires once, back under re-arms', () => {
    const w = createLimitWatch(() => NOW);
    expect(w.observe([acc(50, 50)], crit)).toEqual([]);
    expect(w.observe([acc(85, 50)], crit).map((t) => [t.title, t.body.split(' · ')[0]])).toEqual([['5h limit at 85%', 'me@example.com']]);
    expect(w.observe([acc(90, 50)], crit)).toEqual([]);
    expect(w.observe([acc(10, 50)], crit)).toEqual([]);
    expect(w.observe([acc(81, 95)], crit).map((t) => t.title)).toEqual(['5h limit at 81%', '7d limit at 95%']);
  });

  test('a window already red at startup does not fire', () => {
    expect(createLimitWatch(() => NOW).observe([acc(95, 95)], crit)).toEqual([]);
  });
});

describe('limitToast', () => {
  test('body carries the account and the reset time', () => {
    const t = limitToast('fiveHour', { percent: 82.4, resetsAt: NOW + 3_600_000 }, 'me@example.com', NOW);
    expect(t.title).toBe('5h limit at 82%');
    expect(t.body).toMatch(/^me@example.com · Resets at \d/);
  });
});
