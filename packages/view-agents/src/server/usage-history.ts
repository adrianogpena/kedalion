import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AgentAccountUsage, AgentSevenDayHistory } from '../protocol.ts';
import { quarantine } from './session-state.ts';

/** Days of history kept (older ones are dropped on each write). */
export const HISTORY_DAYS = 9;

/** Per account: the last 7d percent seen and the spend added per local day. */
export type SevenDayHistoryFile = Record<string, { last?: number; days: Record<string, number> }>;

/** Local calendar day of a timestamp: 'YYYY-MM-DD'. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** History key of an account: its email, or 'unknown'. */
export const historyKey = (u: { email?: string }): string => u.email || 'unknown';

/**
 * Records one 7d reading; returns whether the history changed. The first reading adds 0, a rise adds the increase,
 * a drop (quota reset) adds the whole new value, an unchanged reading does nothing.
 */
export function recordSevenDay(h: SevenDayHistoryFile, key: string, percent: number, at: number): boolean {
  const entry = (h[key] ??= { days: {} });
  if (entry.last === percent) return false;
  const add = entry.last === undefined ? 0 : percent >= entry.last ? percent - entry.last : percent;
  const day = localDayKey(at);
  entry.days[day] = (entry.days[day] ?? 0) + add;
  entry.last = percent;
  return true;
}

/** Drops days older than `HISTORY_DAYS` (local days before today − 9). */
export function pruneHistory(h: SevenDayHistoryFile, now: number): void {
  const d = new Date(now);
  const cutoff = localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - HISTORY_DAYS).getTime());
  for (const entry of Object.values(h)) {
    for (const day of Object.keys(entry.days)) if (day < cutoff) delete entry.days[day];
  }
}

/** `unreadable` is set when the file could not be read (not just missing); the store then never overwrites it. */
function load(file: string): { data: SevenDayHistoryFile; unreadable: boolean } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { data: {}, unreadable: (e as NodeJS.ErrnoException)?.code !== 'ENOENT' };
  }
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object') return { data: {}, unreadable: false };
    const out: SevenDayHistoryFile = {};
    for (const [k, e] of Object.entries(v as Record<string, { last?: unknown; days?: unknown }>)) {
      if (!e || typeof e !== 'object') continue;
      const days: Record<string, number> = {};
      if (e.days && typeof e.days === 'object') for (const [d, n] of Object.entries(e.days)) if (typeof n === 'number' && Number.isFinite(n)) days[d] = n;
      out[k] = { ...(typeof e.last === 'number' ? { last: e.last } : {}), days };
    }
    return { data: out, unreadable: false };
  } catch {
    quarantine(file);
    return { data: {}, unreadable: false };
  }
}

/** `seven-day-history.json` store: `observe` feeds each refresh's account usage; writes (atomically) only on a change. */
export function createSevenDayHistory(file: () => string | undefined, now: () => number = Date.now) {
  let cache: { file: string; data: SevenDayHistoryFile; unreadable: boolean } | undefined;
  const data = (): SevenDayHistoryFile | undefined => {
    const f = file();
    if (!f) return undefined;
    if (cache?.file !== f) cache = { file: f, ...load(f) };
    return cache.data;
  };
  return {
    observe(accounts: AgentAccountUsage[]): void {
      const h = data();
      const f = file();
      if (!h || !f) return;
      let changed = false;
      for (const a of accounts) {
        if (!a.sevenDay) continue;
        if (recordSevenDay(h, historyKey(a), a.sevenDay.percent, a.sevenDay.updatedAt ?? a.updatedAt)) changed = true;
      }
      if (!changed) return;
      pruneHistory(h, now());
      if (cache?.unreadable) return;
      try {
        mkdirSync(dirname(f), { recursive: true });
        const tmp = `${f}.tmp`;
        writeFileSync(tmp, JSON.stringify(h));
        renameSync(tmp, f);
      } catch {
        /* unwritable: keep the in-memory history */
      }
    },
    /** Spend per account key (email or 'unknown') per local day. */
    get(): AgentSevenDayHistory {
      const h = data() ?? {};
      return Object.fromEntries(Object.entries(h).map(([k, e]) => [k, { ...e.days }]));
    },
  };
}
