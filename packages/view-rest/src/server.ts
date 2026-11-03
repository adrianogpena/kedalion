import { basename } from 'node:path';
import { writeFileAtomic } from '@kedalion/platform';
import { defineServerView, forbidden, invalid, isRecord, type Routes } from '@kedalion/server-core';
import { type DialogPicks, environmentRoutes, fromPlatform, httpSharedRoutes, recordRoutes, type AppStores, type RecordStore, type RestHistory, restTabsRoutes } from '@kedalion/server-mods';

/** The part of the server settings the REST view owns; the app's `Settings` extends it. */
export interface RestServerSettings {
  /** REST screen: split fractions of the editor and the response, active environment, history size. */
  rest?: RestState;
}

export interface RestState {
  sizes?: { main: [number, number] };
  /** Id of the active REST environment; '' or absent = none. */
  environment?: string;
  /** Entries kept in the REST request history; 0 turns history off. */
  historySize?: number;
}

const validPair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && Math.abs(v[0] + v[1] - 1) <= 0.01
    ? [v[0], v[1]]
    : null;

/** A copy of `raw` when it is a well-formed REST screen state, else null. */
export function validRest(raw: unknown): RestState | null {
  if (!isRecord(raw)) return null;
  const out: RestState = {};
  if (raw.sizes !== undefined) {
    if (!isRecord(raw.sizes)) return null;
    const main = validPair(raw.sizes.main);
    if (!main) return null;
    out.sizes = { main };
  }
  if (raw.environment !== undefined) {
    if (typeof raw.environment !== 'string' || (raw.environment !== '' && !/^[\w-]{1,64}$/.test(raw.environment))) return null;
    out.environment = raw.environment;
  }
  if (raw.historySize !== undefined) {
    if (!Number.isInteger(raw.historySize) || (raw.historySize as number) < 0 || (raw.historySize as number) > 5000) return null;
    out.historySize = raw.historySize as number;
  }
  return out;
}

/** `rest.historySize` (default 100; 0 = no REST history). */
export const restHistorySizeOf = (s: RestServerSettings) => {
  const n = s.rest?.historySize;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 100;
};

const MAX_IMPORT_BYTES = 1_000_000;

/** A saved request record; the store itself belongs to the app (its `/api/http/send` reads the saved Authorization value). */
interface SavedRequestRecord {
  name: string;
  request: unknown;
  auth?: unknown;
}

/**
 * Server half of the REST view: saved requests, open tabs, request history and the `rest` settings group.
 * Stores come from the app (`ctx.stores`): `requests` (a `RecordStore`) and `restHistory` (a `RestHistory`, whose `append` the app's
 * `httpRoutes` `onSend` calls). `/api/http/*` is a shared route group (also mounted by Explorer, once) and the environments routes come from `environmentRoutes`; `ctx.stores` is `appStores(...)`.
 */
export const restServerView = () =>
  defineServerView<RestServerSettings>({
    id: 'rest',
    icon: 'send',
    shared: [{ id: 'http', routes: (ctx) => httpSharedRoutes(ctx.stores as unknown as AppStores) }],
    routes: (ctx): Routes => {
      const requests = ctx.stores.requests as RecordStore<SavedRequestRecord>;
      const history = ctx.stores.restHistory as RestHistory;
      const picks = ctx.stores.picks as DialogPicks;
      return {
        ...environmentRoutes(ctx.stores as unknown as AppStores),
        ...recordRoutes(requests, '/api/requests'),
        ...recordRoutes(ctx.stores.chains as RecordStore<{ name: string; steps: unknown[] }>, '/api/rest/chains'),
        // The saved Authorization value, only for Copy as curl.
        'GET /api/requests/auth': async ({ query }) => {
          const id = query.get('id');
          if (!id) throw invalid('badRequest', 'Invalid request.');
          await requests.get(id);
          return { value: ((await requests.secret(id, 'auth')) as string | undefined) ?? null };
        },
        ...restTabsRoutes({ dir: ctx.dataDir }),
        // The target must be one the in-app save dialog returned.
        'POST /api/requests/save-curl': async ({ json }) => {
          const { text, target } = await json<{ text?: unknown; target?: unknown }>();
          if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw invalid('badRequest', 'Invalid request.');
          if (typeof target !== 'string' || !picks.saveTargets.take(target)) throw forbidden('notASaveTarget', 'Choose where to save first.');
          await writeFileAtomic(target, `${text}\n`).catch(fromPlatform);
          return { path: target };
        },
        // The file's text goes to the client for parsing; the path must be one the in-app open dialog returned.
        'POST /api/requests/import-file': async ({ json }) => {
          const { path } = await json<{ path?: unknown }>();
          if (typeof path !== 'string' || !picks.opened.take(path)) throw forbidden('notAPickedFile', 'Choose a file first.');
          const file = Bun.file(path);
          if (file.size > MAX_IMPORT_BYTES) throw invalid('importTooLarge', 'The file is too large to import.');
          return { name: basename(path), text: await file.text() };
        },
        'GET /api/rest/history': async ({ query }) => history.list({ q: query.get('q') ?? undefined }),
        'DELETE /api/rest/history': async () => {
          await history.clear();
          return {};
        },
      };
    },
    settings: { validate: { rest: validRest } },
  });
