import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { forbidden, type Handler, invalid, type Routes } from '@kedalion/server-core';
import { fsError, notAFile, RAW_TYPES } from './common.ts';
import type { Ctx } from './context.ts';

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

/** `POST /api/fs/download-ticket` and `view-ticket` (behind the session token). */
export function ticketRoutes(ctx: Ctx): Routes {
  const { locate, body, downloads, views } = ctx;
  return {
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
  };
}

/** The ticket-redeeming routes outside the session token check. */
export function openTicketRoutes(ctx: Ctx): Routes {
  const { locate, downloads, views } = ctx;
  const guard =
    (handler: Handler): Handler =>
    async (c) => {
      try {
        return await handler(c);
      } catch (err) {
        throw fsError(err);
      }
    };
  return {
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
}
