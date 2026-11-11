import { spawn } from 'node:child_process';

export type RunResult = { kind: 'done'; code: number; stdout: string; stderr: string } | { kind: 'timeout' };

/** Runs a command and collects its output; faked in tests. */
export type Runner = (cmd: string[], timeoutMs: number) => Promise<RunResult>;

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Reads a stream as text; past `MAX_OUTPUT_BYTES` it stops reading and calls `onOverflow`. */
async function readCapped(stream: ReadableStream<Uint8Array>, reader: { current?: { cancel(): Promise<void> } }, onOverflow: () => void): Promise<string> {
  const r = stream.getReader();
  reader.current = r;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      size += value.length;
      if (size > MAX_OUTPUT_BYTES) {
        onOverflow();
        await r.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  } catch {
    // cancelled or stream error: keep what was read
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const runWithTimeout: Runner = async (cmd, timeoutMs) => {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const out: { current?: { cancel(): Promise<void> } } = {};
  const err: { current?: { cancel(): Promise<void> } } = {};
  const overflow = () => killTree(proc.pid);
  const done = Promise.all([readCapped(proc.stdout, out, overflow), readCapped(proc.stderr, err, overflow), proc.exited]);
  const result = await Promise.race([done, timedOut]);
  clearTimeout(timer);
  if (result === 'timeout') {
    killTree(proc.pid);
    void out.current?.cancel().catch(() => {});
    void err.current?.cancel().catch(() => {});
    return { kind: 'timeout' };
  }
  const [stdout, stderr, code] = result;
  return { kind: 'done', code, stdout, stderr };
};

/**
 * Kills a child process and everything it spawned. Shims (scoop, Chocolatey) run the real exe as
 * their own child, so a plain kill would leave that one alive. Elsewhere it signals the process
 * group (children started `detached` lead their own group) and falls back to the process alone.
 */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    Bun.spawn(['taskkill', '/PID', String(pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true });
  } else {
    killPosix(pid);
  }
}

function killPosix(pid: number): void {
  try {
    process.kill(-pid);
    return;
  } catch {
    // not a group leader
  }
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
}

/** `killTree` that returns once the tree is gone, e.g. right before `process.exit`. */
export function killTreeSync(pid: number): void {
  if (process.platform === 'win32') {
    Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  } else {
    killPosix(pid);
  }
}

/**
 * Polls `url` until it answers with any HTTP status. Resolves true then, false after `timeoutMs`
 * or once `until` returns true (e.g. the server process exited).
 */
export async function waitForUrl(url: string, opts: { timeoutMs: number; until?: () => boolean }): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline && !opts.until?.()) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      return true;
    } catch {
      await Bun.sleep(200);
    }
  }
  return false;
}

/**
 * Starts `argv` outside this process's job object, so it outlives this process. Resolves once it
 * started; rejects when it could not (e.g. missing exe).
 */
export function startDetached(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd) return Promise.reject(new Error('empty command'));
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => resolve());
    child.once('error', reject);
    child.unref();
  });
}
