import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Terminal } from '@xterm/headless';
import { createEarlier } from './earlier.ts';

describe('earlier regex search', () => {
  const dir = `${tmpdir()}/kedalion-earlier-regex-${process.pid}`;
  const file = `${dir}/e.txt`;
  const make = (lines: string[]) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, lines.join('\n') + '\n');
    return createEarlier(new Terminal({ allowProposedApi: true }), file);
  };

  test('a normal pattern matches', async () => {
    const e = make(['alpha', 'beta 42', 'gamma']);
    const r = await e.search('b.ta \\d+', { regex: true });
    expect(r.hits.map((h) => h.line)).toEqual(['beta 42']);
    e.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test.each([
    ['a*a*a*a*a*a*a*b', 0],
    ['(a+)+$', 50],
    ['(.*)(.*)(.*)x', 0],
  ] as const)('%s returns quickly on long lines', async (pattern, count) => {
    const lines = Array.from({ length: 50 }, () => 'a'.repeat(300));
    const e = make(lines);
    const t = Date.now();
    const r = await e.search(pattern, { regex: true });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(r.count).toBe(count);
    e.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a backreference does not compile and returns nothing', async () => {
    const e = make(['abab']);
    expect((await e.search('(ab)\\1', { regex: true })).count).toBe(0);
    e.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
});
