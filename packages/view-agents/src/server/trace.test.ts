import { expect, test } from 'bun:test';
import { parseTrace } from './trace.ts';

const j = (o: unknown) => JSON.stringify(o);
const jsonl = [
  j({ type: 'user', message: { content: 'fix the bug\nplease' } }),
  j({ type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', id: 't3' }] } }),
  j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'tool_result', tool_use_id: 't2', is_error: true, content: [] }, { type: 'tool_result', tool_use_id: 'zz', content: 'orphan' }] } }),
  j({ type: 'summary' }),
  '{"type":"assis',
].join('\n');

test('parses steps in order and attaches results', () => {
  const s = parseTrace(jsonl);
  expect(s.map((x) => x.kind)).toEqual(['user', 'assistant', 'tool', 'tool', 'tool']);
  expect(s[0]!.label).toBe('fix the bug');
  expect(s[0]!.detail).toBe('fix the bug\nplease');
  expect(s[2]!.label).toBe('Read(a.ts)');
  expect(s[2]!.detail).toContain('Result: ok');
  expect(s[3]!.detail).toContain('Error: (empty)');
  expect(s[3]!.error).toBe(true);
  expect(s[4]!.label).toBe('tool');
  expect(s[4]!.detail).toBe('tool\nundefined');
});

test('caps labels at 72 chars', () => {
  const s = parseTrace(j({ type: 'user', message: { content: 'x'.repeat(200) } }));
  expect(s[0]!.label.length).toBe(72);
});

test('shell turns become shell-sourced steps with readable text', () => {
  const s = parseTrace([
    j({ type: 'user', message: { content: '<bash-input>git pull</bash-input>' } }),
    j({ type: 'user', message: { content: '<bash-stdout>Already up to date.</bash-stdout><bash-stderr></bash-stderr>' } }),
  ].join('\n'));
  expect(s.map((x) => [x.source, x.label])).toEqual([['shell', '! git pull'], ['shell', 'Already up to date.']]);
});
