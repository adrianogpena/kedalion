import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { chmod, cp, lstat, mkdir, readdir, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { moveToTrash, renameWithRetry, writeFileAtomic } from '@kedalion/platform';
import { AppError, forbidden, type Handler, invalid, ndjson, notFound, type Routes, socketTickets, type TailChunk } from '@kedalion/server-core';
import type { FsCompressResult, FsDuProgress, FsExtractResult, FsHash, FsInfo } from '@kedalion/server-core/protocol';
import { compressArchive, extractArchive, listArchive } from './archive.ts';
import { isBinary } from './bytes.ts';
import { decodeText, detectEncoding, encodeText, encodingByBom, TEXT_ENCODINGS, type TextEncodingId } from './encoding.ts';
import type { DialogPicks } from './file-dialog.ts';
import { pickedPaths } from './dialogs.ts';
import { fromPlatform } from './platform-errors.ts';
import { readSqlite } from './sqlite.ts';

export type { TailChunk };

/** How often `du` reports its running totals. */
const DU_PROGRESS_MS = 150;

/** A folder the app registered; every file route is confined to one. */
export interface FsRoot {
  id: string;
  /** Absolute path. */
  path: string;
  /** Refuses every write route. */
  readOnly?: boolean;
}

export interface RootedFsOptions {
  /** The registered roots, normally from the app's projects record store. */
  roots: () => Promise<FsRoot[]>;
  /** Most bytes `read` returns; a longer file comes back `truncated`. */
  maxReadBytes?: number;
  /** Moves absolute paths to the recycle bin: `moveToTrash` from platform, a fake in tests. */
  trash?: (paths: string[]) => Promise<void>;
  /** False: the delete route takes one path only. Default true. */
  multiDelete?: boolean;
  /** The in-app file dialog's picks: the save routes take a `target` that is in `saveTargets`. Missing: every save is refused. */
  picks?: DialogPicks;
}

export interface Resolved {
  root: FsRoot;
  /** The real root joined with the relative path, links not followed. */
  abs: string;
  /** `abs` with every link followed; inside the real root. */
  real: string;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  /** Bytes; 0 for folders. */
  size: number;
  /** Epoch ms, rounded. */
  mtime: number;
  /** A link whose target is missing; every route but list refuses it. */
  outside?: true;
  /** What a live link points to. */
  target?: 'file' | 'dir';
  /** A live link whose target is outside the root: readable (read routes follow it), never written through. */
  external?: true;
  /** Lives below an external link: readable, not writable. */
  readOnly?: true;
  /** Matches an exclude glob; set only when the list asked for all entries. */
  excluded?: true;
}

export const LIST_SORTS = ['default', 'mixed', 'filesFirst', 'type', 'modified'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

/** The `exclude` query value (a JSON array of globs) as matchers; anything malformed gives none. */
export function parseExclude(raw: string | null): Bun.Glob[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((g): g is string => typeof g === 'string' && g !== '' && g.length <= 200).slice(0, 100).map((g) => new Bun.Glob(g));
  } catch {
    return [];
  }
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

/** Orders the entries of one folder like VS Code's `explorer.sortOrder`; names compare with the collator. */
export function sortEntries(entries: FsEntry[], sort: ListSort): void {
  const isDir = (e: FsEntry) => e.kind === 'dir' || e.target === 'dir';
  const byName = (a: FsEntry, b: FsEntry) => collator.compare(a.name, b.name);
  const dirsFirst = (a: FsEntry, b: FsEntry) => Number(isDir(b)) - Number(isDir(a));
  switch (sort) {
    case 'mixed':
      entries.sort(byName);
      break;
    case 'filesFirst':
      entries.sort((a, b) => -dirsFirst(a, b) || byName(a, b));
      break;
    case 'type':
      entries.sort((a, b) => dirsFirst(a, b) || (isDir(a) ? 0 : collator.compare(extOf(a.name), extOf(b.name))) || byName(a, b));
      break;
    case 'modified':
      entries.sort((a, b) => dirsFirst(a, b) || b.mtime - a.mtime || byName(a, b));
      break;
    default:
      entries.sort((a, b) => dirsFirst(a, b) || byName(a, b));
  }
}

export interface SearchHit {
  /** Relative to the root, `/`-separated. */
  path: string;
  kind: 'file' | 'dir';
  /** 1-based; set on content hits. */
  line?: number;
  text?: string;
}

export interface RootedFs {
  routes: Routes;
  /** Routes outside the session token check (`unauthenticated` of the server): `GET /api/fs/download` takes the one-time ticket from `POST /api/fs/download-ticket`; `GET /api/fs/view/<id>/*` serves the files around an HTML page for `POST /api/fs/view-ticket`. */
  openRoutes: Routes;
  resolve(rootId: string, rel: string, opts?: { mustExist?: boolean }): Promise<Resolved>;
}

export const badPath = () => invalid('badPath', 'Invalid path.');
const badRequest = () => invalid('badRequest', 'Invalid request.');
const MAX_PATHS = 1000;
const outsideRoot = () => forbidden('outsideRoot', 'This path leads outside the project folder.');
const fileNotFound = () => notFound('fileNotFound', 'File or folder not found.');
const exists = () => invalid('exists', 'A file or folder with this name already exists.');
const notADir = () => invalid('notADir', 'This is not a folder.');
const notAFile = () => invalid('notAFile', 'This is not a file.');
const notASaveTarget = () => forbidden('notASaveTarget', 'Choose where to save first.');

const DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const WIN_RESERVED = /[<>"|?*\u0000-\u001f]/;

/**
 * True when `segment` can't be one name in a path: `..`, an alternate data stream (`:`), a
 * trailing dot or space (Windows drops them, so two names would open one file), a Windows device
 * name with or without extension, or a character Windows forbids.
 */
function badSegment(segment: string): boolean {
  if (segment === '..' || segment.includes(':') || segment.includes('\0') || /[. ]$/.test(segment)) return true;
  if (DEVICE.test(segment.split('.')[0]!.trimEnd())) return true;
  return process.platform === 'win32' && WIN_RESERVED.test(segment);
}

/** The segments of a client path: relative, split on `/` and `\`, `.` and empty segments dropped. */
export function segmentsOf(rel: unknown): string[] {
  if (typeof rel !== 'string' || rel.includes('\0') || /^[\\/]/.test(rel) || /^[a-zA-Z]:/.test(rel)) throw badPath();
  const segments = rel.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
  if (segments.some(badSegment)) throw badPath();
  return segments;
}

const validName = (name: unknown): name is string => typeof name === 'string' && !/[\\/]/.test(name) && segmentsOf(name).length === 1;

const fold = process.platform === 'win32' || process.platform === 'darwin' ? (p: string) => p.toLowerCase() : (p: string) => p;

/** True when the real path `path` is `realRoot` or below it. */
function inside(path: string, realRoot: string): boolean {
  const p = fold(path);
  const base = fold(realRoot);
  return p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);
}

const errno = (err: unknown) => (err as NodeJS.ErrnoException)?.code;
const isMissing = (err: unknown) => errno(err) === 'ENOENT' || errno(err) === 'ENOTDIR';

/**
 * `realRoot` joined with `segments`, every existing link followed: the realpath of the nearest
 * existing ancestor plus the segments below it.
 */
async function realOf(realRoot: string, segments: string[], mustExist: boolean): Promise<string> {
  for (let n = segments.length; n > 0; n--) {
    const p = join(realRoot, ...segments.slice(0, n));
    try {
      return join(await realpath(p), ...segments.slice(n));
    } catch (err) {
      if (errno(err) === 'ELOOP') throw outsideRoot();
      if (!isMissing(err)) throw err;
      // A link whose target is missing exists, but where it points can't be checked.
      if (await present(p)) throw outsideRoot();
      if (mustExist) throw fileNotFound();
    }
  }
  return join(realRoot, ...segments);
}

/** The owner may write the file; on Windows false means the read-only attribute is set. */
const ownerWritable = (mode: number) => (mode & 0o200) !== 0;

/** Node fs errors as the AppErrors the UI translates; anything else unchanged. */
function fsError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  switch (errno(err)) {
    case 'ENOENT':
      return fileNotFound();
    case 'EEXIST':
    case 'ENOTEMPTY':
      return exists();
    case 'ENOTDIR':
      return notADir();
    case 'EISDIR':
      return notAFile();
    case 'EXDEV':
      return invalid('crossDevice', "Can't move between drives.");
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return forbidden('accessDenied', 'Access denied, or the file is in use.');
  }
  return err;
}

/** `value` as an integer in `[min, max]`; undefined when absent, `badRequest` otherwise. */
function optionalInt(value: string | null, min: number, max: number): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isSafeInteger(n) || n < min || n > max) throw badRequest();
  return n;
}

const present = (path: string) => lstat(path).then(() => true, () => false);

/** `wanted`, or the first free `name copy.ext`, `name copy 2.ext`, ... next to it. */
async function freeName(wanted: string, isDir: boolean): Promise<string> {
  const ext = isDir ? '' : extname(wanted);
  const stem = basename(wanted, ext);
  let to = wanted;
  for (let n = 1; await present(to); n++) to = join(dirname(wanted), `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`);
  return to;
}

/** True when an entry below `dir` (a real path) resolves outside it: a link out, or a dangling link aiming out. */
async function escapes(dir: string): Promise<boolean> {
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath, e.name);
    let real = await realpath(p).catch(() => null);
    if (real === null) {
      if (!e.isSymbolicLink()) return true;
      real = resolve(dirname(p), await readlink(p));
    }
    if (!inside(real, dir)) return true;
  }
  return false;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const MAX_RAW_BYTES = 50_000_000;
const MAX_TAIL_BYTES = 20_000_000;
const DEFAULT_TAIL_BYTES = 1_000_000;
const MAX_SAVE_RANGE_BYTES = 200_000_000;
const MAX_UPLOAD_BYTES = 200_000_000;
const MAX_SEARCH_HITS = 5000;
const MAX_NAME_HITS = 200_000;
const MAX_CONTENT_BYTES = 1_000_000;
const MAX_HITS_PER_FILE = 20;
const SKIP_DIRS = new Set(['node_modules', '.git']);

const VIEW_TTL_MS = 60 * 60_000;
const VIEW_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const TEXT = 'text/plain; charset=utf-8';
const RAW_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.txt': TEXT,
  '.md': TEXT,
  '.log': TEXT,
  '.csv': TEXT,
  '.json': TEXT,
};

/**
 * Walks the tree below `start` breadth-first and yields name hits (case-insensitive substring of
 * `q`, and `glob` on the name when given) and, with `content`, lines containing `q` in text files
 * up to 1 MB (`glob` then picks the files). Skips `node_modules`, `.git` and links; returns as soon
 * as `signal` aborts. Exported for the tests.
 */
export async function* searchTree(
  start: { abs: string; rel: string },
  query: { q: string; content: boolean; glob: Bun.Glob | null; exclude?: Bun.Glob[] },
  signal: AbortSignal,
): AsyncGenerator<SearchHit> {
  const q = query.q.toLowerCase();
  const nameMatches = (name: string) => (q === '' || name.toLowerCase().includes(q)) && (!query.glob || query.glob.match(name));
  const queue = [start];
  while (queue.length && !signal.aborted) {
    const dir = queue.shift()!;
    let dirents: Dirent[];
    try {
      dirents = await readdir(dir.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    dirents.sort((a, b) => collator.compare(a.name, b.name));
    for (const d of dirents) {
      if (signal.aborted) return;
      if (d.isSymbolicLink() || SKIP_DIRS.has(d.name) || !(d.isDirectory() || d.isFile())) continue;
      const rel = dir.rel ? `${dir.rel}/${d.name}` : d.name;
      if (query.exclude?.some((g) => g.match(rel))) continue;
      const abs = join(dir.abs, d.name);
      if (nameMatches(d.name)) yield { path: rel, kind: d.isDirectory() ? 'dir' : 'file' };
      if (d.isDirectory()) queue.push({ abs, rel });
      else if (query.content && q !== '' && (!query.glob || query.glob.match(d.name))) {
        for (const hit of await contentHits(abs, q)) {
          if (signal.aborted) return;
          yield { path: rel, kind: 'file', ...hit };
        }
      }
    }
  }
}

/** Up to MAX_HITS_PER_FILE lines of a text file containing `q` (lower-cased); [] for big, binary or unreadable files. */
async function contentHits(file: string, q: string): Promise<Array<{ line: number; text: string }>> {
  try {
    if ((await stat(file)).size > MAX_CONTENT_BYTES) return [];
    const bytes = await Bun.file(file).bytes();
    if (isBinary(bytes)) return [];
    const hits: Array<{ line: number; text: string }> = [];
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
      const at = lines[i]!.toLowerCase().indexOf(q);
      if (at < 0) continue;
      // Long lines (minified code) are cut to a window around the match.
      const from = Math.max(0, at - 100);
      hits.push({ line: i + 1, text: lines[i]!.slice(from, from + 300).trim() });
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * File routes confined to the roots the app registers. The client only ever sends a root id and a
 * relative path; `resolve` turns them into a real path inside that root or refuses.
 *
 * GET `/api/fs/list|stat|info|du|hash|read|raw|archive|search|names` take `root` and `path` in the query; POST
 * `/api/fs/create|write|extract|compress|rename|move|delete` take them in the JSON body. POST `/api/fs/upload` takes them
 * in the query and the file's bytes as the body.
 */
export function rootedFs(opts: RootedFsOptions): RootedFs {
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

  // Write routes resolve right before acting and act on the real path. A link swapped in between
  // (by another program writing in the root) can still redirect one operation: that check-then-use
  // window is narrowed, not closed; closing it needs handle-relative calls Node doesn't offer.
  const routes: Routes = {
    'GET /api/fs/list': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const names = await readdir(loc.real);
      let entries = (await Promise.all(names.map((name) => describe(join(loc.real, name), name, loc.realRoot)))).filter(
        (e): e is FsEntry => e !== null,
      );
      const exclude = parseExclude(query.get('exclude'));
      if (exclude.length) {
        const prefix = loc.segments.length ? `${loc.segments.join('/')}/` : '';
        const hit = (e: FsEntry) => exclude.some((g) => g.match(prefix + e.name));
        if (query.get('all') === '1') for (const e of entries) hit(e) && (e.excluded = true);
        else entries = entries.filter((e) => !hit(e));
      }
      const sort = query.get('sort');
      sortEntries(entries, LIST_SORTS.includes(sort as ListSort) ? (sort as ListSort) : 'default');
      return { entries };
    },

    'GET /api/fs/stat': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      return described(loc.segments.length ? await entryPath(loc, true) : loc.realRoot, basename(loc.abs), loc.realRoot);
    },

    'GET /api/fs/info': async ({ query }): Promise<FsInfo> => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      const entry = loc.segments.length ? await entryPath(loc, true) : loc.realRoot;
      const st = await lstat(entry).catch(() => {
        throw fileNotFound();
      });
      const born = Math.round(st.birthtimeMs);
      return {
        name: basename(loc.abs),
        fullPath: entry,
        type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file',
        size: st.isDirectory() ? 0 : st.size,
        created: Number.isFinite(born) && born > 0 ? born : null,
        modified: Math.round(st.mtimeMs),
        accessed: Math.round(st.atimeMs),
        readOnly: !!loc.root.readOnly || loc.external || !ownerWritable(st.mode),
      };
    },

    // Total size of a folder: running totals, then `done`. Links are counted as neither and not followed.
    'GET /api/fs/du': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      return ndjson(req, async (emit, signal) => {
        const totals: FsDuProgress = { files: 0, dirs: 0, bytes: 0 };
        const top = await stat(loc.real);
        if (!top.isDirectory()) {
          totals.files = 1;
          totals.bytes = top.size;
        }
        const queue = top.isDirectory() ? [loc.real] : [];
        let last = Date.now();
        while (queue.length && !signal.aborted) {
          const dir = queue.pop()!;
          const items = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
          for (const d of items) {
            if (signal.aborted) return;
            if (d.isSymbolicLink()) continue;
            const full = join(dir, d.name);
            if (d.isDirectory()) {
              totals.dirs++;
              queue.push(full);
            } else if (d.isFile()) {
              const st = await lstat(full).catch(() => null);
              if (!st) continue;
              totals.files++;
              totals.bytes += st.size;
            }
          }
          if (Date.now() - last >= DU_PROGRESS_MS) {
            last = Date.now();
            await emit({ ...totals });
          }
        }
        if (!signal.aborted) await emit({ ...totals, done: true });
      });
    },

    'GET /api/fs/hash': async ({ req, query }): Promise<FsHash> => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if ((await stat(loc.real)).isDirectory()) throw notAFile();
      const hasher = new Bun.CryptoHasher('sha256');
      for await (const chunk of Bun.file(loc.real).stream()) {
        if (req.signal.aborted) throw invalid('aborted', 'The request was cancelled.');
        hasher.update(chunk);
      }
      return { sha256: hasher.digest('hex') };
    },

    'GET /api/fs/read': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      const bytes = new Uint8Array(await Bun.file(loc.real).slice(0, maxReadBytes).arrayBuffer());
      const mtime = Math.round(st.mtimeMs);
      // UTF-16 is full of NUL bytes: its BOM is checked before the binary test.
      if (!encodingByBom(bytes) && isBinary(bytes)) return { binary: true, size: st.size, mtime };
      const truncated = st.size > maxReadBytes;
      const encoding = detectEncoding(bytes, truncated);
      const text = { text: decodeText(bytes, encoding), encoding, size: st.size, mtime, truncated };
      return loc.root.readOnly || loc.external || !ownerWritable(st.mode) ? { ...text, readOnly: true } : text;
    },

    'GET /api/fs/tail': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const from = optionalInt(query.get('from'), 0, Number.MAX_SAFE_INTEGER);
      const max = optionalInt(query.get('max'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) ?? DEFAULT_TAIL_BYTES;
      const window = Math.min(Math.max(max, 1), MAX_TAIL_BYTES);
      const loc = await locate(root, path, true, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      const { size } = st;
      const mtime = Math.round(st.mtimeMs);
      if (from !== undefined && from > size) {
        const reset: TailChunk = { reset: true, from: size, to: size, size, mtime, text: '' };
        return reset;
      }
      const file = Bun.file(loc.real);
      let start = from ?? Math.max(0, size - window);
      let bytes = new Uint8Array(await file.slice(start, Math.min(size, start + window)).arrayBuffer());
      if (isBinary(bytes)) throw invalid('notText', 'This file is not a text file.');
      if (from === undefined && start > 0) {
        const cut = bytes.indexOf(10);
        if (cut >= 0) {
          start += cut + 1;
          bytes = bytes.subarray(cut + 1);
        }
      }
      const reachesEof = start + bytes.length >= size;
      const lastNl = bytes.lastIndexOf(10);
      const decoder = new TextDecoder();
      const chunk: TailChunk = { from: start, to: start, size, mtime, text: '' };
      if (lastNl < 0 && bytes.length >= window) {
        chunk.to = start + bytes.length;
        chunk.text = decoder.decode(bytes);
      } else {
        chunk.to = start + lastNl + 1;
        chunk.text = decoder.decode(bytes.subarray(0, lastNl + 1));
        if (reachesEof && lastNl + 1 < bytes.length) chunk.partial = decoder.decode(bytes.subarray(lastNl + 1));
      }
      return chunk;
    },

    'POST /api/fs/save-range': async ({ json }) => {
      const b = await body(json);
      if (!Number.isSafeInteger(b.from) || (b.from as number) < 0) throw badRequest();
      const from = b.from as number;
      const loc = await locate(b.root, b.path, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      const size = st.size;
      if (size < from) throw invalid('rangeStale', 'The file is shorter than the bookmark; it was rotated or cleared.');
      if (size - from > MAX_SAVE_RANGE_BYTES) throw invalid('rangeTooLarge', 'The range is too large.');
      if (typeof b.target !== 'string' || !isAbsolute(b.target) || !saveTargetPicks.take(b.target)) throw notASaveTarget();
      const target = b.target;
      savedTargets.add(targetKey(target));
      await writeFileAtomic(target, Bun.file(loc.real).slice(from, size));
      return { path: target, bytes: size - from };
    },

    // An untitled tab: `target` is a path the in-app save dialog returned (taken once from the save
    // targets); `path` writes again to a path an earlier save of this server returned. Any other
    // `path` (say a tab restored after a restart) is refused: the client asks with the dialog.
    'POST /api/fs/save-new': async ({ json }) => {
      const b = await body(json);
      if (typeof b.text !== 'string') throw badRequest();
      const text = b.text;
      let target: string;
      if (b.target !== undefined) {
        if (typeof b.target !== 'string' || !isAbsolute(b.target)) throw badRequest();
        if (!saveTargetPicks.take(b.target)) throw notASaveTarget();
        target = resolve(b.target);
        savedTargets.add(targetKey(target));
      } else {
        if (typeof b.path !== 'string' || !isAbsolute(b.path)) throw badRequest();
        target = resolve(b.path);
        if (!savedTargets.has(targetKey(target))) throw notASaveTarget();
      }
      const st = await stat(target).catch(() => null);
      if (st?.isDirectory()) throw notAFile();
      await writeFileAtomic(target, text);
      return { path: target };
    },

    'GET /api/fs/archive': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if ((await stat(loc.real)).isDirectory()) throw notAFile();
      return listArchive(loc.real);
    },

    'GET /api/fs/sqlite': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if ((await stat(loc.real)).isDirectory()) throw notAFile();
      const offset = Number(query.get('offset') ?? 0);
      try {
        return readSqlite(loc.real, query.get('table'), Number.isFinite(offset) ? offset : 0);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === 'SQLITE_NOTADB' || code?.startsWith('SQLITE_CORRUPT')) throw invalid('notSqlite', 'The file is not a readable SQLite database.');
        throw fsError(err);
      }
    },

    'GET /api/fs/raw': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      // `limit` returns only the first bytes (the hex view), however large the file.
      const limit = Number(query.get('limit'));
      const head = Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
      if (!head && st.size > MAX_RAW_BYTES) throw invalid('fileTooLarge', 'The file is too large to show.');
      return new Response(head ? Bun.file(loc.real).slice(0, head) : Bun.file(loc.real), {
        headers: {
          'Content-Type': RAW_TYPES[extname(loc.real).toLowerCase()] ?? 'application/octet-stream',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
          // Opened as a document (an SVG), the file runs nothing and loads nothing.
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'Cache-Control': 'no-store',
        },
      });
    },

    'GET /api/fs/search': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const glob = query.get('glob') ? new Bun.Glob(query.get('glob')!) : null;
      const search = { q: query.get('q') ?? '', content: query.get('content') === '1', glob, exclude: parseExclude(query.get('exclude')) };
      return ndjson(req, async (emit, signal) => {
        let count = 0;
        for await (const hit of searchTree({ abs: loc.real, rel: loc.segments.join('/') }, search, signal)) {
          await emit(hit);
          if (++count >= MAX_SEARCH_HITS) break;
        }
      });
    },

    // Every file and folder path below `path` (excludes applied), for Quick Open and tree find.
    'GET /api/fs/names': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const search = { q: '', content: false, glob: null, exclude: parseExclude(query.get('exclude')) };
      return ndjson(req, async (emit, signal) => {
        let count = 0;
        for await (const hit of searchTree({ abs: loc.real, rel: loc.segments.join('/') }, search, signal)) {
          await emit(hit);
          if (++count >= MAX_NAME_HITS) break;
        }
      });
    },

    'POST /api/fs/create': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path);
      writable(loc.root);
      if (!loc.segments.length) throw exists();
      if ((b.kind !== 'file' && b.kind !== 'dir') || (b.text !== undefined && typeof b.text !== 'string')) throw badRequest();
      await mkdir(dirname(loc.real), { recursive: true });
      if (b.kind === 'dir') await mkdir(loc.real);
      else await writeFile(loc.real, (b.text as string | undefined) ?? '', { flag: 'wx' });
      return described(loc.real, basename(loc.abs), loc.realRoot);
    },

    // The body is the file's bytes. `path` is the file itself; missing folders above it are created.
    'POST /api/fs/upload': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path);
      writable(loc.root);
      if (!loc.segments.length) throw badPath();
      const onExisting = query.get('onExisting');
      if (onExisting !== null && onExisting !== 'replace' && onExisting !== 'keepBoth') throw badRequest();
      const tooLarge = () => invalid('uploadTooLarge', 'The file is too large (200 MB at most).');
      if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) throw tooLarge();
      let to = await entryPath(loc);
      const old = await lstat(to).catch(() => null);
      let replaced = false;
      if (old) {
        if (onExisting === null) throw exists();
        if (onExisting === 'keepBoth') to = await freeName(to, false);
        else if (old.isDirectory()) throw notAFile();
        else replaced = true;
      }
      let received = 0;
      const capped = (req.body ?? new Blob([]).stream()).pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > MAX_UPLOAD_BYTES) throw tooLarge();
            controller.enqueue(chunk);
          },
        }),
      );
      if (replaced) {
        // The old file goes to the bin only once the new bytes are fully on disk.
        const staged = `${to}.upload-${crypto.randomUUID()}`;
        try {
          await writeFileAtomic(staged, capped);
          await trash([to]).catch(fromPlatform);
          await renameWithRetry(staged, to);
        } finally {
          await rm(staged, { force: true }).catch(() => {});
        }
      } else await writeFileAtomic(to, capped);
      return described(to, basename(to), loc.realRoot);
    },

    'POST /api/fs/download-ticket': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path, true);
      if (!loc.segments.length || (await stat(loc.real)).isDirectory()) throw notAFile();
      const name = basename(loc.abs);
      return { ticket: downloads.issue({ file: loc.real, name }), name };
    },

    'POST /api/fs/view-ticket': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path, true);
      if (!loc.segments.length || (await stat(loc.real)).isDirectory()) throw notAFile();
      const now = Date.now();
      for (const [id, v] of views) if (v.expires < now) views.delete(id);
      while (views.size >= 50) views.delete(views.keys().next().value!);
      const id = randomBytes(16).toString('hex');
      views.set(id, { root: b.root as string, dir: loc.segments.slice(0, -1), expires: now + VIEW_TTL_MS });
      return { url: `/api/fs/view/${id}/${encodeURIComponent(loc.segments.at(-1)!)}` };
    },

    'POST /api/fs/write': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path);
      writable(loc.root);
      const expected = b.expectedMtime ?? undefined;
      const encoding = (b.encoding ?? 'utf8') as TextEncodingId;
      if (typeof b.text !== 'string' || (expected !== undefined && typeof expected !== 'number') || !TEXT_ENCODINGS.includes(encoding)) throw badRequest();
      const bytes = encodeText(b.text, encoding);
      const st = await stat(loc.real).catch((err) => {
        if (isMissing(err)) return null;
        throw err;
      });
      if (st?.isDirectory()) throw notAFile();
      if (expected !== undefined && (!st || Math.round(st.mtimeMs) !== expected)) {
        throw invalid('fileChanged', 'The file was changed on disk since it was opened.');
      }
      if (!st && !(await stat(dirname(loc.real)).then((p) => p.isDirectory(), () => false))) throw fileNotFound();
      // Like VS Code's unlock: a read-only file is only written when the caller asks to clear the flag.
      if (st && !ownerWritable(st.mode)) {
        if (b.unlock !== true) throw forbidden('fileReadOnly', 'The file is read-only.');
        await chmod(loc.real, st.mode | 0o200).catch((err) => { throw fsError(err); });
      }
      await writeFileAtomic(loc.real, bytes);
      return described(loc.real, basename(loc.abs), loc.realRoot);
    },

    // `to` is the new folder; it must not exist. Anything that unpacks to a path outside it removes the folder again.
    'POST /api/fs/extract': async ({ json }) => {
      const b = await body(json);
      const src = await locate(b.root, b.path, true);
      const dest = await locate(b.root, b.to);
      writable(dest.root);
      if ((await stat(src.real)).isDirectory()) throw notAFile();
      const to = await entryPath(dest);
      if (await present(to)) throw exists();
      await mkdir(dirname(to), { recursive: true });
      await mkdir(to);
      try {
        await extractArchive(src.real, to);
        if (await escapes(await realpath(to))) throw invalid('archiveUnsafe', 'The archive has entries that lead outside the target folder.');
      } catch (err) {
        await rm(to, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      return { path: dest.segments.join('/') } satisfies FsExtractResult;
    },

    // The archive `name` goes into the one folder all `paths` share; it is written beside it under a temporary name first.
    'POST /api/fs/compress': async ({ json }) => {
      const b = await body(json);
      if (!Array.isArray(b.paths) || !b.paths.length || b.paths.length > MAX_PATHS) throw badRequest();
      if (b.format !== 'zip' && b.format !== '7z') throw badRequest();
      if (!validName(b.name)) throw badPath();
      const located = await Promise.all(b.paths.map((p) => locate(b.root, p, true)));
      writable(located[0]!.root);
      const entries = await Promise.all(located.map((l) => entryPath(l)));
      const parent = dirname(entries[0]!);
      if (entries.some((e) => fold(dirname(e)) !== fold(parent))) throw invalid('mixedParents', 'All items must be in the same folder.');
      const file = join(parent, b.name);
      if (await present(file)) throw exists();
      const staged = `${file}.compress-${crypto.randomUUID()}`;
      try {
        await compressArchive(parent, [...new Set(entries.map((e) => basename(e)))], staged, b.format);
        if (await present(file)) throw exists();
        await renameWithRetry(staged, file);
      } finally {
        await rm(staged, { force: true }).catch(() => {});
      }
      return { path: [...located[0]!.segments.slice(0, -1), b.name].join('/'), skippedLinks: [] } satisfies FsCompressResult;
    },

    'POST /api/fs/rename': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path, true);
      writable(loc.root);
      if (!validName(b.name)) throw badPath();
      const from = await entryPath(loc);
      const to = join(dirname(from), b.name);
      await refuseExisting(from, to);
      await renameWithRetry(from, to);
      return described(to, b.name, loc.realRoot);
    },

    'POST /api/fs/move': async ({ json }) => {
      const b = await body(json);
      const src = await locate(b.root, b.from, true);
      const dest = await locate(b.toRoot ?? b.root, b.to);
      writable(src.root);
      writable(dest.root);
      const from = await entryPath(src);
      const to = await entryPath(dest);
      if ((await lstat(from)).isDirectory() && fold(to).startsWith(fold(from) + sep)) {
        throw invalid('moveIntoSelf', "A folder can't be moved into itself.");
      }
      const onExisting = b.onExisting;
      if (onExisting !== undefined && onExisting !== 'replace' && onExisting !== 'keepBoth') throw badRequest();
      let target = to;
      if (onExisting === 'keepBoth') {
        target = await freeName(to, (await lstat(from)).isDirectory());
      } else if (onExisting === 'replace' && fold(from) !== fold(to) && (await present(to))) {
        if (fold(from).startsWith(fold(to) + sep)) throw invalid('moveIntoSelf', "A folder can't replace the folder it is in.");
        await trash([to]).catch(fromPlatform);
      } else {
        await refuseExisting(from, to);
      }
      try {
        await renameWithRetry(from, target);
      } catch (err) {
        if (errno(err) !== 'EXDEV') throw err;
        // Across volumes: copy, then the source goes to the bin (never a permanent delete). A failed copy leaves the source alone.
        await cp(from, target, { recursive: true, errorOnExist: true, force: false });
        await trash([from]).catch(fromPlatform);
      }
      return described(target, basename(target), dest.realRoot);
    },

    'POST /api/fs/copy': async ({ json }) => {
      const b = await body(json);
      const src = await locate(b.root, b.from, true);
      const dest = await locate(b.root, b.to);
      writable(dest.root);
      const from = await entryPath(src);
      const wanted = await entryPath(dest);
      if ((await lstat(from)).isDirectory() && fold(wanted).startsWith(fold(from) + sep)) {
        throw invalid('moveIntoSelf', "A folder can't be copied into itself.");
      }
      // Like a paste in a file manager: an existing name gets " copy", " copy 2", ... instead of an error.
      const to = await freeName(wanted, (await lstat(from)).isDirectory());
      await cp(from, to, { recursive: true, errorOnExist: true, force: false });
      return described(to, basename(to), dest.realRoot);
    },

    'POST /api/fs/delete': async ({ json }) => {
      const b = await body(json);
      if (!Array.isArray(b.paths) || !b.paths.length) throw badRequest();
      // outermost() compares all pairs.
      if (opts.multiDelete === false && b.paths.length > 1) throw invalid('multiDeleteOff', 'Delete one item at a time.');
      if (b.paths.length > MAX_PATHS) throw invalid('tooManyItems', 'Too many items at once.');
      const located = await Promise.all(b.paths.map((p) => locate(b.root, p, true)));
      writable(located[0]!.root);
      const paths = await Promise.all(located.map((l) => entryPath(l)));
      await trash(outermost(paths)).catch(fromPlatform);
      return { ok: true };
    },
  };

  const guard =
    (handler: Handler): Handler =>
    async (ctx) => {
      try {
        return await handler(ctx);
      } catch (err) {
        throw fsError(err);
      }
    };

  const openRoutes: Routes = {
    'GET /api/fs/view/*': guard(async ({ url }) => {
      const [, id, ...rest] = url.pathname.slice('/api/fs/view/'.length - 1).split('/');
      const view = views.get(id ?? '');
      if (!view || view.expires < Date.now()) throw forbidden('invalidTicket', 'This preview expired. Open it again.');
      let segments: string[];
      try {
        segments = rest.map(decodeURIComponent);
      } catch {
        throw invalid('badPath', 'Invalid path.');
      }
      const loc = await locate(view.root, [...view.dir, ...segments].join('/'), true, true);
      if ((await stat(loc.real)).isDirectory()) throw notAFile();
      const ext = extname(loc.real).toLowerCase();
      return new Response(Bun.file(loc.real), {
        headers: {
          'Content-Type': VIEW_TYPES[ext] ?? RAW_TYPES[ext] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          // Scripts run, but in an opaque origin that can reach nothing of the app; nothing leaves the machine.
          'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; sandbox allow-scripts",
          'Cache-Control': 'no-store',
        },
      });
    }),
    'GET /api/fs/download': guard(async ({ query }) => {
      const found = downloads.redeem(query.get('t') ?? '');
      if (!found) throw forbidden('invalidTicket', 'Invalid or expired download link.');
      await stat(found.file).catch((err) => {
        throw fsError(err);
      });
      return new Response(Bun.file(found.file), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(found.name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    }),
  };

  return {
    routes: Object.fromEntries(Object.entries(routes).map(([key, handler]) => [key, guard(handler)])),
    openRoutes,
    resolve: async (rootId, rel, o = {}) => {
      const { root, abs, real } = await locate(rootId, rel, o.mustExist);
      return { root, abs, real };
    },
  };
}

/** `paths` without duplicates and without paths inside another one (the bin takes the folder with them). */
function outermost(paths: string[]): string[] {
  const folded = paths.map(fold);
  return paths.filter((_, i) => !folded.some((q, j) => (j < i && q === folded[i]) || folded[i]!.startsWith(q + sep)));
}
