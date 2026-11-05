import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HistoryEntry } from '../protocol.ts';

/** The commands of every terminal, newest last, kept in one JSON file across runs. */
export interface HistoryStore {
  add(entry: HistoryEntry): void;
  /** Newest first; `query` matches the command or folder (any case); `failed` keeps non-zero exits. */
  list(o?: { query?: string; failed?: boolean; limit?: number }): HistoryEntry[];
  clear(): void;
  /** Writes pending changes now (app quit). */
  flush(): void;
}

const WRITE_DELAY = 1000;

const isEntry = (x: unknown): x is HistoryEntry => {
  const e = x as Partial<HistoryEntry> | null;
  return !!e && typeof e === 'object' && typeof e.command === 'string' && typeof e.cwd === 'string' && typeof e.at === 'number';
};

/** `file` undefined keeps the history in memory only. */
export function historyStore(file: string | undefined, max = 2000): HistoryStore {
  let entries: HistoryEntry[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = (): HistoryEntry[] => {
    if (entries) return entries;
    entries = [];
    if (!file) return entries;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) entries = raw.filter(isEntry).slice(-max);
    } catch {
      // none yet, or unreadable: start empty
    }
    return entries;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!file || !entries) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(entries));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error('terminal history: write failed', err);
    }
  };
  const later = () => {
    if (!file || timer) return;
    timer = setTimeout(flush, WRITE_DELAY);
    (timer as { unref?: () => void }).unref?.();
  };
  return {
    add(entry) {
      const list = load();
      list.push(entry);
      if (list.length > max) list.splice(0, list.length - max);
      later();
    },
    list({ query, failed, limit = 500 } = {}) {
      const q = query?.trim().toLowerCase();
      const out: HistoryEntry[] = [];
      const list = load();
      for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
        const e = list[i];
        if (failed && !e.exitCode) continue;
        if (q && !e.command.toLowerCase().includes(q) && !e.cwd.toLowerCase().includes(q)) continue;
        out.push(e);
      }
      return out;
    },
    clear() {
      entries = [];
      later();
    },
    flush,
  };
}
