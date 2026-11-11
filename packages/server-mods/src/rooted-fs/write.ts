import { chmod, cp, lstat, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { renameWithRetry, writeFileAtomic } from '@kedalion/platform';
import { forbidden, invalid, type Routes } from '@kedalion/server-core';
import type { FsCompressResult, FsExtractResult } from '@kedalion/server-core/protocol';
import { compressArchive, extractArchive } from '../archive.ts';
import { encodeText, TEXT_ENCODINGS, type TextEncodingId } from '../encoding.ts';
import { fromPlatform } from '../platform-errors.ts';
import {
  badPath,
  badRequest,
  errno,
  escapes,
  exists,
  fileNotFound,
  fold,
  freeName,
  fsError,
  isMissing,
  MAX_PATHS,
  notAFile,
  notASaveTarget,
  outermost,
  ownerWritable,
  present,
  validName,
} from './common.ts';
import type { Ctx } from './context.ts';

const MAX_SAVE_RANGE_BYTES = 200_000_000;
const MAX_UPLOAD_BYTES = 200_000_000;

/**
 * The routes that change files. Each resolves right before acting and acts on the real path, then
 * re-resolves (`confirm`/`confirmEntry`) immediately before the destructive call and refuses when
 * the path now leads outside the root. A link swapped in between that last check and the call
 * can still redirect one operation: closing that needs handle-relative calls Node doesn't offer.
 */
export function writeRoutes(ctx: Ctx): Routes {
  const { opts, locate, entryPath, confirm, confirmEntry, writable, described, refuseExisting, fromQuery, body, trash } = ctx;
  const { saveTargetPicks, savedTargets, targetKey } = ctx;
  return {
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
      await confirm(loc);
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

    'POST /api/fs/create': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path);
      writable(loc.root);
      if (!loc.segments.length) throw exists();
      if ((b.kind !== 'file' && b.kind !== 'dir') || (b.text !== undefined && typeof b.text !== 'string')) throw badRequest();
      await confirm(loc);
      await mkdir(dirname(loc.real), { recursive: true });
      await confirm(loc);
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
          await confirmEntry(loc);
          await writeFileAtomic(staged, capped);
          await confirmEntry(loc);
          await trash([to]).catch(fromPlatform);
          await renameWithRetry(staged, to);
        } finally {
          await rm(staged, { force: true }).catch(() => {});
        }
      } else {
        await confirmEntry(loc);
        await writeFileAtomic(to, capped);
      }
      return described(to, basename(to), loc.realRoot);
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
        await confirm(loc);
        await chmod(loc.real, st.mode | 0o200).catch((err) => { throw fsError(err); });
      }
      await confirm(loc);
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
      await confirmEntry(dest);
      await mkdir(dirname(to), { recursive: true });
      await confirmEntry(dest);
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
        await Promise.all(located.map((l) => confirmEntry(l)));
        await compressArchive(parent, [...new Set(entries.map((e) => basename(e)))], staged, b.format);
        if (await present(file)) throw exists();
        await Promise.all(located.map((l) => confirmEntry(l)));
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
      await confirmEntry(loc);
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
        await confirmEntry(src);
        await confirmEntry(dest);
        await trash([to]).catch(fromPlatform);
      } else {
        await refuseExisting(from, to);
      }
      await confirmEntry(src);
      await confirmEntry(dest);
      try {
        await renameWithRetry(from, target);
      } catch (err) {
        if (errno(err) !== 'EXDEV') throw err;
        // Across volumes: copy, then the source goes to the bin (never a permanent delete). A failed copy leaves the source alone.
        await cp(from, target, { recursive: true, errorOnExist: true, force: false });
        await confirmEntry(src);
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
      await confirmEntry(src);
      await confirmEntry(dest);
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
      await Promise.all(located.map((l) => confirmEntry(l)));
      await trash(outermost(paths)).catch(fromPlatform);
      return { ok: true };
    },
  };
}
