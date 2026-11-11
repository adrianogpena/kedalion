import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { AppError, forbidden, invalid, notFound, type Routes } from '@kedalion/server-core';
import type { DialogPicks } from '../file-dialog.ts';

/** How often `du` reports its running totals. */
export const DU_PROGRESS_MS = 150;

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

export const badPath = () => invalid('badPath', 'Invalid path.');
export const badRequest = () => invalid('badRequest', 'Invalid request.');
export const MAX_PATHS = 1000;
export const outsideRoot = () => forbidden('outsideRoot', 'This path leads outside the project folder.');
export const fileNotFound = () => notFound('fileNotFound', 'File or folder not found.');
export const exists = () => invalid('exists', 'A file or folder with this name already exists.');
export const notADir = () => invalid('notADir', 'This is not a folder.');
export const notAFile = () => invalid('notAFile', 'This is not a file.');
export const notASaveTarget = () => forbidden('notASaveTarget', 'Choose where to save first.');

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

export const validName = (name: unknown): name is string => typeof name === 'string' && !/[\\/]/.test(name) && segmentsOf(name).length === 1;

export const fold = process.platform === 'win32' || process.platform === 'darwin' ? (p: string) => p.toLowerCase() : (p: string) => p;

/** True when the real path `path` is `realRoot` or below it. */
export function inside(path: string, realRoot: string): boolean {
  const p = fold(path);
  const base = fold(realRoot);
  return p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);
}

export const errno = (err: unknown) => (err as NodeJS.ErrnoException)?.code;
export const isMissing = (err: unknown) => errno(err) === 'ENOENT' || errno(err) === 'ENOTDIR';

export const present = (path: string) => lstat(path).then(() => true, () => false);

/**
 * `realRoot` joined with `segments`, every existing link followed: the realpath of the nearest
 * existing ancestor plus the segments below it.
 */
export async function realOf(realRoot: string, segments: string[], mustExist: boolean): Promise<string> {
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
export const ownerWritable = (mode: number) => (mode & 0o200) !== 0;

/** Node fs errors as the AppErrors the UI translates; anything else unchanged. */
export function fsError(err: unknown): unknown {
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
export function optionalInt(value: string | null, min: number, max: number): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isSafeInteger(n) || n < min || n > max) throw badRequest();
  return n;
}

/** `wanted`, or the first free `name copy.ext`, `name copy 2.ext`, ... next to it. */
export async function freeName(wanted: string, isDir: boolean): Promise<string> {
  const ext = isDir ? '' : extname(wanted);
  const stem = basename(wanted, ext);
  let to = wanted;
  for (let n = 1; await present(to); n++) to = join(dirname(wanted), `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`);
  return to;
}

/** True when an entry below `dir` (a real path) resolves outside it: a link out, or a dangling link aiming out. */
export async function escapes(dir: string): Promise<boolean> {
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

/** `paths` without duplicates and without paths inside another one (the bin takes the folder with them). */
export function outermost(paths: string[]): string[] {
  const folded = paths.map(fold);
  return paths.filter((_, i) => !folded.some((q, j) => (j < i && q === folded[i]) || folded[i]!.startsWith(q + sep)));
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const TEXT = 'text/plain; charset=utf-8';
export const RAW_TYPES: Record<string, string> = {
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
