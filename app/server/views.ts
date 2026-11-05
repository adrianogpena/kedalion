import { homedir } from 'node:os';
import { join } from 'node:path';
import { appHome, createNotifications } from '@kedalion/platform';
import type { ServerViewDef } from '@kedalion/server-core';
import { dashboardServerView, dashboardSources, dashboardSpecs } from '@kedalion/view-grid/server';
import { browserServerView } from '@kedalion/view-browser/server';
import { explorerServerView } from '@kedalion/view-explorer/server';
import { gitServerView } from '@kedalion/view-git/server';
import { restServerView } from '@kedalion/view-rest/server';
import { terminalServerView } from '@kedalion/view-terminal/server';
import { workbenchServerView } from '@kedalion/view-workbench/server';
import { launchers, terminalSessions } from '@kedalion/terminal/server';
import { agentsLauncher, agentsServerView } from '@kedalion/view-agents/server';
import { APP } from '../app.ts';
import { MULTI_DELETE_ENABLED } from '../app.ts';

/** The server half of the view list (`web/src/views.ts`): routes, sockets, settings groups and quit hooks. */
const explorer = explorerServerView({ multiDelete: MULTI_DELETE_ENABLED });
/** Claude config home of the Agents view; the `claude` terminal launcher uses the same one. */
const agentsHome = homedir();
/** The app's one notifier (OS toasts); each view sends through `notifications.for(viewId)` and gets its icon. */
export const notifications = createNotifications({ appName: APP.name, link: () => appLink });

/** Every terminal session (Terminal view and Agents launcher); `main.ts` hands it the settings with `configure`. */
export const terminalStore = terminalSessions({
  notify: (n) => void notifications.for('terminal')({ title: n.title, body: n.body, path: 'terminal' }),
  earlierDir: join(appHome(APP.id), 'terminal', 'earlier'),
  historyFile: join(appHome(APP.id), 'terminal', 'history.json'),
});

let appLink: ((path: string) => string) | undefined;
let appOrigin: (() => string | undefined) | undefined;
/** Called with `StartContext.link` and `.origin` once the app starts; toasts from the Agents view use the link as their click target. */
export const setAppLink = (link: (path: string) => string, origin?: () => string | undefined) => {
  appLink = link;
  appOrigin = origin;
};

const browser = browserServerView({
  profileDir: join(appHome(APP.id), 'browser-profile'),
  dataDir: join(appHome(APP.id), 'browser'),
  origin: () => appOrigin?.(),
});

export const serverViews: ServerViewDef[] = [
  explorer,
  terminalServerView({ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd: explorer.resolveCwd, launchers: launchers({ claude: agentsLauncher({ home: agentsHome, mcpConfig: () => browser.mcpConfigFile() }) }), sessions: terminalStore }),
  workbenchServerView(),
  restServerView(),
  gitServerView(),
  dashboardServerView({ panels: dashboardSpecs, sources: dashboardSources, notifications }),
  browser,
  agentsServerView({
    home: agentsHome,
    link: () => appLink,
    notifications,
    terminals: terminalStore,
    terminalScreens: () =>
      terminalStore
        .list()
        .flatMap((s) => (s.exited === undefined && typeof s.meta?.agentSession === 'string' ? [[s.meta.agentSession, terminalStore.screenLines(s.id, 25)] as [string, string[]]] : [])),
  }),
];
