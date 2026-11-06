import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../../protocol';
import { agentsOf, commandsOf, promptRows, todosOf, webCallsOf } from './views';

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
