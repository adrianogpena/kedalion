import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../../../protocol';
import { entriesOf, foldEntries } from '../../trajectory/model';
import { boardOf, routeOf, ROUTE_FADE_MS, ROUTE_HOLD_MS } from './board';

const tool = (area: AgentTraceStep['area'], ts: number, extra: Partial<AgentTraceStep> = {}): AgentTraceStep => ({ kind: 'tool', label: `${area}`, detail: '', tool: 'X', area, ts, durationMs: 10, ...extra });

const steps: AgentTraceStep[] = [
  { kind: 'user', label: 'go', detail: 'go', ts: 0 },
  tool('files', 1, { messageId: 'a' }),
  tool('files', 2, { messageId: 'a' }),
  tool('shell', 3, { messageId: 'b', error: true }),
  tool('files', 4, { messageId: 'c' }),
  tool('shell', 5, { messageId: 'c', pending: true }),
];

test('foldEntries folds finished calls in a row in one area', () => {
  const f = foldEntries(entriesOf(steps));
  expect(f.map((e) => e.i)).toEqual([0, 2, 3, 4, 5]);
  expect(f[1]!.fold).toEqual({ members: [1, 2], ms: 20 });
});

test('boardOf counts calls, requests, errors and running calls', () => {
  const b = boardOf(steps, 10, true);
  expect(b.stations.files.count).toBe(3);
  expect(b.stations.shell).toEqual({ count: 2, running: 1, since: 5, errors: 1 });
  expect(b.stations.model.count).toBe(3);
  expect(b.stations.you.count).toBe(1);
  expect(boardOf(steps, 10, false).stations.shell.running).toBe(0);
  expect(b.feed[0]!.status).toBe('run');
  expect(b.feed.find((r) => r.entry.i === 2)!.more).toBe(1);
});

test('routeOf keeps the last legs and fades them', () => {
  expect(routeOf(steps, 10).map((l) => `${l.from}>${l.to}`)).toEqual(['you>files', 'files>shell', 'shell>files', 'files>shell']);
  expect(routeOf(steps, 5 + ROUTE_HOLD_MS + ROUTE_FADE_MS / 2).at(-1)!.opacity).toBeCloseTo(0.5);
  expect(routeOf(steps, 5 + ROUTE_HOLD_MS + ROUTE_FADE_MS + 1)).toEqual([]);
});

test('a running workflow counts its agents at work, at least one', () => {
  const wf = tool('agents', 1, { toolUseId: 'w', subagent: { background: true, workflow: { runId: 'wf_1' } } });
  const busy = (status: 'running' | 'done') => ({ agentId: status + Math.random(), runId: 'wf_1', status, toolUses: 0, errors: 0 });
  expect(boardOf([wf], 2, true, [busy('running'), busy('running'), busy('done')]).agents).toBe(2);
  expect(boardOf([wf], 2, true, []).agents).toBe(1);
  expect(boardOf([wf, { kind: 'user', label: '', detail: '', source: 'task', notice: { toolUseId: 'w' } }], 2, true, [busy('running')]).agents).toBe(0);
});
