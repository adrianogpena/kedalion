import { afterEach, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTailer, type TailEvent, eventsOfLine } from './tail.ts';

const user = (text: string) => JSON.stringify({ type: 'user', message: { content: text } }) + '\n';
const asst = (...blocks: unknown[]) => JSON.stringify({ type: 'assistant', message: { id: 'm', content: blocks } }) + '\n';

let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const tmp = () => join((dir = mkdtempSync(join(tmpdir(), 'tail-'))), 's.jsonl');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('eventsOfLine', () => {
  test('keeps user text, assistant text and tool calls; drops thinking and echoes', () => {
    expect(eventsOfLine(user('hi'))).toEqual([{ type: 'user', text: 'hi' }]);
    expect(eventsOfLine(user('<command-name>/clear</command-name>'))).toEqual([]);
    expect(eventsOfLine(user('<local-command-stdout>x</local-command-stdout>'))).toEqual([]);
    expect(eventsOfLine(user('<bash-input>git pull</bash-input>'))).toEqual([]);
    expect(eventsOfLine(asst({ type: 'thinking', thinking: 't' }, { type: 'tool_use', id: 'a', name: 'X' })).map((e) => e.type)).toEqual(['tool_use']);
    expect(eventsOfLine(asst({ type: 'text', text: 'yo' }))).toEqual([{ type: 'text', text: 'yo', messageId: 'm' }]);
  });

  test('a task notification becomes a notice with its summary', () => {
    const xml = '<task-notification>\n<task-id>a1</task-id>\n<summary>Agent "X" finished</summary>\n</task-notification>';
    expect(eventsOfLine(user(xml))).toEqual([{ type: 'notice', text: 'Agent "X" finished' }]);
  });
});

describe('createTailer', () => {
  test('backfills, follows appends, keeps partial line, handles truncation', async () => {
    const f = tmp();
    writeFileSync(f, user('one'));
    const seen: TailEvent[][] = [];
    const t = createTailer(f, (x) => seen.push([...x]), 20);
    expect(seen.at(-1)).toEqual([{ type: 'user', text: 'one' }]);
    const line = asst({ type: 'text', text: 'two' });
    appendFileSync(f, line.slice(0, 10));
    await wait(80);
    expect(seen.length).toBe(1);
    appendFileSync(f, line.slice(10));
    await wait(80);
    expect(seen.at(-1)?.map((x) => (x as { text: string }).text)).toEqual(['one', 'two']);
    writeFileSync(f, user('new'));
    await wait(80);
    expect(seen.at(-1)).toEqual([{ type: 'user', text: 'new' }]);
    t.stop();
  });

  test('drops the cut first line when the window misses the file start and caps the ring', () => {
    const f = tmp();
    let body = '';
    for (let i = 0; i < 20000; i++) body += user(`message number ${i} ${'x'.repeat(40)}`);
    writeFileSync(f, body);
    let got: TailEvent[] = [];
    const t = createTailer(f, (x) => (got = [...x]), 1000);
    t.stop();
    expect(got.length).toBe(600);
    expect((got.at(-1) as { text: string }).text.startsWith('message number 19999')).toBe(true);
  });
});
