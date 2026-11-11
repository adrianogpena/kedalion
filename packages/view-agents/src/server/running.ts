import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRunning } from '../protocol.ts';
import type { AgentsRestore } from '../settings-types.ts';
import { quarantine } from './session-state.ts';

export type RunningRecord = Pick<AgentRunning, 'id' | 'account' | 'project'>;

export interface RunningStore {
  /** Records the sessions live now plus those still queued for restore (written only when the set changed; never while quitting or before the restore decision). */
  sync(live: RunningRecord[]): void;
  /** Runs the restore check once per call until decided; `listed` tells whether a record matches a listed session (id + account). Returns true once decided. */
  decide(policy: AgentsRestore, liveIds: Iterable<string>, listed: (r: RunningRecord) => boolean): boolean;
  /** The sessions still to restore (not live now); empty after `dismiss` or when skipped. */
  recovery(liveIds: Iterable<string>): RunningRecord[];
  dismiss(): void;
  /** Stops all writes (the app is quitting). */
  setQuitting(): void;
}

const valid = (r: unknown): r is RunningRecord => {
  const x = r as RunningRecord | null;
  return !!x && typeof x.id === 'string' && typeof x.account === 'string';
};

export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export interface RunningOptions {
  pid?: number;
  alive?: (pid: number) => boolean;
}

/** `file` holds `{pid, sessions: {id, account, project?}[]}` (a bare array from older versions is read too); what it held at creation is the "was running" list. */
export function createRunningStore(file: string, opts: RunningOptions = {}): RunningStore {
  const ownPid = opts.pid ?? process.pid;
  const alive = opts.alive ?? pidAlive;
  let previous: RunningRecord[] = [];
  let otherPid: number | undefined;
  let unreadable = false;
  let text: string | undefined;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') unreadable = true;
  }
  if (text !== undefined) {
    try {
      const raw = JSON.parse(text) as unknown;
      const list = Array.isArray(raw) ? raw : (raw as { sessions?: unknown } | null)?.sessions;
      if (Array.isArray(list)) previous = list.filter(valid);
      const pid = (raw as { pid?: unknown } | null)?.pid;
      if (typeof pid === 'number' && pid !== ownPid) otherPid = pid;
    } catch {
      quarantine(file);
    }
  }
  let written = JSON.stringify(previous);
  let queued: RunningRecord[] = [];
  let decided = false;
  let quitting = false;
  const notLive = (ids: Iterable<string>) => {
    const now = new Set(ids);
    return queued.filter((r) => !now.has(r.id));
  };
  return {
    sync(live) {
      if (quitting || !decided || unreadable) return;
      const ids = new Set(live.map((r) => r.id));
      const sessions = [...live, ...queued.filter((r) => !ids.has(r.id))];
      const text = JSON.stringify({ pid: ownPid, sessions });
      if (text === written) return;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, text);
        renameSync(`${file}.tmp`, file);
        written = text;
      } catch {
        /* best effort */
      }
    },
    decide(policy, liveIds, listed) {
      if (decided) return true;
      const live = [...liveIds];
      decided = true;
      if (policy === 'never' || previous.length === 0 || (otherPid !== undefined && alive(otherPid)) || live.length > 0) return true;
      queued = previous.filter(listed);
      return true;
    },
    recovery(liveIds) {
      return notLive(liveIds);
    },
    dismiss() {
      queued = [];
    },
    setQuitting() {
      quitting = true;
    },
  };
}
