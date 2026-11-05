import { type CommandDef, GLOBAL, paletteCommand, quickOpenCommand } from '@kedalion/ui';
import { t } from './i18n';

/** What `commands` needs of the view list (`createViews`). */
export interface CommandViews {
  nav: Array<{ items: Array<{ id: string }> }>;
  label(id: string): string;
  commands(): CommandDef[];
  keybindings(): CommandDef[];
}

let bound: CommandViews | undefined;
/** The list `commandById` reads; set once by views.ts. */
export const bindViews = (views: CommandViews) => {
  bound = views;
};

export const navCommandId = (screen: string) => `nav.${screen}`;
export const SETTINGS_COMMAND = 'app.settings';
export const KEYS_COMMAND = 'app.keybindings';
export const POPOUT_COMMAND = 'window.popOut';
export const NOTIFICATIONS_COMMAND = 'app.notifications';

/** Every shortcut of the gallery; built at render so the labels follow the language. */
export function commands(views: CommandViews): CommandDef[] {
  const nav = views.nav.flatMap((s) => s.items).map((item, i): CommandDef => ({
    id: navCommandId(item.id), scope: GLOBAL, label: views.label(item.id), keys: [`Ctrl+${i + 1}`], inInput: true,
  }));
  return [
    paletteCommand(),
    quickOpenCommand(),
    ...nav,
    // Settings and keybindings are modals over the screen, not screens; both are VS Code's keys.
    { id: SETTINGS_COMMAND, scope: GLOBAL, label: t('nav.settings'), keys: ['Ctrl+,'], inInput: true },
    { id: KEYS_COMMAND, scope: GLOBAL, label: t('nav.keys'), keys: ['Ctrl+K Ctrl+S'], inInput: true },
    { id: POPOUT_COMMAND, scope: GLOBAL, label: t('window.popOut'), keys: ['Ctrl+Alt+O'], inInput: true, desktopOnly: true },
    { id: NOTIFICATIONS_COMMAND, scope: GLOBAL, label: t('nav.notifications'), keys: ['Ctrl+Alt+N'], inInput: true },
    ...views.keybindings(),
    ...views.commands(),
  ];
}

export function commandById(id: string): CommandDef {
  if (!bound) throw new Error('Views are not bound');
  const def = commands(bound).find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
