import { expect, test } from 'bun:test';
import { coalescer } from './coalesce.ts';

test('runs one job per key at a time and folds the calls made meanwhile into one more run', async () => {
  const runs: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const run = coalescer<string>(async (arg, key) => {
    runs.push(`${key}:${arg}`);
    if (arg === 'first') await gate;
  });
  const first = run('first', 'k');
  const second = run('second', 'k');
  const third = run('third', 'k');
  const other = run('x', 'other');
  expect(runs).toEqual(['k:first', 'other:x']);
  release();
  await Promise.all([first, second, third, other]);
  expect(runs).toEqual(['k:first', 'other:x', 'k:third']);
});

test('merges queued arguments and frees the key after a throw', async () => {
  const seen: boolean[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const run = coalescer<boolean>(
    async (force) => {
      seen.push(force);
      if (seen.length === 1) {
        await gate;
        throw new Error('boom');
      }
    },
    (a, b) => a || b,
  );
  const first = run(false).catch((e: Error) => e.message);
  const queued = Promise.all([run(true), run(false)]);
  release();
  expect(await first).toBe('boom');
  await queued;
  expect(seen).toEqual([false, true]);
  await run(false);
  expect(seen).toEqual([false, true, false]);
});
