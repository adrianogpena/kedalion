import type { Dirent } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { invalid, ndjson, type Routes, type TailChunk } from '@kedalion/server-core';
import type { FsDuProgress, FsHash, FsInfo } from '@kedalion/server-core/protocol';
import { listArchive } from '../archive.ts';
import { isBinary } from '../bytes.ts';
import { decodeText, detectEncoding, encodingByBom } from '../encoding.ts';
import { readSqlite } from '../sqlite.ts';
import {
  collator,
  DU_PROGRESS_MS,
  fileNotFound,
  fsError,
  notADir,
  notAFile,
  optionalInt,
  ownerWritable,
  parseExclude,
  RAW_TYPES,
  type FsEntry,
} from './common.ts';
import type { Ctx } from './context.ts';

const MAX_RAW_BYTES = 50_000_000;
const MAX_TAIL_BYTES = 20_000_000;
const DEFAULT_TAIL_BYTES = 1_000_000;

export const LIST_SORTS = ['default', 'mixed', 'filesFirst', 'type', 'modified'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

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

/** The read-only file routes: list, stat, info, du, hash, read, tail, archive, sqlite, raw. */
export function readRoutes(ctx: Ctx): Routes {
  const { locate, entryPath, describe, described, fromQuery, maxReadBytes } = ctx;
  return {
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
  };
}
