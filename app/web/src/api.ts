import type { SqlFormatOptions } from '@kedalion/editor';

import type { ThemeSettings } from '@kedalion/server-core/palettes';
import type { BackupInspect, EditorInfo, FsDuProgress, FsHash, FsInfo, ImportResult, SqlHistoryEntry, TailChunk } from '@kedalion/server-core/protocol';

export type { EditorInfo, FsDuProgress, FsHash, FsInfo, ImportResult, TailChunk };
import type { SessionInfo, TerminalProfileInfo } from '@kedalion/terminal';
import type { TerminalSettings, TerminalViewSettings } from '@kedalion/view-terminal/web';
import type { ExplorerSettings, FsEntry, FsRead, Project, SearchHit, TextEncoding } from '@kedalion/view-explorer/web';
import type { GitViewSettings } from '@kedalion/view-git/web';
import type { AgentsViewSettings } from '@kedalion/view-agents/web';
import type { BrowserViewSettings } from '@kedalion/view-browser/web';
import type { RestViewSettings } from '@kedalion/view-rest/web';
import type { WorkbenchViewSettings } from '@kedalion/view-workbench/web';
import type { CopyFormat, DbColumn, DbPlanRow, DbRunResult, DbSchema, DbSchemaTable, DbStatus, DbTableConstraint, DbTableDetails, DbTableIndex, DemoRow } from '@kedalion/sql-ui';
import { type FileAssociation, type GitSettings, type FileSettings, type Keymap, type Language, type LinkTarget, type LogSettings, type ResultFormat, request } from '@kedalion/ui';

export type { TerminalSettings };

export interface Settings extends ThemeSettings, TerminalViewSettings, WorkbenchViewSettings, RestViewSettings, GitViewSettings, AgentsViewSettings, BrowserViewSettings {
  language?: Language;
  /** The main menu shows only its icons. */
  /** Keybinding overrides by command id; the server validates it. */
  keybindings?: Keymap;
  autostart: boolean;
  /** Tray icon; read at startup. */
  closeToTray: boolean;
  /** Server port, read at startup; 0 = default. */
  port: number;
  /** Settings reopens on the last page shown (until the app restarts). */
  rememberSettingsPage: boolean;
  /** Layout of the Tabs screen; restored (and validated) by the screen. */
  tabsLayout?: unknown;
  /** State of the Explorer screen; the server validates it. */
  explorer?: ExplorerSettings;
  /** Log viewer: highlight words and bookmarks (keyed `<projectId>:<path>`); the server validates it. */
  logs?: LogSettings;
  /** Files opened as another type; the server validates it. */
  fileAssociations?: FileAssociation[];
  /** How text files are saved and how the Explorer shows files; the server validates it. */
  files?: FileSettings;
  /** Fonts, editor font metrics and motion; the server validates it. */
  appearance?: AppearanceSettings;
  /** How text editors behave; the server validates it. */
  editor?: EditorSettings;
  /** Sidebar side, status bar and tabs; the server validates it. */
  window?: WindowSettings;
  /** Closing and notifications; the server validates it. */
  general?: GeneralSettings;
  /** Shortcut behavior; the server validates it. */
  keyboard?: KeyboardSettings;
  /** Git screen behavior; the server validates it. */
  git?: GitSettings;
  /** Where links open, globally and per view or panel scope; the server validates it. */
  links?: LinksSettings;
}

export interface LinksSettings {
  openIn?: LinkTarget;
  /** Scope (`view:<id>`, `panel:<kind>`) to target; a missing key follows `openIn`. */
  scopes?: Record<string, LinkTarget>;
}

export interface AppearanceSettings {
  uiFontFamily?: string;
  editorFontFamily?: string;
  /** Pixels, 8 to 32. */
  editorFontSize?: number;
  /** Multiple of the font size, 1 to 3. */
  editorLineHeight?: number;
  editorLigatures?: boolean;
  reduceMotion?: boolean;
}

export interface EditorSettings {
  /** Width of a tab character in columns, 1 to 8. */
  tabSize?: number;
  insertSpaces?: boolean;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  highlightActiveLine?: boolean;
  renderWhitespace?: 'none' | 'selection' | 'all';
  bracketMatching?: boolean;
  autoCloseBrackets?: boolean;
  cursorStyle?: 'line' | 'block' | 'underline';
  cursorBlink?: boolean;
}

export interface WindowSettings {
  sidebarSide?: 'left' | 'right';
  statusBar?: boolean;
  tabSizing?: 'fit' | 'shrink';
  tabCloseButton?: 'right' | 'left' | 'hidden';
  tabIcons?: boolean;
}

export interface GeneralSettings {
  confirmCloseDirty?: boolean;
  /** Milliseconds a toast stays, 1000 to 60 000; errors stay longer. */
  toastDuration?: number;
  startScreen?: string;
  /** Browser for links the app opens (Run panel URLs, --browser mode): edge, chrome, firefox or an executable path; blank = system default. */
  browser?: string;
}

export interface KeyboardSettings {
  /** Milliseconds the next key of a multi-step shortcut may take, 500 to 10 000. */
  chordTimeout?: number;
}


export type { CopyFormat };
export type { LogSettings, ResultFormat, SqlFormatOptions };


export { withWorkbenchDefaults, type WorkbenchDoc, type WorkbenchSettings } from '@kedalion/view-workbench/web';

import type { DbConnection } from '@kedalion/sql-ui';
export type { DbConnection };

export type { DbColumn, DbPlanRow, DbRunResult, DbSchema, DbSchemaTable, DbStatus, DbTableConstraint, DbTableDetails, DbTableIndex, DemoRow };
export type { SqlHistoryEntry };

export type { ExplorerSettings, FsEntry, FsRead, Project, SearchHit, TextEncoding };


export type BackupInfo = BackupInspect;


/** GET /api/info (infoRoutes in @kedalion/server-mods). */
export interface Info {
  name: string;
  version: string;
  platform: string;
  arch: string;
  hostname: string;
  bun: string;
  dataDir: string;
  startedAt: string;
  /** GitHub `owner/name` of the app, when it has one. */
  repo?: string;
}

export const api = {
  info: () => request<Info>('GET', '/api/info'),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', {}, patch),
  openSettingsFile: () => request<{ ok: true }>('POST', '/api/settings/open-file'),
  externalSettings: () => request<{ changed: boolean; settings: Settings }>('GET', '/api/settings/external'),
  openExternal: (url: string) => request<{ ok: boolean }>('POST', '/api/browser/open-external', {}, { url }),
  quit: () => request<{ ok: boolean }>('POST', '/api/quit'),
  testToast: () => request<{ ok: true }>('POST', '/api/toast/test'),
  backupParts: () => request<{ stores: string[] }>('GET', '/api/backup/parts'),
  exportBackup: (settings: boolean, stores: string[], target: string) =>
    request<{ path: string; counts?: Record<string, number> }>('POST', '/api/backup/export', {}, { settings, stores, target }),
  inspectBackup: (path: string) => request<BackupInfo>('POST', '/api/backup/inspect', {}, { path }),
  importBackup: (token: string, settings: boolean, stores: string[], mode: 'merge' | 'replace') =>
    request<{ settings: boolean; stores: Record<string, ImportResult> }>('POST', '/api/backup/import', {}, { token, settings, stores, mode }),
  editors: () => request<EditorInfo[]>('GET', '/api/editors'),
  pickEditor: (editor: EditorInfo['id'], path: string) => request<EditorInfo[]>('POST', '/api/editors/pick', {}, { editor, path }),
  resetEditor: (editor: EditorInfo['id']) => request<EditorInfo[]>('DELETE', '/api/editors/override', { editor }),
  /** Ids of the shells installed on this machine (no `'auto'`). */
  terminalShells: () => request<string[]>('GET', '/api/terminal/shells'),
  /** Built-in profiles (installed shells, overrides applied), then custom ones, each with `available`. */
  terminalProfiles: () => request<TerminalProfileInfo[]>('GET', '/api/terminal/profiles'),
  /** Every running terminal session, with its title and bell count. */
  terminalSessions: () => request<SessionInfo[]>('GET', '/api/terminal/sessions'),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
