import { invalid, notFound } from '@kedalion/server-core';
import { openExternal } from '@kedalion/platform';
import type { PanelCtx, PanelRoutes } from './ctx.ts';
import { detectTargets, findUrl, type RunTarget } from './run-detect.ts';

const MAX_LOG = 200_000;

export type RunStatus = 'running' | 'stopped' | 'exited';

export interface RunState {
  target: string;
  status: RunStatus;
  exitCode?: number | null;
  url?: string;
  log: string;
}

interface Run {
  proc: ReturnType<typeof Bun.spawn>;
  state: RunState;
  done: Promise<void>;
  stopping: boolean;
}

/** Kills a process and its children. */
async function killTree(pid: number, proc: { kill(): void }): Promise<void> {
  if (process.platform === 'win32') {
    const k = Bun.spawn(['taskkill', '/PID', String(pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true });
    await k.exited.catch(() => undefined);
  } else {
    proc.kill();
  }
}

async function pump(stream: ReadableStream<Uint8Array> | undefined, state: RunState): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    state.log += decoder.decode(chunk, { stream: true });
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    state.url ??= findUrl(state.log);
  }
}

/**
 * Server routes of the Run panel: the runnable targets of a project (`run-detect.ts`) and the processes started
 * from them. The client sends only a target id; the command always comes from detection.
 */
export const routes: PanelRoutes = (ctx: PanelCtx) => {
  const runs = new Map<string, Run>();
  const keyOf = (root: string, target: string) => `${root}\n${target}`;

  process.on('exit', () => {
    for (const run of runs.values()) {
      if (run.state.status !== 'running' || !run.proc) continue;
      try {
        if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/PID', String(run.proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true });
        else run.proc.kill();
      } catch {
        // already gone
      }
    }
  });

  const rootOf = (project: string | null) => {
    const root = project ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('project', 'Unknown project.');
    return root;
  };
  const targetOf = async (root: string, id: unknown): Promise<RunTarget> => {
    if (typeof id !== 'string') throw invalid('badRequest', 'Invalid request.');
    const found = (await detectTargets(root)).find((x) => x.id === id);
    if (!found) throw notFound('target', 'Unknown run target.');
    return found;
  };
  const stateOf = (root: string, id: string): RunState => runs.get(keyOf(root, id))?.state ?? { target: id, status: 'stopped', log: '' };

  /** Runs start/stop one at a time per target, so concurrent requests cannot spawn twice and orphan a process. */
  const locks = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = next.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return next;
  }

  async function stop(root: string, id: string): Promise<void> {
    const run = runs.get(keyOf(root, id));
    if (!run || run.state.status !== 'running') return;
    run.stopping = true;
    await killTree(run.proc.pid, run.proc);
    await run.done;
  }

  async function start(root: string, target: RunTarget): Promise<void> {
    await stop(root, target.id);
    const state: RunState = { target: target.id, status: 'running', log: '' };
    const exe = Bun.which(target.cmd[0]!) ?? target.cmd[0]!;
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([exe, ...target.cmd.slice(1)], { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    } catch (err) {
      state.status = 'exited';
      state.exitCode = null;
      state.log = `${err instanceof Error ? err.message : String(err)}\n`;
      runs.set(keyOf(root, target.id), { proc: undefined as never, state, done: Promise.resolve(), stopping: false });
      return;
    }
    const run: Run = { proc, state, done: Promise.resolve(), stopping: false };
    run.done = Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>, state), pump(proc.stderr as ReadableStream<Uint8Array>, state), proc.exited]).then(
      ([, , code]) => {
        state.exitCode = code;
        state.status = run.stopping ? 'stopped' : 'exited';
      },
      () => {
        state.status = run.stopping ? 'stopped' : 'exited';
      },
    );
    runs.set(keyOf(root, target.id), run);
  }

  return {
    'GET /api/agents/run/targets': async ({ query }) => {
      const root = rootOf(query.get('project'));
      const targets = await detectTargets(root);
      return { targets, runs: targets.map((x) => ({ ...stateOf(root, x.id), log: '' })) };
    },
    'GET /api/agents/run/logs': async ({ query }) => {
      const root = rootOf(query.get('project'));
      return stateOf(root, query.get('target') ?? '');
    },
    'POST /api/agents/run/start': async ({ json }) => {
      const b = await json<{ project?: string; target?: string }>();
      const root = rootOf(b.project ?? null);
      const target = await targetOf(root, b.target);
      await serial(keyOf(root, target.id), () => start(root, target));
      return { ...stateOf(root, b.target!), log: '' };
    },
    'POST /api/agents/run/stop': async ({ json }) => {
      const b = await json<{ project?: string; target?: string }>();
      const root = rootOf(b.project ?? null);
      await targetOf(root, b.target);
      await serial(keyOf(root, b.target!), () => stop(root, b.target!));
      return { ...stateOf(root, b.target!), log: '' };
    },
    'POST /api/agents/run/open': async ({ json }) => {
      const b = await json<{ project?: string; target?: string }>();
      const root = rootOf(b.project ?? null);
      const url = stateOf(root, typeof b.target === 'string' ? b.target : '').url;
      if (!url) throw notFound('url', 'No URL detected.');
      openExternal(url);
      return { ok: true };
    },
  };
};
