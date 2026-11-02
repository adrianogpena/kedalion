import type { CommandDef } from '@kedalion/ui';
import type { BrowserKeyAction } from './keys';
import { t } from './i18n';

export type BrowserCommandAction = Exclude<BrowserKeyAction, 'palette'>;

/** Chords of the screen commands; the palette chord stays the app's. */
export const BROWSER_CHORDS: Record<BrowserCommandAction, string[]> = {
  focusUrl: ['Ctrl+L'],
  newTab: ['Ctrl+T'],
  closeTab: ['Ctrl+W'],
  nextTab: ['Ctrl+Tab'],
  prevTab: ['Ctrl+Shift+Tab'],
  reload: ['F5', 'Ctrl+R'],
  devtools: ['F12'],
  back: ['Alt+ArrowLeft'],
  forward: ['Alt+ArrowRight'],
};

export const BROWSER_ACTIONS = Object.keys(BROWSER_CHORDS) as BrowserCommandAction[];

export const browserCommandDef = (action: BrowserCommandAction): CommandDef => ({
  id: `browser.${action}`,
  scope: 'browser',
  label: t(`keys.browser.${action}`),
  keys: BROWSER_CHORDS[action],
  inInput: true,
});

export const browserCommands = (): CommandDef[] => BROWSER_ACTIONS.map(browserCommandDef);
