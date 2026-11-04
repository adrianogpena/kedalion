import { expect, test } from 'bun:test';
import { parseTrace } from './trace.ts';

const j = (o: unknown) => JSON.stringify(o);
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };

const jsonl = [
  j({ type: 'user', timestamp: '2026-01-01T10:00:00.000Z', message: { content: 'edit it' } }),
  j({ type: 'assistant', timestamp: '2026-01-01T10:00:04.000Z', message: { id: 'm1', model: 'claude-x', usage, content: [{ type: 'thinking', thinking: 'plan it' }, { type: 'text', text: 'Sure.' }] } }),
  j({ type: 'assistant', timestamp: '2026-01-01T10:00:05.000Z', message: { id: 'm1', model: 'claude-x', usage, content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } }] } }),
  j({ type: 'user', timestamp: '2026-01-01T10:00:07.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
  j({ type: 'assistant', timestamp: '2026-01-01T10:00:08.000Z', message: { id: 'm2', usage, content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] } }),
].join('\n');

test('adds time, duration, tokens, context and thinking', () => {
  const s = parseTrace(jsonl);
  expect(s.map((x) => x.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'tool']);
  expect(s[1]!.tokens).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 });
  expect(s[1]!.context).toBe(130);
  expect(s[1]!.durationMs).toBe(4000);
  expect(s[2]!.tokens).toBeUndefined();
  expect(s[3]!.tokens).toBeUndefined();
  expect(s[3]!.durationMs).toBe(2000);
  expect(s[3]).toMatchObject({ tool: 'Edit', file: 'a.ts', toolUseId: 't1', edits: [{ old: 'x', new: 'y' }] });
  expect(s[3]!.pending).toBeUndefined();
  expect(s[4]).toMatchObject({ tool: 'Bash', command: 'ls', pending: true });
  expect(s[4]!.context).toBe(130);
});
