import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentStatus } from '../protocol.ts';

export type { AgentStatus };

export interface PidEntry {
  pid: number;
  sessionId: string;
  cwd?: string;
  status?: string;
  updatedAt?: number;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const kernel32Symbols = (FFIType: typeof import('bun:ffi').FFIType) => ({
  OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
  GetProcessTimes: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const);

let k32: { lib: import('bun:ffi').Library<ReturnType<typeof kernel32Symbols>>; ptr: typeof import('bun:ffi').ptr } | null | undefined;

/** kernel32, opened once on first use; null when it cannot be loaded. */
function kernel32() {
  if (k32 !== undefined) return k32;
  try {
    const { dlopen, FFIType, ptr } = require('bun:ffi') as typeof import('bun:ffi');
    k32 = { lib: dlopen('kernel32.dll', kernel32Symbols(FFIType)), ptr };
  } catch {
    k32 = null;
  }
  return k32;
}

/** Creation time of a process as a Windows FILETIME string (what Claude writes as `procStart`); undefined elsewhere or when unreadable. */
export function processStart(pid: number): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const k = kernel32();
  if (!k) return undefined;
  try {
    const { symbols } = k.lib;
    const h = symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!h) return undefined;
    const t = new BigUint64Array(4);
    const ok = symbols.GetProcessTimes(h, k.ptr(t), k.ptr(t, 8), k.ptr(t, 16), k.ptr(t, 24));
    symbols.CloseHandle(h);
    return ok ? t[0].toString() : undefined;
  } catch {
    return undefined;
  }
}

export interface PidScan {
  live: PidEntry[];
  /** Pid files with no Claude process behind them: the pid is dead, or reused by another process (`procStart` differs). */
  stale: Array<PidEntry & { files: string[] }>;
}

/**
 * Scans `<account>/sessions/<pid>.json`; ignores `<pid>.<hash>.key` and unparsable files.
 * A file whose pid is dead, or whose `procStart` differs from the live process's start (pid reused), is stale.
 */
export function scanPidFiles(
  accountDir: string,
  alive: (pid: number) => boolean = isPidAlive,
  startOf: (pid: number) => string | undefined = processStart,
): PidScan {
  const dir = join(accountDir, 'sessions');
  const out: PidScan = { live: [], stale: [] };
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, n), 'utf8'));
      const pid = Number(j.pid ?? n.slice(0, -5));
      if (!Number.isInteger(pid) || typeof j.sessionId !== 'string') continue;
      const entry: PidEntry = {
        pid,
        sessionId: j.sessionId,
        cwd: typeof j.cwd === 'string' ? j.cwd : undefined,
        status: typeof j.status === 'string' ? j.status : undefined,
        updatedAt: typeof j.updatedAt === 'number' ? j.updatedAt : undefined,
      };
      let ours = alive(pid);
      if (ours && typeof j.procStart === 'string') {
        const start = startOf(pid);
        ours = start === j.procStart || (start === undefined && process.platform !== 'win32');
      }
      if (ours) out.live.push(entry);
      else out.stale.push({ ...entry, files: names.filter((f) => f === n || (f.startsWith(`${pid}.`) && f.endsWith('.key'))).map((f) => join(dir, f)) });
    } catch {
      /* best effort */
    }
  }
  return out;
}

/** The pid entries of running Claude processes. */
export function readPidFiles(accountDir: string, alive?: (pid: number) => boolean, startOf?: (pid: number) => string | undefined): PidEntry[] {
  return scanPidFiles(accountDir, alive, startOf).live;
}

export function mapStatus(raw: string | undefined): 'running' | 'needs-you' | 'idle' {
  if (raw === 'busy' || raw === 'shell') return 'running';
  if (raw === 'waiting') return 'needs-you';
  return 'idle';
}

const ORDER: AgentStatus[] = ['exited', 'error', 'needs-you', 'running', 'done', 'starting', 'idle', 'stopped'];

/** Highest-precedence status: exited > error > needs-you > running > done > starting > idle > stopped. */
export function pickStatus(candidates: AgentStatus[]): AgentStatus {
  for (const s of ORDER) if (candidates.includes(s)) return s;
  return 'stopped';
}

/** Options of one poll: the persisted seen marks and the lifecycle sets (sessions with a pty but no pid record yet / whose process ended). */
export interface StatusContext {
  seen?: Record<string, number>;
  starting?: Iterable<string>;
  exited?: Iterable<string>;
}

/**
 * Tracks transitions across polls: the first status is a baseline, running -> idle stamps a done time.
 * A done / error is unseen while its stamp differs from the session's seen mark.
 */
export function createStatusTracker(now: () => number = Date.now) {
  const prev = new Map<string, 'running' | 'needs-you' | 'idle'>();
  const doneAt = new Map<string, number>();
  const errorAt = new Map<string, number>();
  const errored = new Set<string>();
  const dismissed = new Map<string, string>();
  const sinceAt = new Map<string, { status: AgentStatus; at: number }>();
  return {
    /**
     * Feed the live pid entries of one poll (all accounts); returns session id -> status (absent = not running, see `offline`).
     * `screenErrors` (session id -> message) holds the errors found on terminal screens; an error shows until the session runs again.
     */
    update(entries: PidEntry[], screenErrors?: Map<string, string>, ctx: StatusContext = {}): Map<string, AgentStatus> {
      const out = new Map<string, AgentStatus>();
      const live = new Set<string>();
      for (const e of entries) {
        const id = e.sessionId;
        live.add(id);
        const cur = mapStatus(e.status);
        const msg = screenErrors?.get(id);
        if (msg === undefined) dismissed.delete(id);
        if (cur === 'running') {
          errored.delete(id);
          errorAt.delete(id);
          if (msg !== undefined) dismissed.set(id, msg);
        } else if (msg !== undefined && dismissed.get(id) !== msg && !errored.has(id)) {
          errored.add(id);
          errorAt.set(id, now());
        }
        if (prev.get(id) === 'running' && cur === 'idle') doneAt.set(id, now());
        else if (cur !== 'idle') doneAt.delete(id);
        prev.set(id, cur);
        const stamp = doneAt.get(id);
        const base: AgentStatus = cur === 'idle' && stamp !== undefined && stamp !== ctx.seen?.[id] ? 'done' : cur;
        const shown: AgentStatus = errored.has(id) ? 'error' : base;
        const prior = out.get(id);
        out.set(id, pickStatus(prior ? [shown, prior] : [shown]));
      }
      for (const id of ctx.starting ?? []) if (!out.has(id)) out.set(id, screenErrors?.has(id) ? 'error' : 'starting');
      for (const id of ctx.exited ?? []) out.set(id, 'exited');
      for (const id of [...prev.keys()]) {
        if (!live.has(id)) {
          prev.delete(id);
          errored.delete(id);
          dismissed.delete(id);
        }
      }
      return out;
    },
    /** Ids whose last polled status is running or needs-you (Idle, Starting, Done don't count). */
    busy(): string[] {
      return [...prev].filter(([, s]) => s === 'running' || s === 'needs-you').map(([id]) => id);
    },
    /** Status of a session running nowhere: unseen done -> done, unseen error -> exited, else stopped. */
    offline(sessionId: string, seen?: Record<string, number>): AgentStatus {
      const d = doneAt.get(sessionId);
      if (d !== undefined && d !== seen?.[sessionId]) return 'done';
      const e = errorAt.get(sessionId);
      if (e !== undefined && e !== seen?.[sessionId]) return 'exited';
      return 'stopped';
    },
    /** Timestamp of the session's current error, else its current done; what acknowledging stores as the seen mark. */
    stamp(sessionId: string): number | undefined {
      return errorAt.get(sessionId) ?? doneAt.get(sessionId);
    },
    /** When the session got its current status: first sight seeds `fallback`, a change stamps now, an unchanged status keeps its time. */
    since(sessionId: string, status: AgentStatus, fallback: number): number {
      const cur = sinceAt.get(sessionId);
      if (cur && cur.status === status) return cur.at;
      const at = cur ? now() : fallback;
      sinceAt.set(sessionId, { status, at });
      return at;
    },
    /** Drops the done / error / since marks of sessions not in `keep` and not running (no longer listed). */
    prune(keep: Iterable<string>) {
      const k = new Set(keep);
      for (const m of [doneAt, errorAt, sinceAt]) for (const id of [...m.keys()]) if (!k.has(id) && !prev.has(id)) m.delete(id);
    },
    /** Drops the done / error marks of a session replaced by `/clear`, so it shows stopped. */
    settle(sessionId: string) {
      doneAt.delete(sessionId);
      errorAt.delete(sessionId);
      errored.delete(sessionId);
    },
    /** Writes a fresh done (mark unread on a session with no status). */
    forceDone(sessionId: string) {
      doneAt.set(sessionId, now());
    },
  };
}

/** Session ids with a live pid file that none of our terminals runs: Claude in another terminal. */
export function externalIds(entries: PidEntry[], ours: Iterable<string>): Set<string> {
  const mine = new Set(ours);
  return new Set(entries.filter((e) => !mine.has(e.sessionId)).map((e) => e.sessionId));
}
