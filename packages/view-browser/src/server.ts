import { defineServerView, type ServerViewContext, socketTickets } from '@kedalion/server-core';
import { browserRoutes } from './server/routes.ts';
import { type BrowserService, createBrowserService } from './server/service.ts';
import { BROWSER_DEFAULTS, type BrowserServerSettings, type BrowserSettings, BROWSER_SPEC, browserSettingsOf, validBrowser } from './server/settings.ts';
import { browserSockets } from './server/socket.ts';

export { BROWSER_SOCKET_PATH } from './protocol.ts';
export type { BrowserService } from './server/service.ts';
export { type BrowserServerSettings, type BrowserSettings, browserSettingsOf } from './server/settings.ts';

export interface BrowserServerViewOptions {
  /** Browser profile folder (kept between runs). */
  profileDir: string;
  /** Folder of the view's own files (`tabs.json`). */
  dataDir: string;
  /** Origin of the app server, allowed to open the debugging socket. */
  origin: () => string | undefined;
}

/**
 * Server half of the Browser view: a headless Edge/Chrome driven over CDP, its tabs, logs and screencast.
 * The result also carries `service` (for the MCP tools) and `ready()` (loads the settings, starts the browser).
 */
export function browserServerView(opts: BrowserServerViewOptions) {
  let current: BrowserSettings = BROWSER_DEFAULTS;
  let load: (() => Promise<BrowserServerSettings>) | undefined;
  const service: BrowserService = createBrowserService({ ...opts, settings: () => current });
  const tickets = socketTickets<true>();
  const bind = (ctx: ServerViewContext<BrowserServerSettings>) => {
    load = () => ctx.settings.load();
  };
  const ready = async () => {
    if (load) current = browserSettingsOf(await load().catch(() => ({})));
    await service.ensure();
  };

  const view = defineServerView<BrowserServerSettings>({
    id: 'browser',
    icon: 'globe',
    routes: (ctx) => {
      bind(ctx);
      return browserRoutes({ service, ready, issueTicket: () => tickets.issue(true) });
    },
    sockets: (ctx) => {
      bind(ctx);
      return browserSockets({ service, tickets, ready });
    },
    onQuit: () => service.stop(),
    settings: { validate: { browser: validBrowser }, spec: BROWSER_SPEC },
  });
  return Object.assign(view, { service, ready });
}
