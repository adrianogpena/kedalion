import { openExternal } from '@kedalion/platform';
import { invalid, type Routes } from '@kedalion/server-core';
import { normalizeAddress } from '../address.ts';
import type { BrowserService } from './service.ts';

const bad = () => invalid('badRequest', 'Invalid request.');
const str = (v: unknown): string => {
  if (typeof v !== 'string' || !v) throw bad();
  return v;
};
const ACTIONS = ['back', 'forward', 'reload', 'stop'] as const;
const KINDS = ['console', 'network'] as const;

export interface BrowserRouteOptions {
  service: BrowserService;
  /** Loads the settings and starts the browser. */
  ready(): Promise<void>;
  issueTicket(): string;
}

export function browserRoutes({ service, ready, issueTicket }: BrowserRouteOptions): Routes {
  const tabList = () => ({ tabs: service.tabs().list(), active: service.activeTab() ?? null });
  const logsOf = (tab: string) => {
    const l = service.logs(tab);
    if (!l) throw invalid('notFound', 'Unknown tab.');
    return l;
  };
  const kindOf = (v: unknown) => {
    if (!KINDS.includes(v as (typeof KINDS)[number])) throw bad();
    return v as (typeof KINDS)[number];
  };

  return {
    'GET /api/browser/tabs': async () => {
      await ready();
      return tabList();
    },
    'POST /api/browser/tabs': async ({ json }) => {
      const b = await json<{ url?: unknown }>();
      if (b.url !== undefined && typeof b.url !== 'string') throw bad();
      await ready();
      const tab = await service.open(b.url ? normalizeAddress(b.url) : undefined);
      return { tab };
    },
    'POST /api/browser/tabs/close': async ({ json }) => {
      const b = await json<{ id?: unknown }>();
      const id = str(b.id);
      await ready();
      await service.close(id);
      return { ok: true };
    },
    'POST /api/browser/activate': async ({ json }) => {
      const b = await json<{ id?: unknown }>();
      const id = str(b.id);
      await ready();
      await service.activate(id);
      return { ok: true };
    },
    'POST /api/browser/navigate': async ({ json }) => {
      const b = await json<{ id?: unknown; url?: unknown; action?: unknown }>();
      const id = str(b.id);
      await ready();
      if (b.action !== undefined) {
        if (!ACTIONS.includes(b.action as (typeof ACTIONS)[number])) throw bad();
        await service.action(id, b.action as (typeof ACTIONS)[number]);
      } else await service.navigate(id, normalizeAddress(str(b.url)));
      return { ok: true };
    },
    'POST /api/browser/eval': async ({ json }) => {
      const b = await json<{ id?: unknown; expression?: unknown }>();
      const id = str(b.id);
      const expression = str(b.expression);
      await ready();
      return service.evaluate(id, expression);
    },
    'GET /api/browser/network/detail': async ({ query }) => {
      const tab = str(query.get('tab'));
      const id = Number(str(query.get('id')));
      if (!Number.isInteger(id)) throw bad();
      await ready();
      return { detail: (await logsOf(tab).network.detail(id)) ?? null };
    },
    'POST /api/browser/logs/clear': async ({ json }) => {
      const b = await json<{ id?: unknown; kind?: unknown }>();
      const id = str(b.id);
      const kind = kindOf(b.kind);
      await ready();
      logsOf(id)[kind].clear();
      return { ok: true };
    },
    'POST /api/browser/logs/preserve': async ({ json }) => {
      const b = await json<{ id?: unknown; kind?: unknown; on?: unknown }>();
      const id = str(b.id);
      const kind = kindOf(b.kind);
      if (typeof b.on !== 'boolean') throw bad();
      await ready();
      logsOf(id)[kind].preserve = b.on;
      return { ok: true };
    },
    'POST /api/browser/open-external': async ({ json }) => {
      const b = await json<{ url?: unknown }>();
      const url = str(b.url);
      if (!/^https?:\/\//i.test(url)) throw bad();
      openExternal(url);
      return { ok: true };
    },
    'POST /api/browser/devtools': async ({ json }) => {
      const b = await json<{ id?: unknown }>();
      const id = str(b.id);
      await ready();
      return { mode: 'iframe' as const, url: service.devtoolsUrl(id) };
    },
    'POST /api/browser/files': async ({ json }) => {
      const b = await json<{ tab?: unknown; id?: unknown; paths?: unknown }>();
      const tab = str(b.tab);
      const id = str(b.id);
      if (!Array.isArray(b.paths) || !b.paths.every((p) => typeof p === 'string' && p)) throw bad();
      await ready();
      await service.setFiles(tab, id, b.paths as string[]);
      return { ok: true };
    },
    'POST /api/browser/socket-ticket': () => ({ ticket: issueTicket() }),
  };
}
