import { type Routes, type TailChunk } from '@kedalion/server-core';
import { fsError, type RootedFs, type RootedFsOptions } from './rooted-fs/common.ts';
import { createContext } from './rooted-fs/context.ts';
import { readRoutes } from './rooted-fs/read.ts';
import { searchRoutes } from './rooted-fs/search.ts';
import { openTicketRoutes, ticketRoutes } from './rooted-fs/tickets.ts';
import { writeRoutes } from './rooted-fs/write.ts';

export type { TailChunk };
export { badPath, parseExclude, segmentsOf } from './rooted-fs/common.ts';
export type { FsEntry, FsRoot, Resolved, RootedFs, RootedFsOptions, SearchHit } from './rooted-fs/common.ts';
export { LIST_SORTS, sortEntries, type ListSort } from './rooted-fs/read.ts';
export { searchTree } from './rooted-fs/search.ts';

/**
 * File routes confined to the roots the app registers. The client only ever sends a root id and a
 * relative path; `resolve` turns them into a real path inside that root or refuses. The routes live
 * in `rooted-fs/`: `read.ts`, `search.ts`, `write.ts` (re-checks the path before each destructive
 * call) and `tickets.ts`; `context.ts` holds the shared `locate`.
 *
 * GET `/api/fs/list|stat|info|du|hash|read|raw|archive|search|names` take `root` and `path` in the query; POST
 * `/api/fs/create|write|extract|compress|rename|move|delete` take them in the JSON body. POST `/api/fs/upload` takes them
 * in the query and the file's bytes as the body.
 */
export function rootedFs(opts: RootedFsOptions): RootedFs {
  const ctx = createContext(opts);
  const routes: Routes = { ...readRoutes(ctx), ...searchRoutes(ctx), ...writeRoutes(ctx), ...ticketRoutes(ctx) };
  return {
    routes: Object.fromEntries(
      Object.entries(routes).map(([key, handler]) => [
        key,
        (async (c) => {
          try {
            return await handler(c);
          } catch (err) {
            throw fsError(err);
          }
        }) as typeof handler,
      ]),
    ),
    openRoutes: openTicketRoutes(ctx),
    resolve: async (rootId, rel, o = {}) => {
      const { root, abs, real } = await ctx.locate(rootId, rel, o.mustExist);
      return { root, abs, real };
    },
  };
}
