import { invalid, type RouteContext, type Routes } from '@kedalion/server-core';
import { resolveConnection, testConnection, type ResolvedConnection, type Spawn, type TestResult } from './auth';
import { createConnectionStore, type ConnectionInput, type ConnectionStore, type ConnectionType, type PublicConnection } from './store';

export const CONNECTIONS_ROUTE = '/api/grid/connections';

const stores = new Map<string, ConnectionStore>();

/** The one store of `dataDir`, shared by the routes and the sources. */
export function connectionStoreOf(dataDir: string): ConnectionStore {
  let store = stores.get(dataDir);
  if (!store) stores.set(dataDir, (store = createConnectionStore(dataDir)));
  return store;
}

/** `SourceContext.connection` of `dataDir`. */
export const connectionResolverOf =
  (dataDir: string, spawn?: Spawn) =>
  (type: ConnectionType): Promise<ResolvedConnection> =>
    resolveConnection(connectionStoreOf(dataDir), '', type, spawn);

/**
 * The connection routes. The router matches whole paths, so delete takes `?id=` and test takes
 * `{ id }` in the body instead of `<id>` path segments.
 */
export function connectionRoutes(dataDir: string): Routes {
  const store = connectionStoreOf(dataDir);
  const idOf = (v: unknown): string => {
    if (typeof v !== 'string' || !v) throw invalid('connection-missing', 'No connection was specified.');
    return v;
  };
  return {
    [`GET ${CONNECTIONS_ROUTE}`]: (): Promise<PublicConnection[]> => store.list(),
    [`POST ${CONNECTIONS_ROUTE}`]: async ({ json }: RouteContext): Promise<PublicConnection> => {
      const body = await json<ConnectionInput>();
      return store.save({ id: body.id === undefined ? undefined : idOf(body.id), type: body.type, name: body.name, baseUrl: body.baseUrl, user: body.user, token: body.token });
    },
    [`DELETE ${CONNECTIONS_ROUTE}`]: async ({ query }: RouteContext) => {
      await store.remove(idOf(query.get('id')));
      return { ok: true };
    },
    [`POST ${CONNECTIONS_ROUTE}/test`]: async ({ json, req }: RouteContext): Promise<TestResult> => {
      const body = await json<{ id?: unknown }>();
      return testConnection(store, idOf(body.id), undefined, req.signal);
    },
  };
}
