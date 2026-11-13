import { expect, test } from 'bun:test';
import type { AgentSubagentInfo, AgentTraceStep } from '../../protocol';
import { agentsOf, commandsOf, phaseProgress, promptRows, todosOf, webCallsOf } from './views';

const cost = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
const steps: AgentTraceStep[] = [
  { kind: 'user', label: 'first', detail: 'first', ts: 1000 },
  { kind: 'assistant', label: 'a', detail: 'a', ts: 3000, cost: cost(1) },
  { kind: 'tool', label: 'Bash(ls)', detail: '', tool: 'Bash', command: 'ls', ts: 4000, durationMs: 50, error: true, exitCode: 2, resultChars: 40 },
  { kind: 'tool', label: 'TodoWrite', detail: '', tool: 'TodoWrite', ts: 4500, todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }] },
  { kind: 'tool', label: 'TodoWrite', detail: '', tool: 'TodoWrite', ts: 5000, todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'pending' }] },
  { kind: 'tool', label: 'Agent', detail: '', tool: 'Agent', toolUseId: 'tu1', ts: 5500, subagent: { type: 'Explore', description: 'look', background: true } },
  { kind: 'tool', label: 'Edit', detail: '', tool: 'Edit', file: 'a.ts', edits: [{ old: 'x', new: 'y' }], ts: 6000 },
  { kind: 'tool', label: 'WebFetch(https://x.dev)', detail: '', tool: 'WebFetch', target: 'https://x.dev', ts: 6500 },
  { kind: 'tool', label: 'mcp', detail: '', tool: 'mcp__srv__lookup', ts: 6600, error: true },
  { kind: 'user', label: 'notice', detail: '', source: 'task', ts: 7000, notice: { toolUseId: 'tu1', status: 'completed', summary: 'done', tokens: 900, toolUses: 3, durationMs: 4000 } },
  { kind: 'user', label: 'second', detail: 'second', ts: 8000 },
  { kind: 'assistant', label: 'b', detail: 'b', ts: 9000, cost: cost(3) },
];

test('commands carry status and exit code', () => {
  expect(commandsOf(steps)).toEqual([{ i: 2, command: 'ls', error: true, pending: false, ts: 4000, exitCode: 2, durationMs: 50, tokens: 10 }]);
});

test('todos track what was added and completed between writes', () => {
  const h = todosOf(steps);
  expect(h.writes[1]).toMatchObject({ added: ['c'], completed: ['a'], done: 1 });
  expect(h.open.map((x) => x.content)).toEqual(['b', 'c']);
});

test('a background agent is finished by its notification', () => {
  expect(agentsOf(steps)).toMatchObject([{ type: 'Explore', background: true, status: 'done', tokens: 900, toolUses: 3, durationMs: 4000, summary: 'done', noticeI: 9 }]);
});

test('prompt rows sum the turn after each prompt', () => {
  const rows = promptRows(steps);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ i: 0, calls: 7, errors: 2, cost: 1, files: 1, answerMs: 2000 });
  expect(rows[1]).toMatchObject({ i: 10, calls: 0, cost: 3, answerMs: 1000 });
});

test('web and mcp calls are grouped by server', () => {
  expect(webCallsOf(steps).map((w) => [w.group, w.tool, w.target, w.error])).toEqual([['web', 'WebFetch', 'https://x.dev', false], ['srv', 'lookup', 'mcp', true]]);
});

test('a workflow run is a group of its agents, totals summed and unfinished agents stopped once it ends', () => {
  const run: AgentTraceStep[] = [
    { kind: 'tool', label: 'Workflow(review)', detail: '', tool: 'Workflow', toolUseId: 'w1', ts: 100, subagent: { type: 'workflow', background: true, description: 'Review it', workflow: { name: 'review', runId: 'wf_1', phases: ['Find', 'Verify'] } } },
  ];
  const infos: AgentSubagentInfo[] = [
    { agentId: 'a1', runId: 'wf_1', phase: 'Find', description: 'bugs', status: 'done', toolUses: 4, errors: 0, tokens: 100, cost: 0.5, startedAt: 100, endedAt: 600 },
    { agentId: 'a2', runId: 'wf_1', phase: 'Find', description: 'perf', status: 'running', toolUses: 2, errors: 1, tokens: 50, cost: 0.25, current: 'Read(a.ts)' },
    { agentId: 'x', status: 'done', toolUses: 9, errors: 0 },
  ];
  const [row] = agentsOf(run, infos);
  expect(row).toMatchObject({ type: 'workflow', status: 'running', tokens: 150, cost: 0.75, toolUses: 6, runId: 'wf_1' });
  expect(row!.workflow!.agents.map((a) => [a.description, a.status, a.current, a.durationMs])).toEqual([['bugs', 'done', undefined, 500], ['perf', 'running', 'Read(a.ts)', undefined]]);
  expect(phaseProgress(row!)).toEqual([{ phase: 'Find', ended: 1, total: 2 }, { phase: 'Verify', ended: 0, total: 0 }]);
  const ended = [...run, { kind: 'user', label: 'n', detail: '', source: 'task', ts: 900, notice: { toolUseId: 'w1', status: 'completed', result: '"done"' } } as AgentTraceStep];
  const [done] = agentsOf(ended, infos);
  expect(done).toMatchObject({ status: 'done', result: '"done"' });
  expect(done!.workflow!.agents[1]).toMatchObject({ status: 'stopped' });
  expect(done!.workflow!.agents[1]!.current).toBeUndefined();
});

test('a launched agent takes cost and its id from its own transcript', () => {
  const s: AgentTraceStep = { kind: 'tool', label: 'Agent', detail: '', tool: 'Agent', toolUseId: 't', ts: 1, subagent: { agentId: 'x', background: true } };
  expect(agentsOf([s], [{ agentId: 'x', status: 'running', toolUses: 3, errors: 0, cost: 0.1, model: 'claude-sonnet-5-5', current: 'Bash(ls)' }])[0]).toMatchObject({ agentId: 'x', cost: 0.1, toolUses: 3, model: 'sonnet 5.5', current: 'Bash(ls)', status: 'running' });
});
