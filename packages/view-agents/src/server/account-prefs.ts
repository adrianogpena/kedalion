import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ACCOUNT_STATUS_ICONS, ACCOUNT_STATUS_KEYS, ACCOUNT_USAGE_BOOL_KEYS, type AccountPrefs, type AccountPrefsMap, type AccountUsagePrefs } from '../protocol.ts';
import { quarantine } from './session-state.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

function usageOf(v: unknown): AccountUsagePrefs | undefined | null {
  if (!isRecord(v) || !only(v, [...ACCOUNT_USAGE_BOOL_KEYS, 'position'])) return null;
  const out: Record<string, unknown> = {};
  for (const k of ACCOUNT_USAGE_BOOL_KEYS) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== 'boolean') return null;
    out[k] = v[k];
  }
  if (v.position !== undefined) {
    if (v.position !== 'top' && v.position !== 'bottom') return null;
    out.position = v.position;
  }
  return Object.keys(out).length ? (out as AccountUsagePrefs) : undefined;
}

function iconsOf(v: unknown): AccountPrefs['icons'] | undefined | null {
  if (!isRecord(v) || !only(v, ACCOUNT_STATUS_KEYS)) return null;
  const out: Record<string, string> = {};
  for (const k of ACCOUNT_STATUS_KEYS) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== 'string' || !ACCOUNT_STATUS_ICONS[k].includes(v[k])) return null;
    out[k] = v[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Strict check of a prefs map: known account ids (when `known` is given), known keys, boolean toggles, curated icon ids.
 * Returns the cleaned map (empty entries dropped), or undefined when anything is invalid.
 */
export function validateAccountPrefs(input: unknown, known?: readonly string[]): AccountPrefsMap | undefined {
  if (!isRecord(input)) return undefined;
  const out: AccountPrefsMap = {};
  for (const [id, raw] of Object.entries(input)) {
    if (known && !known.includes(id)) return undefined;
    if (!isRecord(raw) || !only(raw, ['usage', 'icons'])) return undefined;
    const entry: AccountPrefs = {};
    if (raw.usage !== undefined) {
      const u = usageOf(raw.usage);
      if (u === null) return undefined;
      if (u) entry.usage = u;
    }
    if (raw.icons !== undefined) {
      const i = iconsOf(raw.icons);
      if (i === null) return undefined;
      if (i) entry.icons = i;
    }
    if (entry.usage || entry.icons) out[id] = entry;
  }
  return out;
}

export interface AccountPrefsStore {
  get(): AccountPrefsMap;
  /** Replaces the whole map; false (nothing changed) when `input` is invalid or names an account not in `known`. */
  set(input: unknown, known?: readonly string[]): boolean;
  /** Drops one account's prefs; true when there were any. */
  remove(id: string): boolean;
}

/** Per-account prefs (usage overrides, status icons) kept in `file` as `{[accountId]: AccountPrefs}`; an unreadable or invalid file reads as empty. */
export function createAccountPrefsStore(file: string): AccountPrefsStore {
  let cur: AccountPrefsMap | undefined;
  let unreadable = false;
  const load = (): AccountPrefsMap => {
    if (cur) return cur;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      cur = {};
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') unreadable = true;
      return cur;
    }
    try {
      cur = validateAccountPrefs(JSON.parse(text)) ?? {};
    } catch {
      cur = {};
      quarantine(file);
    }
    return cur;
  };
  const save = () => {
    if (unreadable) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(cur ?? {}));
    } catch {
      /* best effort */
    }
  };
  return {
    get: () => load(),
    set(input, known) {
      const next = validateAccountPrefs(input, known);
      if (!next) return false;
      cur = next;
      save();
      return true;
    },
    remove(id) {
      if (!load()[id]) return false;
      const { [id]: _gone, ...rest } = cur!;
      cur = rest;
      save();
      return true;
    },
  };
}
