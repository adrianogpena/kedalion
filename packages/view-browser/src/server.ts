import { randomBytes } from 'node:crypto';
import { defineServerView, type ServerViewContext, socketTickets } from '@kedalion/server-core';
import { createMcpConfigFile } from './server/mcp/config.ts';
import { createDebugState } from './server/mcp/debug-state.ts';
import { MCP_INSTRUCTIONS } from './server/mcp/instructions.ts';
import { mcpRoutes } from './server/mcp/rpc.ts';
import { debugTools } from './server/mcp/tools-debug.ts';
import { stepTools } from './server/mcp/tools-steps.ts';
import { actTools } from './server/mcp/tools-act.ts';
import { pageTools } from './server/mcp/tools-page.ts';
import { stateTools } from './server/mcp/tools-state.ts';
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
  const secret = randomBytes(24).toString('hex');
  const mcpFile = createMcpConfigFile({ dataDir: opts.dataDir, secret, origin: opts.origin });
  const debug = createDebugState();
  const tools = [...pageTools, ...actTools,...stateTools, ...debugTools, ...stepTools];
  const refresh = async () => {
    if (load) current = browserSettingsOf(await load().catch(() => ({})));
    if (current.agentTools) mcpFile.write();
  };
  const bind = (ctx: ServerViewContext<BrowserServerSettings>) => {
    load = () => ctx.settings.load();
    void refresh();
  };
  const ready = async () => {
    await refresh();
    await service.ensure();
  };

  const view = defineServerView<BrowserServerSettings>({
    id: 'browser',
    icon: 'globe',
    routes: (ctx) => {
      bind(ctx);
      return browserRoutes({ service, ready, issueTicket: () => tickets.issue(true), mcpConfig: () => mcpFile.config() });
    },
    unauthenticated: (ctx) => {
      bind(ctx);
      return mcpRoutes({
        secret,
        tools,
        instructions: MCP_INSTRUCTIONS,
        context: () => ({ service, ready, dataDir: opts.dataDir, debug }),
        enabled: async () => {
          await refresh();
          return current.agentTools;
        },
      });
    },
    sockets: (ctx) => {
      bind(ctx);
      return browserSockets({ service, tickets, ready });
    },
    onQuit: () => service.stop(),
    settings: { validate: { browser: validBrowser }, spec: BROWSER_SPEC },
  });
  /** Path of `<dataDir>/mcp.json` for `agentsLauncher({ mcpConfig })`; undefined while the setting is off or the file is not written yet. */
  const mcpConfigFile = (): string | undefined => (current.agentTools ? mcpFile.write() : undefined);
  return Object.assign(view, { service, ready, mcpConfigFile });
}
