import { expect, test } from 'bun:test';
import { gateSize, withRepoGate } from './git-gate.ts';

test('serializes per key, runs other keys at once, survives a rejection', async () => {
  const log: string[] = [];
  const slow = withRepoGate('a', async () => {
    await Bun.sleep(20);
    log.push('a1');
    throw new Error('x');
  });
  const second = withRepoGate('a', async () => void log.push('a2'));
  const other = withRepoGate('b', async () => void log.push('b1'));
  await other;
  expect(log).toEqual(['b1']);
  await expect(slow).rejects.toThrow('x');
  await second;
  expect(log).toEqual(['b1', 'a1', 'a2']);
  await Bun.sleep(0);
  expect(gateSize()).toBe(0);
});
