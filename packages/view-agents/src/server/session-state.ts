import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentPin, AgentSessionState, AgentTagCount } from '../protocol.ts';

export const SETTLE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Claude session id (a UUID); anything else is refused as a session-state key. */
export const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);

export interface SessionStateStore {
  get(id: string): AgentSessionState | undefined;
  /** Merges a patch: `name` '' or null clears it; `pin` 'top'|'bottom'|'none'|null sets it, 'cycle' steps none > top > bottom > none (legacy `pinned` boolean = top/none); `archived` false stays stored (an explicit unarchive blocks auto-settle). Returns the new state. */
  set(id: string, patch: { pin?: unknown; pinned?: unknown; name?: unknown; archived?: unknown; tags?: unknown }): AgentSessionState;
  /** Appends the normalised `tags` to each id's tags in input order (never replaces). */
  addTags(ids: string[], tags: unknown): void;
  /** Removes the exact `tag` from every stored session carrying it (limited to `ids` when given); returns how many sessions changed. */
  removeTag(tag: string, ids?: string[]): number;
  /** Marks archived the stopped sessions idle for 7+ days that were never archived or unarchived by hand; true when any changed. */
  settle(sessions: Array<{ id: string; status: string; updatedAt: number }>, now?: number): boolean;
}

/** Reads one stored entry: `pinned: true` (old format) becomes pin 'top'; a pin other than top/bottom is none. */
export function normalizeState(v: Record<string, unknown>): AgentSessionState {
  const { pinned, pin, ...rest } = v;
  const out = rest as AgentSessionState;
  const p = pin === 'top' || pin === 'bottom' ? pin : pin === undefined && pinned === true ? 'top' : undefined;
  if (p) out.pin = p;
  const tags = normalizeTags(out.tags);
  if (tags.length) out.tags = tags;
  else delete out.tags;
  return out;
}

/** Tags: split on commas (strings in an array too), trimmed, blanks and exact duplicates dropped, first-seen order, case kept. */
export function normalizeTags(v: unknown): string[] {
  const parts = typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const out: string[] = [];
  for (const part of parts) for (const raw of part.split(',')) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** One row per distinct tag with the number of sessions carrying it, sorted case-insensitively then exactly. */
export function tagCounts(sessions: Array<{ tags?: string[] }>): AgentTagCount[] {
  const counts = new Map<string, number>();
  for (const s of sessions) for (const t of new Set(s.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      const la = a.tag.toLowerCase();
      const lb = b.tag.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
    });
}

/** Next pin in the cycle none > top > bottom > none. */
export const nextPin = (pin: AgentPin | undefined): AgentPin | undefined => (pin === undefined ? 'top' : pin === 'top' ? 'bottom' : undefined);

/** Moves an unreadable JSON file aside (`<file>.corrupt-<epoch ms>`) so the next save does not destroy it. */
export function quarantine(file: string): void {
  const aside = `${file}.corrupt-${Date.now()}`;
  console.error(`Unreadable JSON file moved aside: ${file} -> ${aside}`);
  try {
    renameSync(file, aside);
  } catch {
    /* best effort */
  }
}

/** Writes JSON through a temp file and a rename, so a crash never leaves a truncated file; best effort. */
export function writeJsonSync(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Per-session pin / rename / archive state kept in `file` (`{[sessionId]: {pin?, name?, archived?}}`). */
export function createSessionStateStore(file: string): SessionStateStore {
  let items: Record<string, AgentSessionState> | undefined;
  let unreadable = false;
  const load = () => {
    if (items) return items;
    items = Object.create(null) as Record<string, AgentSessionState>;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') unreadable = true;
      return items; // no state yet
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, v] of Object.entries(raw)) if (v && typeof v === 'object') items[id] = normalizeState(v as Record<string, unknown>);
    } else quarantine(file);
    return items;
  };
  const save = () => {
    if (!unreadable) writeJsonSync(file, items ?? {});
  };
  return {
    get: (id) => load()[id],
    set(id, patch) {
      const cur = { ...load()[id] };
      if (patch.pin === 'cycle') {
        const n = nextPin(cur.pin);
        if (n) cur.pin = n;
        else delete cur.pin;
      } else if (patch.pin === 'top' || patch.pin === 'bottom') cur.pin = patch.pin;
      else if (patch.pin === 'none' || patch.pin === null) delete cur.pin;
      else if (typeof patch.pinned === 'boolean') {
        if (patch.pinned) cur.pin = 'top';
        else delete cur.pin;
      }
      if (typeof patch.archived === 'boolean') cur.archived = patch.archived;
      if (patch.name === null || typeof patch.name === 'string') {
        const n = typeof patch.name === 'string' ? patch.name.trim().slice(0, 200) : '';
        if (n) cur.name = n;
        else delete cur.name;
      }
      if (patch.tags !== undefined) {
        const tags = normalizeTags(patch.tags);
        if (tags.length) cur.tags = tags;
        else delete cur.tags;
      }
      load()[id] = cur;
      save();
      return cur;
    },
    addTags(ids, tags) {
      const add = normalizeTags(tags);
      if (!add.length) return;
      for (const id of new Set(ids)) {
        if (!id) continue;
        const cur = { ...load()[id] };
        cur.tags = normalizeTags([...(cur.tags ?? []), ...add]);
        load()[id] = cur;
      }
      save();
    },
    removeTag(tag, ids) {
      const only = ids && new Set(ids);
      let n = 0;
      for (const [id, st] of Object.entries(load())) {
        if ((only && !only.has(id)) || !st.tags?.includes(tag)) continue;
        const tags = st.tags.filter((t) => t !== tag);
        const next = { ...st };
        if (tags.length) next.tags = tags;
        else delete next.tags;
        load()[id] = next;
        n++;
      }
      if (n) save();
      return n;
    },
    settle(sessions, now = Date.now()) {
      let changed = false;
      for (const s of sessions) {
        if (s.status !== 'stopped' || now - s.updatedAt < SETTLE_AFTER_MS) continue;
        const cur = load()[s.id];
        if (cur?.archived !== undefined) continue;
        load()[s.id] = { ...cur, archived: true };
        changed = true;
      }
      if (changed) save();
      return changed;
    },
  };
}
