import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJournal, subagentFile, subagentsOf, summarize } from './subagents.ts';
import { parseTrace } from './trace.ts';

const j = (o: unknown) => JSON.stringify(o);
const root = mkdtempSync(join(tmpdir(), 'kedalion-subagents-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const transcript = (pending: boolean) =>
  [
    j({ type: 'user', isSidechain: true, timestamp: '2026-11-01T10:00:00Z', message: { content: '[Workflow harness — computed task] preamble\nThe computed task text follows:\n  Find bugs\n  in a.ts' } }),
    j({ type: 'assistant', isSidechain: true, timestamp: '2026-11-01T10:00:05Z', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }] } }),
    ...(pending
      ? []
      : [
          j({ type: 'user', isSidechain: true, timestamp: '2026-11-01T10:00:06Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'no' }] } }),
          j({ type: 'assistant', isSidechain: true, timestamp: '2026-11-01T10:00:09Z', message: { id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'All good' }] } }),
        ]),
  ].join('\n');

test('summarize: prompt without the harness preamble, last reply, calls, errors, the call it waits on', () => {
  const done = summarize(parseTrace(transcript(false)));
  expect(done).toMatchObject({ prompt: 'Find bugs\nin a.ts', result: 'All good', toolUses: 1, errors: 1, tokens: 115, model: 'claude-sonnet-5-5', finished: true, endedAt: Date.parse('2026-11-01T10:00:09Z') });
  expect(done.current).toBeUndefined();
  expect(summarize(parseTrace(transcript(true)))).toMatchObject({ current: 'Read(a.ts)', finished: false });
});

test('parseJournal pairs started and result records, in start order', () => {
  const text = [j({ type: 'launched' }), j({ type: 'started', agentId: 'a1', label: 'one', phase: 'P' }), j({ type: 'started', agentId: 'a2', label: 'two' }), j({ type: 'result', agentId: 'a1', result: { status: 'failed', error: 'boom' } }), 'bad'].join('\n');
  expect(parseJournal(text)).toEqual([{ agentId: 'a1', label: 'one', phase: 'P', status: 'failed', result: 'boom' }, { agentId: 'a2', label: 'two', status: 'running' }]);
});

test('subagentsOf reads launched agents and workflow runs next to the session; subagentFile refuses odd ids', () => {
  const session = join(root, 's1.jsonl');
  writeFileSync(session, '');
  const sub = join(root, 's1', 'subagents');
  const run = join(sub, 'workflows', 'wf_1');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(sub, 'agent-x.jsonl'), transcript(false));
  writeFileSync(join(sub, 'agent-x.meta.json'), j({ agentType: 'Explore', description: 'look', finished: true }));
  writeFileSync(join(run, 'agent-a1.jsonl'), transcript(true));
  writeFileSync(join(run, 'agent-a1.meta.json'), j({ agentType: 'general-purpose', workflowPhase: 'P', model: 'sonnet' }));
  writeFileSync(join(run, 'journal.jsonl'), [j({ type: 'started', agentId: 'a1', label: 'one', phase: 'P' })].join('\n'));
  const all = subagentsOf(session);
  expect(all.map((a) => [a.agentId, a.runId, a.type, a.description, a.phase, a.status, a.current])).toEqual([
    ['x', undefined, 'Explore', 'look', undefined, 'done', undefined],
    ['a1', 'wf_1', 'general-purpose', 'one', 'P', 'running', 'Read(a.ts)'],
  ]);
  expect(subagentFile(session, 'a1', 'wf_1')).toBe(join(run, 'agent-a1.jsonl'));
  expect(subagentFile(session, '../x')).toBeUndefined();
  expect(subagentFile(session, 'a1', '..')).toBeUndefined();
});
