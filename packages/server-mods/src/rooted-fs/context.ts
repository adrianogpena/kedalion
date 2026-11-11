import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { moveToTrash } from '@kedalion/platform';
import { forbidden, notFound, socketTickets } from '@kedalion/server-core';
import { pickedPaths } from '../dialogs.ts';
import {
  badPath,
  exists,
  fileNotFound,
  fold,
  inside,
  outsideRoot,
  present,
  realOf,
  segmentsOf,
  type FsEntry,
  type FsRoot,
  type RootedFsOptions,
} from './common.ts';

/** State and helpers every route module shares; one per `rootedFs` call. */
export function createContext(opts: RootedFsOptions) {
  const maxReadBytes = opts.maxReadBytes ?? 5_000_000;
  const trash = opts.trash ?? moveToTrash;
  const saveTargetPicks = (opts.picks ?? { saveTargets: pickedPaths() }).saveTargets;
  /** Targets the user picked in a save dialog; `save-new` writes a given `path` only when it is one of these. */
  const savedTargets = new Set<string>();
  const targetKey = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  // The OS fetches a dragged-out file with no headers, so the URL carries a ticket instead of the session token.
  const downloads = socketTickets<{ file: string; name: string }>({ ttlMs: 60_000 });
  /** Open HTML pages by id: the page's project and folder, valid for an hour. */
  const views = new Map<string, { root: string; dir: string[]; expires: number }>();

  /** `readOut` lets read routes follow a link to a target outside the root; `external` then tells whether it did. */
  async function locate(rootId: unknown, rel: unknown, mustExist = false, readOut = false) {
    const root = typeof rootId === 'string' ? (await opts.roots()).find((r) => r.id === rootId) : undefined;
    if (!root || !isAbsolute(root.path)) throw notFound('rootNotFound', 'This folder is no longer registered or no longer exists.');
    const segments = segmentsOf(rel);
    // A root that is itself a link or junction is fine: its target is the boundary.
    const realRoot = await realpath(root.path).catch(() => {
      throw notFound('rootNotFound', 'This folder is no longer registered or no longer exists.');
    });
    const abs = join(realRoot, ...segments);
    const real = await realOf(realRoot, segments, mustExist);
    const external = !inside(real, realRoot);
    if (external && !readOut) throw outsideRoot();
    return { root, realRoot, segments, abs, real, external };
  }

  type Located = Awaited<ReturnType<typeof locate>>;

  /**
   * The entry `loc` names itself, in its real parent folder: a link, not its target, so renaming
   * or deleting a link never touches what it points to. The parent must be inside the root too.
   */
  async function entryPath(loc: Located, readOut = false): Promise<string> {
    if (!loc.segments.length) throw badPath();
    const parent = await realOf(loc.realRoot, loc.segments.slice(0, -1), false);
    if (!readOut && !inside(parent, loc.realRoot)) throw outsideRoot();
    return join(parent, loc.segments.at(-1)!);
  }

  /**
   * Call immediately before a destructive call on `loc.real` (write, mkdir): resolves the path
   * again and refuses when a link swapped in since `locate` now leads outside the root.
   */
  async function confirm(loc: Located): Promise<void> {
    const real = await realOf(loc.realRoot, loc.segments, false);
    if (!inside(real, loc.realRoot)) throw outsideRoot();
  }

  /** Like `confirm`, for an operation on the entry itself (rename, delete, move): its parent is resolved again. */
  async function confirmEntry(loc: Located): Promise<void> {
    await entryPath(loc);
  }

  const writable = (root: FsRoot) => {
    if (root.readOnly) throw forbidden('rootReadOnly', 'This folder is read-only in the app.');
  };

  /** The entry at `path` (a link stays a link; one pointing outside `realRoot` is marked); null when it's gone. */
  async function describe(path: string, name: string, realRoot: string): Promise<FsEntry | null> {
    const st = await lstat(path).catch(() => null);
    if (!st) return null;
    const below = inside(dirname(path), realRoot) ? {} : { readOnly: true as const };
    if (!st.isSymbolicLink()) {
      const dir = st.isDirectory();
      return { name, kind: dir ? 'dir' : 'file', size: dir ? 0 : st.size, mtime: Math.round(st.mtimeMs), ...below };
    }
    const target = await realpath(path).catch(() => null);
    const tst = target ? await stat(target).catch(() => null) : null;
    if (!target || !tst) return { name, kind: 'link', size: 0, mtime: Math.round(st.mtimeMs), outside: true, ...below };
    const dir = tst.isDirectory();
    const external = inside(target, realRoot) ? {} : { external: true as const };
    return { name, kind: 'link', size: dir ? 0 : tst.size, mtime: Math.round(tst.mtimeMs), target: dir ? 'dir' : 'file', ...external, ...below };
  }

  async function described(path: string, name: string, realRoot: string): Promise<FsEntry> {
    const entry = await describe(path, name, realRoot);
    if (!entry) throw fileNotFound();
    return entry;
  }

  /** Refuses `to` when another entry has that name; a case-only rename of `from` itself is fine. */
  async function refuseExisting(from: string, to: string): Promise<void> {
    if (fold(from) !== fold(to) && (await present(to))) throw exists();
  }

  const fromQuery = (query: URLSearchParams) => ({ root: query.get('root'), path: query.get('path') ?? '' });
  const body = async (json: () => Promise<unknown>) => (await json()) as Record<string, unknown>;

  return {
    opts,
    maxReadBytes,
    trash,
    saveTargetPicks,
    savedTargets,
    targetKey,
    downloads,
    views,
    locate,
    entryPath,
    confirm,
    confirmEntry,
    writable,
    describe,
    described,
    refuseExisting,
    fromQuery,
    body,
  };
}

export type Ctx = ReturnType<typeof createContext>;
export type Located = Awaited<ReturnType<Ctx['locate']>>;
