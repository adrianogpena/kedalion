import { bool, groupField, str, type SettingDef } from '@kedalion/ui';

/** The stored `browser` settings group; the server validates it. */
export interface BrowserSettingsGroup {
  /** Browser executable; '' = Edge or Chrome found automatically. */
  executable?: string;
  ignoreLocalCertErrors?: boolean;
  /** Start the browser with flags that hide automation from websites; applies on the next start. */
  hideAutomation?: boolean;
  /** Whether the Claude MCP browser tools are offered. */
  agentTools?: boolean;
  /** Address of a new tab. */
  home?: string;
}

/** The part of the app settings the Browser view reads and writes; the app's `Settings` extends it. */
export interface BrowserViewSettings {
  browser?: BrowserSettingsGroup;
}

export const browserSettingDefs: SettingDef<BrowserViewSettings>[] = [
  groupField<BrowserViewSettings, 'browser'>('browser', 'executable', 10, str('')),
  groupField<BrowserViewSettings, 'browser'>('browser', 'ignoreLocalCertErrors', 20, bool(false)),
  groupField<BrowserViewSettings, 'browser'>('browser', 'hideAutomation', 25, bool(true)),
  groupField<BrowserViewSettings, 'browser'>('browser', 'agentTools', 30, bool(true)),
  { id: 'browser.regenerateSecret', kind: 'custom', section: ['browser'], order: 35, label: 'settings.browser.regenerateSecret', description: 'settings.browser.regenerateSecret.hint', default: null },
  groupField<BrowserViewSettings, 'browser'>('browser', 'home', 40, str('about:blank')),
];
