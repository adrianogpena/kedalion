import { existsSync } from 'node:fs';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readJsonFile, renameWithRetry, writeJsonAtomic } from '@kedalion/platform';

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrashEntry {
  id: string;
  agent: string;
  title: string;
  originalPath: string;
  trashedAt: number;
}

export type RestoreResult = { ok: true; entry: TrashEntry } | { ok: false; error: 'gone' | 'exists' };

/** An id that is a plain file name: no separators, no `..`. */
export const isSafeId = (id: unknown): id is string => typeof id === 'string' && /^[\w][\w.-]*$/.test(id) && !id.includes('..');

const MANIFEST = 'manifest.json';

function cleanEntries(raw: unknown): TrashEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TrashEntry[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    if (typeof e !== 'object' || e === null) continue;
    if (typeof e.id !== 'string' || !e.id || typeof e.originalPath !== 'string' || !e.originalPath || typeof e.trashedAt !== 'number' || !Number.isFinite(e.trashedAt)) continue;
    out.push({ id: e.id, agent: typeof e.agent === 'string' && e.agent ? e.agent : 'claude', title: typeof e.title === 'string' ? e.title : '', originalPath: e.originalPath, trashedAt: e.trashedAt });
  }
  return out;
}

/** Moves a file or folder: rename, or copy + delete when rename cannot cross drives. */
export async function movePath(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await renameWithRetry(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

/** Trash under `dir`: `<id>.jsonl`, the companion folder `<id>/` and `manifest.json`. Ids are validated before any file is touched. */
export function createTrashStore(dir: string) {
  const manifest = join(dir, MANIFEST);
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job, job);
    chain = run.catch(() => {});
    return run;
  };
  const read = async (): Promise<TrashEntry[]> => cleanEntries(
    await readJsonFile(manifest).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }),
  );
  const write = (entries: TrashEntry[]) => writeJsonAtomic(manifest, entries);

  return {
    /** Entries, newest first. */
    list: (): Promise<TrashEntry[]> => read().then((e) => e.sort((a, b) => b.trashedAt - a.trashedAt)),

    /** Moves the transcript (+ companion folder) into the trash and records it; false for an unsafe id. */
    trash(item: { id: string; file: string; agent?: string; title?: string }, now = Date.now()): Promise<boolean> {
      if (!isSafeId(item.id)) return Promise.resolve(false);
      return exclusive(async () => {
        const companion = join(dirname(item.file), item.id);
        await movePath(item.file, join(dir, `${item.id}.jsonl`));
        if (await isDir(companion)) {
          await rm(join(dir, item.id), { recursive: true, force: true });
          await movePath(companion, join(dir, item.id));
        }
        const rest = (await read()).filter((e) => e.id !== item.id);
        await write([{ id: item.id, agent: item.agent || 'claude', title: item.title ?? '', originalPath: item.file, trashedAt: now }, ...rest]);
        return true;
      });
    },

    /** Moves a trashed session back; never overwrites something already at the original path. */
    restore(id: string): Promise<RestoreResult> {
      if (!isSafeId(id)) return Promise.resolve({ ok: false, error: 'gone' });
      return exclusive(async (): Promise<RestoreResult> => {
        const entries = await read();
        const entry = entries.find((e) => e.id === id);
        const stored = join(dir, `${id}.jsonl`);
        if (!entry || !existsSync(stored)) return { ok: false, error: 'gone' };
        const companion = join(dirname(entry.originalPath), id);
        if (existsSync(entry.originalPath) || (existsSync(join(dir, id)) && existsSync(companion))) return { ok: false, error: 'exists' };
        await movePath(stored, entry.originalPath);
        if (await isDir(join(dir, id))) await movePath(join(dir, id), companion);
        await write(entries.filter((e) => e.id !== id));
        return { ok: true, entry };
      });
    },

    /** Removes entries trashed more than `retentionDays` days ago; unsafe ids stay, failures are skipped. Returns the removed ids. */
    purge(retentionDays: number, now = Date.now()): Promise<string[]> {
      return exclusive(async () => {
        const entries = await read();
        const removed: string[] = [];
        const keep: TrashEntry[] = [];
        for (const e of entries) {
          if (!isSafeId(e.id) || now - e.trashedAt <= retentionDays * DAY_MS) {
            keep.push(e);
            continue;
          }
          try {
            await rm(join(dir, `${e.id}.jsonl`), { force: true });
            await rm(join(dir, e.id), { recursive: true, force: true });
            removed.push(e.id);
          } catch {
            keep.push(e);
          }
        }
        if (removed.length) await write(keep);
        return removed;
      });
    },
  };
}

export type TrashStore = ReturnType<typeof createTrashStore>;
