import { expect, test } from 'bun:test';
import type { AgentTraceStep } from '../protocol.ts';
import { diskCheck } from './file-status.ts';
import { averageOf, summaryOf } from './trace-summary.ts';
import { inputExtras, noticeOf, resultExtras, userMarker } from './trace-extras.ts';
import { parseTrace } from './trace.ts';

const j = (o: unknown) => JSON.stringify(o);

test('tool inputs give todos, subagent and web target', () => {
  expect(inputExtras('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'weird' }] })).toEqual({ todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] });
  expect(inputExtras('Agent', { subagent_type: 'Explore', description: 'look', run_in_background: true })).toEqual({ subagent: { type: 'Explore', description: 'look', background: true } });
  expect(inputExtras('WebSearch', { query: 'bun test' })).toEqual({ target: 'bun test' });
});

test('results give exit code, denial and subagent usage', () => {
  const bash = { kind: 'tool', label: '', detail: '', tool: 'Bash' } as AgentTraceStep;
  resultExtras(bash, 'Exit code 127\nnot found', true);
  expect(bash.exitCode).toBe(127);
  const denied = { kind: 'tool', label: '', detail: '', tool: 'Edit' } as AgentTraceStep;
  resultExtras(denied, "The user doesn't want to proceed with this tool use. The tool use was rejected", true);
  expect(denied.marker).toBe('denied');
  const agent = { kind: 'tool', label: '', detail: '', tool: 'Agent', subagent: {} } as AgentTraceStep;
  resultExtras(agent, 'report\n<usage>total_tokens: 1200\ntool_uses: 4\nduration_ms: 9000</usage>', false);
  expect(agent.subagent).toMatchObject({ tokens: 1200, toolUses: 4, durationMs: 9000 });
});

test('markers and task notifications', () => {
  expect(userMarker('[Request interrupted by user]')).toBe('interrupt');
  expect(userMarker('This session is being continued from a previous conversation')).toBe('continued');
  expect(noticeOf('<task-notification><tool-use-id>tu1</tool-use-id><status>completed</status><summary>ok</summary><usage><subagent_tokens>31</subagent_tokens><tool_uses>2</tool_uses><duration_ms>50</duration_ms></usage></task-notification>')).toEqual({ toolUseId: 'tu1', status: 'completed', summary: 'ok', tokens: 31, toolUses: 2, durationMs: 50 });
});

test('parseTrace wires the extras into steps', () => {
  const s = parseTrace([
    j({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'false' } }] } }),
    j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Exit code 1' }] } }),
    j({ type: 'user', message: { content: '[Request interrupted by user]' } }),
  ].join('\n'));
  expect(s[0]).toMatchObject({ exitCode: 1, error: true });
  expect(s[1]).toMatchObject({ marker: 'interrupt', source: 'system' });
});

test('disk check flags later changes and missing files', () => {
  const steps: AgentTraceStep[] = [
    { kind: 'tool', label: '', detail: '', tool: 'Edit', file: '/p/a.ts', edits: [{ old: 'x', new: 'y' }], ts: 10_000 },
    { kind: 'tool', label: '', detail: '', tool: 'Edit', file: '/p/b.ts', edits: [{ old: 'x', new: 'y' }], ts: 10_000 },
    { kind: 'tool', label: '', detail: '', tool: 'Edit', file: '/p/c.ts', edits: [{ old: 'x', new: 'y' }], ts: 10_000 },
  ];
  const stat = (p: string) => (p === '/p/a.ts' ? { mtimeMs: 20_000 } : p === '/p/b.ts' ? { mtimeMs: 10_500 } : undefined);
  expect(diskCheck(steps, stat)).toEqual({ '/p/a.ts': 'changed', '/p/c.ts': 'missing' });
});

test('summaries and their average', () => {
  const steps: AgentTraceStep[] = [
    { kind: 'user', label: 'p', detail: 'p', ts: 0 },
    { kind: 'tool', label: '', detail: '', tool: 'Edit', file: 'a', edits: [{ old: '', new: 'x' }], error: true, ts: 1000 },
    { kind: 'assistant', label: 'a', detail: '', ts: 4000, tokens: { input: 1, output: 7, cacheRead: 0, cacheWrite: 0 }, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, context: 50 },
  ];
  const a = summaryOf('a', steps);
  expect(a).toMatchObject({ prompts: 1, toolCalls: 1, errors: 1, spanMs: 4000, outputTokens: 7, cost: 2, filesEdited: 1, peakContext: 50 });
  expect(averageOf([a, { ...a, cost: 4 }])?.cost).toBe(3);
  expect(averageOf([])).toBeUndefined();
});
