import { type FieldSpec, validGroup } from '@kedalion/server-core';

/** The `browser` settings group. */
export interface BrowserSettings {
  /** Browser executable; '' = Edge or Chrome found automatically. */
  executable: string;
  ignoreLocalCertErrors: boolean;
  /** Start the browser with flags that hide automation from websites (user agent, webdriver, screen); applies on the next start. */
  hideAutomation: boolean;
  /** Whether the Claude MCP browser tools are offered. */
  agentTools: boolean;
  /** Address of a new tab. */
  home: string;
}

/** The part of the server settings the Browser view owns; the app's `Settings` extends it. */
export interface BrowserServerSettings {
  browser?: Partial<BrowserSettings>;
}

export const BROWSER_DEFAULTS: BrowserSettings = { executable: '', ignoreLocalCertErrors: false, hideAutomation: true, agentTools: true, home: 'about:blank' };

export const BROWSER_SPEC: Record<string, FieldSpec> = {
  executable: 'string',
  ignoreLocalCertErrors: 'boolean',
  hideAutomation: 'boolean',
  agentTools: 'boolean',
  home: 'string',
};

/** A copy of `raw` when it is a well-formed `browser` group, else null. */
export function validBrowser(raw: unknown): Partial<BrowserSettings> | null {
  return validGroup(raw, BROWSER_SPEC) as Partial<BrowserSettings> | null;
}

/** The `browser` group with defaults filled in. */
export function browserSettingsOf(s: BrowserServerSettings | undefined): BrowserSettings {
  const b = s?.browser ?? {};
  return {
    executable: typeof b.executable === 'string' ? b.executable : BROWSER_DEFAULTS.executable,
    ignoreLocalCertErrors: typeof b.ignoreLocalCertErrors === 'boolean' ? b.ignoreLocalCertErrors : BROWSER_DEFAULTS.ignoreLocalCertErrors,
    hideAutomation: typeof b.hideAutomation === 'boolean' ? b.hideAutomation : BROWSER_DEFAULTS.hideAutomation,
    agentTools: typeof b.agentTools === 'boolean' ? b.agentTools : BROWSER_DEFAULTS.agentTools,
    home: typeof b.home === 'string' && b.home ? b.home : BROWSER_DEFAULTS.home,
  };
}
