import type { Emulation, InterceptRule } from '@kedalion/cdp';
import { openExternal } from '@kedalion/platform';
import { invalid, type Routes } from '@kedalion/server-core';
import { normalizeAddress } from '../address.ts';
import { bodyMatches } from '../netview.ts';
import { prettyBody, summarizeRequest } from '../ops.ts';
import type { BrowserService } from './service.ts';

const bad = () => invalid('badRequest', 'Invalid request.');
const str = (v: unknown): string => {
  if (typeof v !== 'string' || !v) throw bad();
  return v;
};
const ACTIONS = ['back', 'forward', 'reload', 'stop'] as const;
const KINDS = ['console', 'network'] as const;
const MAX_RULES = 50;

export interface BrowserRouteOptions {
  service: BrowserService;
  /** Loads the settings and starts the browser. */
  ready(): Promise<void>;
  issueTicket(): string;
  /** The `--mcp-config` content, or undefined while the app origin is not known. */
  mcpConfig(): unknown;
}

export function browserRoutes({ service, ready, issueTicket, mcpConfig }: BrowserRouteOptions): Routes {
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

  const webKind = (v: unknown): 'local' | 'session' => {
    if (v === 'local' || v === 'session') return v;
    throw bad();
  };
  const storeKind = (v: unknown): 'local' | 'session' | 'indexeddb' => (v === 'indexeddb' ? v : webKind(v));
  const scopeOf =(v: unknown): 'page' | 'all' => {
    if (v === 'page' || v === 'all') return v;
    throw bad();
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
    'GET /api/browser/network/ops': async ({ query }) => {
      const tab = str(query.get('tab'));
      const text = query.get('text') ?? '';
      await ready();
      const net = logsOf(tab).network;
      const ops: Record<number, string> = {};
      const matches: number[] = [];
      for (const e of net.entries()) {
        const rec = net.recorded(e.id);
        const summary = rec?.postData ? summarizeRequest({ method: e.method, url: e.url, postData: rec.postData }) : '';
        if (summary) ops[e.id] = summary;
        if (text && bodyMatches(rec, text, rec?.postData ? prettyBody(rec.postData) : undefined)) matches.push(e.id);
      }
      return { ops, matches: text ? matches : null };
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
    'GET /api/browser/cookies': async ({ query }) => {
      const tab = str(query.get('tab'));
      await ready();
      return { cookies: await service.cookies(tab, scopeOf(query.get('scope'))) };
    },
    'POST /api/browser/cookies/delete': async ({ json }) => {
      const b = await json<{ tab?: unknown; name?: unknown; domain?: unknown; path?: unknown }>();
      const tab = str(b.tab);
      if (typeof b.name !== 'string' || typeof b.domain !== 'string' || typeof b.path !== 'string' || !b.name) throw bad();
      await ready();
      await service.deleteCookie(tab, { name: b.name, domain: b.domain, path: b.path });
      return { ok: true };
    },
    'POST /api/browser/cookies/clear': async ({ json }) => {
      const b = await json<{ tab?: unknown; scope?: unknown }>();
      const tab = str(b.tab);
      await ready();
      return { removed: await service.clearCookies(tab, scopeOf(b.scope)) };
    },
    'POST /api/browser/cookies/set': async ({ json }) => {
      const b = await json<{ tab?: unknown; cookie?: Record<string, unknown> }>();
      const tab = str(b.tab);
      const c = b.cookie;
      if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name || typeof c.value !== 'string') throw bad();
      const optStr = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
      const sameSite = c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None' ? c.sameSite : undefined;
      const domain = optStr(c.domain);
      const path = optStr(c.path);
      await ready();
      await service.setCookie(tab, {
        name: c.name,
        value: c.value,
        ...(domain ? { domain } : {}),
        ...(path ? { path } : {}),
        ...(typeof c.expires === 'number' && Number.isFinite(c.expires) && c.expires > 0 ? { expires: c.expires } : {}),
        httpOnly: c.httpOnly === true,
        secure: c.secure === true,
        ...(sameSite ? { sameSite } : {}),
      });
      return { ok: true };
    },
    'GET /api/browser/storage': async ({ query }) => {
      const tab = str(query.get('tab'));
      await ready();
      return service.storage(tab);
    },
    'POST /api/browser/storage/set': async ({ json }) => {
      const b = await json<{ tab?: unknown; kind?: unknown; key?: unknown; value?: unknown }>();
      const tab = str(b.tab);
      const kind = webKind(b.kind);
      if (typeof b.value !== 'string') throw bad();
      await ready();
      await service.setStorageItem(tab, kind, str(b.key), b.value);
      return { ok: true };
    },
    'POST /api/browser/storage/remove': async ({ json }) => {
      const b = await json<{ tab?: unknown; kind?: unknown; key?: unknown }>();
      const tab = str(b.tab);
      const kind = storeKind(b.kind);
      await ready();
      await service.removeStorageItem(tab, kind, str(b.key));
      return { ok: true };
    },
    'POST /api/browser/storage/clear': async ({ json }) => {
      const b = await json<{ tab?: unknown; kind?: unknown }>();
      const tab = str(b.tab);
      const kind = storeKind(b.kind);
      await ready();
      await service.clearStorage(tab, kind);
      return { ok: true };
    },
    'POST /api/browser/site-data/clear': async ({ json }) => {
      const b = await json<{ tab?: unknown; cache?: unknown }>();
      const tab = str(b.tab);
      await ready();
      await service.clearSiteData(tab, b.cache === true);
      return { ok: true };
    },
    'GET /api/browser/rules': async () => {
      await ready();
      return { rules: service.rules() };
    },
    'POST /api/browser/rules': async ({ json }) => {
      const b = await json<{ rules?: unknown }>();
      if (!Array.isArray(b.rules) || b.rules.length > MAX_RULES) throw bad();
      const rules: InterceptRule[] = b.rules.map((r: Record<string, unknown>) => {
        if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.pattern !== 'string' || (r.action !== 'block' && r.action !== 'mock')) throw bad();
        const status = typeof r.status === 'number' && Number.isInteger(r.status) && r.status >= 100 && r.status <= 599 ? r.status : undefined;
        return {
          id: r.id,
          enabled: r.enabled !== false,
          pattern: r.pattern,
          action: r.action,
          ...(status ? { status } : {}),
          ...(typeof r.contentType === 'string' && r.contentType ? { contentType: r.contentType } : {}),
          ...(typeof r.body === 'string' ? { body: r.body } : {}),
        };
      });
      await ready();
      service.setRules(rules);
      return { rules };
    },
    'GET /api/browser/emulation': async ({ query }) => {
      const tab = str(query.get('tab'));
      await ready();
      return { emulation: service.emulation(tab) };
    },
    'POST /api/browser/emulation': async ({ json }) => {
      const b = await json<{ tab?: unknown; emulation?: Record<string, unknown> }>();
      const tab = str(b.tab);
      const e = b.emulation;
      if (!e || typeof e !== 'object') throw bad();
      const dim = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : undefined);
      const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      const width = dim(e.width, 10_000);
      const height = dim(e.height, 10_000);
      const dpr = dim(e.dpr, 10);
      const preset = text(e.preset);
      const userAgent = text(e.userAgent);
      const locale = text(e.locale);
      const timezone = text(e.timezone);
      const emulation: Emulation = {
        ...(preset ? { preset } : {}),
        ...(width && height ? { width, height, dpr: dpr ?? 1, mobile: e.mobile === true } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(locale ? { locale } : {}),
        ...(timezone ? { timezone } : {}),
      };
      await ready();
      await service.setEmulation(tab, emulation);
      return { emulation };
    },
    'POST /api/browser/network/har': async ({ json }) => {
      const b = await json<{ tab?: unknown }>();
      const tab = str(b.tab);
      await ready();
      return service.exportHar(tab);
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
    'GET /api/browser/mcp-config': () => {
      const config = mcpConfig();
      if (!config) throw invalid('notFound', 'The app address is not known yet.');
      return config;
    },
  };
}
