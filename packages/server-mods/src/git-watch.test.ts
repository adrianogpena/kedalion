import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintsEqual, gitFingerprint, isRelevantEvent, startGitWatch, type WatchFn } from './git-watch.ts';

test('relevance whitelist', () => {
  for (const p of ['HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'index', 'packed-refs', 'refs/heads/main', 'refs\\remotes\\origin\\x']) expect(isRelevantEvent(p)).toBe(true);
  for (const p of ['index.lock', '.watchman-cookie-host-1','objects/ab/cd', 'config', 'refs/heads/main.lock', 'logs/HEAD', 'COMMIT_EDITMSG']) expect(isRelevantEvent(p)).toBe(false);
});

test('fingerprint detects HEAD, FETCH_HEAD and ref changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kfp-'));
  try {
    await mkdir(join(dir, 'refs', 'heads'), { recursive: true });
    await writeFile(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(dir, 'refs', 'heads', 'main'), 'aaa\n');
    const a = await gitFingerprint(dir);
    expect(fingerprintsEqual(a, await gitFingerprint(dir))).toBe(true);
    await writeFile(join(dir, 'FETCH_HEAD'), 'x');
    const b = await gitFingerprint(dir);
    expect(fingerprintsEqual(a, b)).toBe(false);
    await writeFile(join(dir, 'refs', 'heads', 'main'), 'bbb\n');
    expect(fingerprintsEqual(b, await gitFingerprint(dir))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('debounces relevant events and stops', async () => {
  let listener: (e: string, f: string | null) => void = () => {};
  let closed = false;
  const watch: WatchFn = (_d, _o, l) => {
    listener = l;
    return { close: () => void (closed = true) };
  };
  let calls = 0;
  const stop = startGitWatch({ gitDir: 'x', onChange: () => calls++, debounceMs: 20, watch });
  listener('change', 'objects/zz');
  listener('change', 'HEAD');
  listener('change', 'index');
  await Bun.sleep(60);
  expect(calls).toBe(1);
  listener('change', 'HEAD');
  stop();
  await Bun.sleep(40);
  expect(calls).toBe(1);
  expect(closed).toBe(true);
});

test('a burst that never goes quiet fires at the max delay; nameless events count', async () => {
  let listener: (e: string, f: string | null) => void = () => {};
  const watch: WatchFn = (_d, _o, l) => {
    listener = l;
    return { close: () => {} };
  };
  let calls = 0;
  const stop = startGitWatch({ gitDir: 'x', onChange: () => calls++, debounceMs: 30, maxDelayMs: 60, watch });
  for (let i = 0; i < 8; i++) {
    listener('change', i % 2 ? 'HEAD' : null);
    await Bun.sleep(15);
  }
  expect(calls).toBeGreaterThanOrEqual(1);
  stop();
});

test('a rejected fingerprint still fires', async () => {
  let listener: (e: string, f: string | null) => void = () => {};
  const watch: WatchFn = (_d, _o, l) => {
    listener = l;
    return { close: () => {} };
  };
  let calls = 0;
  const stop = startGitWatch({ gitDir: 'x', onChange: () => calls++, debounceMs: 10, watch, fingerprint: () => Promise.reject(new Error('gone')) });
  listener('change', 'HEAD');
  await Bun.sleep(40);
  expect(calls).toBe(1);
  stop();
});
