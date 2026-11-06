import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../../protocol';
import { activityOf, contextSeries, costOfSteps, errorsOf, heaviestResults, modelsOf, promptsOf, subagentOf, timeOf, toolDetails } from './stats';

const tk = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({ input, output, cacheRead, cacheWrite });
const steps: AgentTraceStep[] = [
  { kind: 'user', label: 'go', detail: 'go', ts: 0 },
  { kind: 'assistant', label: 'a', detail: 'a', ts: 2000, durationMs: 2000, model: 'm1', tokens: tk(10, 5, 90, 0), cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 }, context: 100, contextPercent: 10 },
  { kind: 'tool', label: 'Bash(x)', detail: '', tool: 'Bash', ts: 3000, durationMs: 1000, error: true, resultChars: 4000 },
  { kind: 'tool', label: 'Bash(y)', detail: '', tool: 'Bash', ts: 4000, durationMs: 3000, resultChars: 400 },
  { kind: 'user', label: 'sh', detail: 'sh', source: 'shell', ts: 5000 },
  { kind: 'user', label: 'next', detail: 'next', ts: 600000 },
  { kind: 'assistant', label: 'b', detail: 'b', ts: 601000, durationMs: 1000, model: 'm2', tokens: tk(5, 5, 20, 5), context: 30, contextPercent: 3 },
  { kind: 'tool', label: 'sub', detail: '', tool: 'Read', sidechain: true, ts: 602000, durationMs: 100 },
];

test('cost, models and cache hit rate', () => {
  const c = costOfSteps(steps);
  expect(c.total).toBe(3.5);
  expect(c.unpriced).toBe(1);
  expect(c.hitRate).toBeCloseTo(110 / 130);
  expect(modelsOf(steps).map((m) => [m.model, m.turns])).toEqual([['m1', 1], ['m2', 1]]);
});

test('time split, context drops and heavy results', () => {
  const t = timeOf(steps);
  expect(t).toMatchObject({ spanMs: 602000, modelMs: 3000, toolMs: 4100, idleMs: 595000 });
  expect(contextSeries(steps).map((p) => p.drop)).toEqual([false, true]);
  expect(heaviestResults(steps).map((h) => [h.i, h.tokens])).toEqual([[2, 1000], [3, 100]]);
});

test('prompts, subagents, errors, activity and tool details', () => {
  expect(promptsOf(steps)).toMatchObject({ you: 2, shell: 1 });
  expect(subagentOf(steps).sub).toMatchObject({ steps: 1, tools: 1 });
  expect(errorsOf(steps)).toEqual([{ tool: 'Bash', calls: 2, errors: 1, retries: 1 }]);
  const a = activityOf(steps)!;
  expect(a.pauses).toBe(1);
  expect(a.counts.reduce((x, y) => x + y, 0)).toBe(8);
  const d = toolDetails(steps).get('Bash')!;
  expect(d.p95).toBe(3000);
  expect(d.resultTokens).toBe(1100);
});
