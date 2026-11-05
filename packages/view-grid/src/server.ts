import { type RouteContext, type Routes } from '@kedalion/server-core';
import { validConfig, type PanelConfig, type PanelField, type PanelKindSpec } from '@kedalion/ui/grid';

import { type ResolvedConnection } from './connections/auth';
import { connectionResolverOf } from './connections/routes';
import { type ConnectionType } from './connections/store';

export { CLOCK_FIELDS, CLOCK_SPEC } from './clock-fields';
export { authHeader, type ResolvedConnection } from './connections/auth';
export { codeForStatus, SourceError, sourceFetch, type SourceErrorCode } from './connections/errors';
export { type Connection, type ConnectionType, type PublicConnection } from './connections/store';
export { dashboardServerView, type DashboardServerOptions, type DashboardServerSettings } from './dashboard/server';
export { dashboardSources, dashboardSpecs } from './panels/catalog.server';

/** What the server knows of a panel kind: its id and what `validGridItems` needs. */
export type GridPanelSpec = PanelKindSpec & { kind: string };

export interface SourceContext {
  dataDir: string;
  signal: AbortSignal;
  /** The credentials of connection `id` (`not-configured` when unknown or of another type). */
  connection(id: string, type: ConnectionType): Promise<ResolvedConnection>;
  /** An OS toast (absent when the app wires no notifications). */
  notify?(n: { title?: string; body: string }): Promise<void>;
  /** The last notifications the app sent, newest first (absent when the app wires no notifications). */
  notificationLog?(): NotificationLogEntry[];
  /** The origin the request reached the server at, e.g. `http://127.0.0.1:4123` (for OAuth redirect URIs). */
  origin?: string;
  /** The folders of the Explorer projects. */
  projectRoots?(): Promise<Array<{ id: string; path: string }>>;
}

/** The part of the platform `Notifications` the grid needs (structural, so view-grid does not depend on platform). */
export interface GridNotifications {
  for(view: string | { icon: string }): (n: { title?: string; body: string; path?: string; launch?: string }) => Promise<void>;
  history?(): NotificationLogEntry[];
}

/** One row of the notification log (structural twin of platform `NotificationEntry`). */
export interface NotificationLogEntry {
  id: number;
  time: number;
  view: string;
  title: string;
  body: string;
  path?: string;
  muted: boolean;
}

export interface DataSource<C extends PanelConfig = PanelConfig> {
  id: string;
  /** The config a panel sends; `fetch` receives it cleaned by `validConfig`. */
  fields: readonly PanelField[];
  /** Returns JSON-serializable data for a panel's `load` (see `fetchSource`). */
  fetch(config: C, ctx: SourceContext): Promise<unknown> | unknown;
  /** Writes behind `POST /api/grid/action/<id>/<name>`; the body is `{ config, payload }`. */
  actions?: Record<string, (payload: unknown, config: C, ctx: SourceContext) => unknown | Promise<unknown>>;
  /** NDJSON streams behind `GET /api/grid/stream/<id>/<name>`; build the body with server-core `ndjson(req, produce)`. */
  streams?: Record<string, (query: URLSearchParams, ctx: SourceContext & { req: Request }) => Response>;
  /** Browser redirects behind `GET /api/grid/callback/<id>/<name>`, outside the session token check (an OAuth redirect cannot send it): the handler must verify its own `state`. */
  callbacks?: Record<string, (query: URLSearchParams, ctx: SourceContext) => Response | Promise<Response>>;
}

/** Identity; types `config` of `fetch`. */
export function defineSource<C extends PanelConfig = PanelConfig>(def: DataSource<C>): DataSource<C> {
  return def;
}

export interface GridServerOptions {
  /** Every panel kind the app's grid can hold. */
  panels: readonly GridPanelSpec[];
  /** Data sources behind `POST /api/grid/source/<id>`, for kinds that load from the server (Jira, GitHub…). */
  sources?: readonly DataSource<any>[];
  /** Toasts for sources (`ctx.notify`); they open the Dashboard on click. */
  notifications?: GridNotifications;
}

export const kindSpecsOf = (panels: readonly GridPanelSpec[]): Record<string, PanelKindSpec> =>
  Object.fromEntries(panels.map((p) => [p.kind, { fields: p.fields, allowMultiple: p.allowMultiple }]));

/** The route of data source `id`. */
export const sourceRoute = (id: string): string => `POST /api/grid/source/${id}`;

/** The route of action `name` of data source `id`. */
export const actionRoute = (id: string, name: string): string => `POST /api/grid/action/${id}/${name}`;

/** The route of stream `name` of data source `id`. */
export const streamRoute = (id: string, name: string): string => `GET /api/grid/stream/${id}/${name}`;

/** The route of callback `name` of data source `id`. */
export const callbackRoute = (id: string, name: string): string => `GET /api/grid/callback/${id}/${name}`;

const NAME_RE = /^[a-z0-9-]+$/;

/** Throws when a source id, or one of its action or stream names, is invalid or duplicated. */
export function checkSources(sources: readonly DataSource<any>[], label: string): void {
  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id) || !NAME_RE.test(s.id)) throw new Error(`Invalid or duplicate ${label} source id: ${s.id}`);
    ids.add(s.id);
    for (const name of [...Object.keys(s.actions ?? {}), ...Object.keys(s.streams ?? {}), ...Object.keys(s.callbacks ?? {})]) {
      if (!NAME_RE.test(name)) throw new Error(`Invalid ${label} action or stream name: ${s.id}/${name}`);
    }
  }
}

/** The handlers of `sources`: the body is `{ config }`, cleaned with the source's fields before `fetch`; plus their actions and streams. */
export function sourceRoutes(sources: readonly DataSource<any>[], dataDir = '', notifications?: GridNotifications, projectRoots?: SourceContext['projectRoots']): Routes {
  const connection = connectionResolverOf(dataDir);
  const routes: Routes = {};
  const notifier = notifications?.for('dashboard');
  const notify = notifier ? (n: { title?: string; body: string }) => notifier({ ...n, path: 'dashboard' }) : undefined;
  const notificationLog = notifications?.history ? () => notifications.history!() : undefined;
  for (const source of sources) {
    routes[sourceRoute(source.id)] = async ({ json, req }: RouteContext) => {
      const body = await json<{ config?: unknown }>();
      return source.fetch(validConfig(source.fields, body.config), { dataDir, signal: req.signal, connection, notify, notificationLog, origin: new URL(req.url).origin, projectRoots });
    };
    for (const [name, action] of Object.entries(source.actions ?? {})) {
      routes[actionRoute(source.id, name)] = async ({ json, req }: RouteContext) => {
        const body = await json<{ config?: unknown; payload?: unknown }>();
        return (await action(body.payload, validConfig(source.fields, body.config), { dataDir, signal: req.signal, connection, notify, origin: new URL(req.url).origin, projectRoots })) ?? null;
      };
    }
    for (const [name, stream] of Object.entries(source.streams ?? {})) {
      routes[streamRoute(source.id, name)] = ({ query, req }: RouteContext) => stream(query, { dataDir, signal: req.signal, connection, notify, req });
    }
  }
  return routes;
}

/** The unauthenticated routes of the callbacks of `sources` (see `DataSource.callbacks`). */
export function callbackRoutes(sources: readonly DataSource<any>[], dataDir = ''): Routes {
  const connection = connectionResolverOf(dataDir);
  const routes: Routes = {};
  for (const source of sources) {
    for (const [name, callback] of Object.entries(source.callbacks ?? {})) {
      routes[callbackRoute(source.id, name)] = ({ query, req }: RouteContext) => callback(query, { dataDir, signal: req.signal, connection, origin: new URL(req.url).origin });
    }
  }
  return routes;
}
