import { type Dirent } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { forbidden, invalid, isRecord, notFound, type Routes } from '@kedalion/server-core';
import type { PickedPaths } from './dialogs.ts';
import { type FsEntry, sortEntries } from './rooted-fs.ts';

/** The one-shot sets the in-app file dialog fills on commit; the routes that take a picked path read them. */
export interface DialogPicks {
  /** Files and folders chosen to open. */
  opened: PickedPaths;
  /** Targets chosen to save to. */
  saveTargets: PickedPaths;
}

export const FILE_DIALOG_MAX_ENTRIES = 5000;
const MAX_RECENTS = 10;
const DRIVE_TIMEOUT_MS = 500;
const PLACE_IDS = [
  ['home', ''],
  ['desktop', 'Desktop'],
  ['documents', 'Documents'],
  ['downloads', 'Downloads'],
] as const;

export interface FileDialogPlaces {
  start: string;
  drives: Array<{ path: string; label: string }>;
  places: Array<{ id: 'home' | 'desktop' | 'documents' | 'downloads'; path: string }>;
  recents: string[];
}

export interface FileDialogEntry extends FsEntry {
  hidden?: true;
}

export interface FileDialogListing {
  path: string;
  parent: string | null;
  entries: FileDialogEntry[];
  truncated: boolean;
}

interface DialogState {
  last: Record<string, string>;
  recents: string[];
}

const badPath = () => invalid('badPath', 'Invalid path.');
const BAD_NAME = /[/\\:*?"<>|\0-\x1f]/;

const absolute = (value: unknown): string => {
  if (typeof value !== 'string' || value === '' || !isAbsolute(value)) throw badPath();
  return resolve(value);
};

const isDir = async (path: string) => (await stat(path).catch(() => null))?.isDirectory() === true;

/** Maps a failed file system call to the error the UI shows. */
function fsError(err: unknown): never {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') throw notFound('notFound', 'Not found.');
  if (code === 'EACCES' || code === 'EPERM') throw forbidden('forbidden', 'Access denied.');
  throw err;
}

/** Windows drive roots that answer within the timeout (a disconnected network drive can hang); `/` elsewhere. */
async function drives(): Promise<Array<{ path: string; label: string }>> {
  if (process.platform !== 'win32') return [{ path: '/', label: '/' }];
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const found = await Promise.all(
    letters.map(async (letter) => {
      const path = `${letter}:\\`;
      const ok = await Promise.race([stat(path).then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), DRIVE_TIMEOUT_MS))]);
      return ok ? { path, label: `${letter}:` } : null;
    }),
  );
  return found.filter((d) => d !== null);
}

const isState = (v: unknown): v is DialogState => isRecord(v);

/**
 * The server half of the in-app file dialog; the whole disk is browsable (the server is
 * loopback-only behind the Host/Origin/token checks) but only names and metadata are returned.
 *
 * - `GET /api/file-dialog/places?purpose=&start=` → `{ start, drives, places, recents }`
 * - `GET /api/file-dialog/list?path=` → `{ path, parent, entries, truncated }`
 * - `GET /api/file-dialog/stat?path=` → `{ exists, kind? }`
 * - `POST /api/file-dialog/mkdir {parent, name}` → `{ path }`
 * - `POST /api/file-dialog/commit {mode, path, purpose?}` → `{ ok: true }`
 *
 * `opts.home` holds `file-dialog.json` (the last folder per purpose and the recents);
 * `opts.userHome` is the user's home folder (default `os.homedir()`).
 */
export function fileDialogRoutes(opts: { home: string; picks: DialogPicks; now?: () => number; userHome?: string }): Routes {
  const file = join(opts.home, 'file-dialog.json');
  const userHome = opts.userHome ?? homedir();

  const load = async (): Promise<DialogState> => {
    const raw = await readJsonFile(file, isState);
    const state = (raw ?? {}) as Partial<DialogState>;
    const last: Record<string, string> = {};
    if (isRecord(state.last)) for (const [k, v] of Object.entries(state.last)) if (typeof v === 'string') last[k] = v;
    const recents = Array.isArray(state.recents) ? state.recents.filter((r): r is string => typeof r === 'string') : [];
    return { last, recents };
  };

  let writing: Promise<unknown> = Promise.resolve();
  const record = (purpose: string, folder: string) => {
    const run = async () => {
      const state = await load();
      state.last[purpose] = folder;
      state.recents = [folder, ...state.recents.filter((r) => r !== folder)].slice(0, MAX_RECENTS);
      await writeJsonAtomic(file, state);
    };
    const next = writing.then(run, run);
    writing = next.catch(() => {});
    return next;
  };

  return {
    'GET /api/file-dialog/places': async ({ query }): Promise<FileDialogPlaces> => {
      const state = await load();
      const purpose = query.get('purpose') ?? '';
      const requested = query.get('start');
      let start = userHome;
      if (requested && isAbsolute(requested) && (await isDir(requested))) start = resolve(requested);
      else if (state.last[purpose] && (await isDir(state.last[purpose]!))) start = state.last[purpose]!;
      const places = (
        await Promise.all(
          PLACE_IDS.map(async ([id, sub]) => {
            const path = sub ? join(userHome, sub) : userHome;
            return (await isDir(path)) ? { id, path } : null;
          }),
        )
      ).filter((p) => p !== null);
      return { start, drives: await drives(), places, recents: state.recents };
    },

    'GET /api/file-dialog/list': async ({ query }): Promise<FileDialogListing> => {
      const path = absolute(query.get('path'));
      let dirents: Dirent[];
      try {
        dirents = await readdir(path, { withFileTypes: true });
      } catch (err) {
        return fsError(err);
      }
      const all: FileDialogEntry[] = dirents.map((d) => ({
        name: d.name,
        kind: d.isSymbolicLink() ? 'link' : d.isDirectory() ? 'dir' : 'file',
        size: 0,
        mtime: 0,
        ...(d.name.startsWith('.') ? { hidden: true as const } : {}),
      }));
      sortEntries(all, 'default');
      const entries = all.slice(0, FILE_DIALOG_MAX_ENTRIES);
      for (let i = 0; i < entries.length; i += 200) {
        await Promise.all(
          entries.slice(i, i + 200).map(async (e) => {
            const s = await stat(join(path, e.name)).catch(() => null);
            if (!s) return;
            e.size = e.kind === 'dir' || s.isDirectory() ? 0 : s.size;
            e.mtime = Math.round(s.mtimeMs);
          }),
        );
      }
      const parent = dirname(path);
      return { path, parent: parent === path ? null : parent, entries, truncated: all.length > entries.length };
    },

    'GET /api/file-dialog/stat': async ({ query }) => {
      const s = await stat(absolute(query.get('path'))).catch(() => null);
      if (!s) return { exists: false };
      return { exists: true, kind: s.isDirectory() ? 'dir' : 'file' };
    },

    'POST /api/file-dialog/mkdir': async ({ json }) => {
      const b = await json<{ parent?: unknown; name?: unknown }>();
      const parent = absolute(b.parent);
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (name === '' || name === '.' || name === '..' || BAD_NAME.test(name)) throw invalid('badName', 'Invalid folder name.');
      const path = join(parent, name);
      try {
        await mkdir(path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw invalid('exists', 'It already exists.');
        return fsError(err);
      }
      return { path };
    },

    'POST /api/file-dialog/commit': async ({ json }) => {
      const b = await json<{ mode?: unknown; path?: unknown; purpose?: unknown }>();
      if (b.mode !== 'open' && b.mode !== 'save' && b.mode !== 'folder') throw invalid('badRequest', 'Invalid request.');
      const path = absolute(b.path);
      const purpose = typeof b.purpose === 'string' ? b.purpose.slice(0, 80) : '';
      (b.mode === 'save' ? opts.picks.saveTargets : opts.picks.opened).add(path);
      await record(purpose, b.mode === 'folder' ? path : dirname(path));
      return { ok: true };
    },
  };
}
