import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appHome, secretStore, writeFileAtomic } from '@kedalion/platform';
import { AppError, type Routes } from '@kedalion/server-core';
import { recordStore, type RecordStore } from '@kedalion/server-mods';
import { connectionRoutes } from './connection-routes.ts';
import { sqlHistory, type SqlHistory } from './history.ts';
import { parseOracleUrl, validConnection, type DbConnectionFields } from './oracle-url.ts';
import { dbRoutes } from './routes.ts';
import { dbSessions, type DbSessions } from './sessions.ts';

export interface DbStoresOptions {
  /** The app data folder; defaults to `appHome(appId)`. */
  home?: string;
  secrets?: ReturnType<typeof secretStore>;
  /** Initial size of the SQL history (the app updates it with `sqlHistory.setMax`). */
  sqlHistoryMax?: number;
}

/** The stores of the `/api/db/*` routes, read from `ctx.stores` by the workbench and explorer views. */
export interface DbStores {
  /** Oracle connections; the password is a secret field, never returned by a route. */
  dbConnections: RecordStore<DbConnectionFields & { password?: unknown }>;
  /** Statements the Workbench and the Explorer ran. */
  sqlHistory: SqlHistory;
  /** The open database sessions; the routes and the agent SQL tools share them, so a session and its pending changes are one. */
  sessions: DbSessions;
}

/** Builds `dbConnections` and `sqlHistory` for app `appId`; spread next to `appStores` into `mountViews` `stores`. */
export function dbStores(appId: string, opts: DbStoresOptions = {}): DbStores {
  const home = opts.home ?? appHome(appId);
  return {
    dbConnections: recordStore<DbConnectionFields & { password?: unknown }>({
      dir: home,
      name: 'dbConnections',
      secretFields: ['password'],
      secrets: opts.secrets ?? secretStore(appId),
      validate: (input) => validConnection(input),
    }),
    sqlHistory: sqlHistory({ dir: home, max: opts.sqlHistoryMax ?? 500 }),
    sessions: dbSessions(),
  };
}

/** `/api/db/*`: connections, sessions, queries and scripts (in `<dataDir>/workbench`). Shared by the workbench and explorer views as `shared: 'db'`. */
export function dbSharedRoutes(stores: DbStores, dataDir: string): Routes {
  const { dbConnections } = stores;
  const { sessions } = stores;
  const scriptFile = (id: string) => join(dataDir, 'workbench', `${id}.sql`);
  return {
    ...connectionRoutes(dbConnections, sessions),
    ...dbRoutes({
      sessions,
      history: stores.sqlHistory,
      scripts: {
        read: (id) => readFile(scriptFile(id), 'utf8').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? '' : Promise.reject(err))),
        write: (id, text) => writeFileAtomic(scriptFile(id), text),
      },
      async credentials(id) {
        const record = await dbConnections.get(id).catch((err: unknown) => {
          if (err instanceof AppError && err.kind === 'notfound') return null;
          throw err;
        });
        if (!record) return null;
        return {
          connectString: parseOracleUrl(record.url).connectString,
          user: record.user,
          password: (await dbConnections.secret(id, 'password')) ?? '',
        };
      },
    }),
  };
}
