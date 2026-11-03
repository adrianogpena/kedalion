import { join } from 'node:path';
import { appHome, createAutostart, setBrowser } from '@kedalion/platform';
import { applyViewSettings, checkViewSettings, type FieldSpec, mountViews, validGroup } from '@kedalion/server-core';
import { backupRoutes, infoRoutes, fileDialogRoutes, settingsRoutes, settingsStore, themeHead, type BaseSettings } from '@kedalion/server-mods';
import { runApp } from '@kedalion/shell';
import type { ExplorerServerSettings } from '@kedalion/view-explorer/server';
import type { GitServerSettings } from '@kedalion/view-git/server';
import type { AgentsServerSettings } from '@kedalion/view-agents/server';
import type { BrowserServerSettings } from '@kedalion/view-browser/server';
import { restHistorySizeOf, type RestServerSettings } from '@kedalion/view-rest/server';
import type { TerminalServerSettings } from '@kedalion/view-terminal/server';
import { historySizeOf, type WorkbenchServerSettings } from '@kedalion/view-workbench/server';
import type { DashboardServerSettings } from '@kedalion/view-grid/server';
import { validKeymap, type Keymap } from '@kedalion/ui/keybindings';
import { type FileAssociation, validFileAssociations } from '@kedalion/ui/file-associations';
import { type FileSettings, validFileSettings } from '@kedalion/ui/file-settings';
import { type LogSettings, validLogSettings } from '@kedalion/ui/log';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { routes } from './routes.ts';
import { stores } from './stores.ts';
import { serverViews, setAppLink } from './views.ts';

export interface Settings extends BaseSettings, TerminalServerSettings, WorkbenchServerSettings, RestServerSettings, GitServerSettings,DashboardServerSettings, ExplorerServerSettings, AgentsServerSettings, BrowserServerSettings {
  /** Start at Windows login (exe only). */
  autostart: boolean;
  /** Tray icon, so closing the window keeps the app running; read at startup. */
  closeToTray: boolean;
  /** Server port, read at startup; 0 = automatic (the app default). */
  port: number;
  /** The Settings modal reopens on the last page shown (kept in memory by the UI). */
  rememberSettingsPage: boolean;
  /** Keybinding overrides by command id, checked by `validKeymap`. */
  keybindings?: Keymap;
  /** Layout of the Tabs screen (`serialize` of `@kedalion/ui`'s tabs); the UI validates it on restore. */
  tabsLayout?: unknown;
  /** Log viewer: highlight words (global) and bookmarks per `<projectId>:<path>`. */
  logs?: LogSettings;
  /** Files opened as another type: a name glob and the extension to treat them as. */
  fileAssociations?: FileAssociation[];
  /** How text files are saved and how the Explorer shows files, checked by `validFileSettings`. */
  files?: FileSettings;
  /** Fonts, editor font metrics and motion, checked by `validGroup`. */
  appearance?: Record<string, string | number | boolean>;
  /** How text editors behave, checked by `validGroup`. */
  editor?: Record<string, string | number | boolean>;
  /** Sidebar side, status bar and tabs, checked by `validGroup`. */
  window?: Record<string, string | number | boolean>;
  /** Closing and notifications, checked by `validGroup`. */
  general?: Record<string, string | number | boolean>;
  /** Shortcut behavior, checked by `validGroup`. */
  keyboard?: Record<string, string | number | boolean>;
  git?: Record<string, string | number | boolean>;
  /** Where links open (Kedalion browser or the default one), globally and per view or panel scope; checked by `validLinks`. */
  links?: { openIn?: string; scopes?: Record<string, string> };
}

const LINK_TARGETS: readonly string[] = ['internal', 'external'];
const LINK_SCOPE = /^(view|panel):[a-z0-9-]{1,60}$/;
const MAX_LINK_SCOPES = 200;

/** A copy of the `links` group when `openIn` and every scope fit, else null. */
function validLinks(raw: unknown): { openIn?: string; scopes?: Record<string, string> } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: { openIn?: string; scopes?: Record<string, string> } = {};
  for (const [key, v] of Object.entries(raw)) {
    if (key === 'openIn') {
      if (typeof v !== 'string' || !LINK_TARGETS.includes(v)) return null;
      out.openIn = v;
    } else if (key === 'scopes') {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      const entries = Object.entries(v);
      if (entries.length > MAX_LINK_SCOPES) return null;
      const scopes: Record<string, string> = {};
      for (const [scope, target] of entries) {
        if (!LINK_SCOPE.test(scope) || typeof target !== 'string' || !LINK_TARGETS.includes(target)) return null;
        scopes[scope] = target;
      }
      out.scopes = scopes;
    } else return null;
  }
  return out;
}

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;
const APPEARANCE_SPEC: Record<string, FieldSpec> = {
  uiFontFamily: 'string',
  editorFontFamily: 'string',
  editorFontSize: [8, 32],
  editorLineHeight: [1, 3],
  editorLigatures: 'boolean',
  reduceMotion: 'boolean',
};
const EDITOR_SPEC: Record<string, FieldSpec> = {
  tabSize: [1, 8],
  insertSpaces: 'boolean',
  wordWrap: 'boolean',
  lineNumbers: 'boolean',
  highlightActiveLine: 'boolean',
  renderWhitespace: ['none', 'selection', 'all'],
  bracketMatching: 'boolean',
  autoCloseBrackets: 'boolean',
  cursorStyle: ['line', 'block', 'underline'],
  cursorBlink: 'boolean',
};
const WINDOW_SPEC: Record<string, FieldSpec> = {
  sidebarSide: ['left', 'right'],
  statusBar: 'boolean',
  tabSizing: ['fit', 'shrink'],
  tabCloseButton: ['right', 'left', 'hidden'],
  tabIcons: 'boolean',
};
const GENERAL_SPEC: Record<string, FieldSpec> = {
  confirmCloseDirty: 'boolean',
  toastDuration: [1000, 60_000],
  startScreen: ['dashboard', 'explorer', 'workbench', 'rest', 'terminal', 'git', 'agents', 'browser'],
  browser: 'string',
};
const KEYBOARD_SPEC: Record<string, FieldSpec> = {
  chordTimeout: [500, 10_000],
};
const dataDir = appHome(APP.id);
const browserOf = (s: Settings) => (typeof s.general?.browser === 'string' ? s.general.browser : undefined);
const autostart = createAutostart({ name: APP.name });
const settings = settingsStore<Settings>({
  dir: dataDir,
  defaults: { theme: 'dark', autostart: false, closeToTray: false, port: 0, rememberSettingsPage: true },
  check: (patch, prev) => checkViewSettings(serverViews, patch, prev as unknown as Record<string, unknown>),
  apply(patch, next) {
    if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart;
    if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
    if (typeof patch.port === 'number' && Number.isInteger(patch.port) && (patch.port === 0 || (patch.port >= 1024 && patch.port <= 65535))) next.port = patch.port;
    if (typeof patch.rememberSettingsPage === 'boolean') next.rememberSettingsPage = patch.rememberSettingsPage;
    if (typeof patch.tabsLayout === 'object' && patch.tabsLayout !== null && JSON.stringify(patch.tabsLayout).length < MAX_TABS_LAYOUT_BYTES) {
      next.tabsLayout = patch.tabsLayout;
    }
    const logs = validLogSettings(patch.logs);
    if (logs) next.logs = logs;
    const fileAssociations = validFileAssociations(patch.fileAssociations);
    if (fileAssociations) next.fileAssociations = fileAssociations;
    const files = validFileSettings(patch.files);
    if (files) next.files = files;
    const appearance = validGroup(patch.appearance, APPEARANCE_SPEC);
    if (appearance) next.appearance = appearance;
    const editor = validGroup(patch.editor, EDITOR_SPEC);
    if (editor) next.editor = editor;
    const windowGroup = validGroup(patch.window, WINDOW_SPEC);
    if (windowGroup) next.window = windowGroup;
    const general = validGroup(patch.general, GENERAL_SPEC);
    if (general) next.general = general;
    const keyboard = validGroup(patch.keyboard, KEYBOARD_SPEC);
    if (keyboard) next.keyboard = keyboard;
    const links = validLinks(patch.links);
    if (links) next.links = links;
    const keybindings = validKeymap(patch.keybindings);
    if (keybindings) next.keybindings = keybindings;
    applyViewSettings(serverViews, patch, next as unknown as Record<string, unknown>);
  },
  onChange(next, prev) {
    if (next.autostart !== prev.autostart) void autostart.set(next.autostart);
    stores.sqlHistory.setMax(historySizeOf(next));
    stores.restHistory.setMax(restHistorySizeOf(next));
    setBrowser(browserOf(next));
  },
});

const { closeToTray } = await settings.load();
setBrowser(browserOf(await settings.load()));
stores.sqlHistory.setMax(historySizeOf(await settings.load()));
stores.restHistory.setMax(restHistorySizeOf(await settings.load()));

const mounted = mountViews(serverViews, { dataDir, settings, stores });

await runApp({
  app: APP,
  // Fixed port so the browser keeps per-origin permissions such as local fonts.
  port: async () => (await settings.load()).port || 27610,
  routes: (ctx) => ({
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    // Machine-specific: autostart writes the Run key, port is per machine.
    ...backupRoutes({ app: { id: APP.id, version: pkg.version }, settings, stores: { projects: stores.projects, dbConnections: stores.dbConnections, requests: stores.requests, chains: stores.chains, environments: stores.environments }, excludeSettings: ['autostart', 'port'], picks: stores.picks }),
    ...(setAppLink(ctx.link, ctx.origin), routes(ctx)),
    ...mounted.routes,
    ...fileDialogRoutes({ home: dataDir, picks: stores.picks }),
    ...(stores.ui.setReveal(ctx.reveal), stores.ui.routes),
  }),
  sockets: { ...mounted.sockets, ...stores.ui.sockets },
  unauthenticated: mounted.unauthenticated,
  onQuit: () => mounted.onQuit(),
  confirmQuit: async () => {
    const messages = await mounted.quitGuard();
    return messages.length === 0 || stores.ui.confirm({ title: APP.name, message: messages.join('\n\n'), okKey: 'confirm.quit', danger: true });
  },
  webDir: join(import.meta.dir, '../dist/web'),
  transformIndex: themeHead(settings),
  urlProtocol: true,
  tray: closeToTray,
  async onStart() {
    // Repairs the Run entry after the exe moved.
    if ((await settings.load()).autostart) await autostart.fixUp();
  },
});
