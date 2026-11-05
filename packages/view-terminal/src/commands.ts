import { type CommandDef, tabCommands } from '@kedalion/ui';
import { t, type TerminalMessageKey } from './i18n';

const PANE_DIRS = ['Left', 'Right', 'Up', 'Down'] as const;

/** Terminal view commands the screen runs (panes, new tabs); they reach it while a terminal has focus. */
export const TERMINAL_SCREEN_COMMANDS = [
  ...PANE_DIRS.map((d) => `terminal.focus${d}`),
  ...PANE_DIRS.map((d) => `terminal.resize${d}`),
  'terminal.splitRight',
  'terminal.splitDown',
  ...Array.from({ length: 9 }, (_, i) => `terminal.newTabProfile${i + 1}`),
  'terminal.newTabMenu',
  'terminal.togglePanel',
];

/** Terminal pane, zoom, scroll and new-tab commands (the pane ones mirror `PANE_COMMANDS` of the terminal package). */
export function terminalCommands(): CommandDef[] {
  const def = (name: string, keys: string[], label = t(`keys.terminal.${name}` as TerminalMessageKey)): CommandDef => ({
    id: `terminal.${name}`, scope: 'terminal', label, keys,
  });
  return [
    ...tabCommands('terminal'),
    { id: 'terminal.find', scope: 'terminal', label: t('keys.terminal.find'), keys: ['Ctrl+Shift+F'] },
    { id: 'terminal.prevCommand', scope: 'terminal', label: t('keys.terminal.prevCommand'), keys: ['Ctrl+ArrowUp'] },
    { id: 'terminal.nextCommand', scope: 'terminal', label: t('keys.terminal.nextCommand'), keys: ['Ctrl+ArrowDown'] },
    def('zoomIn', ['Ctrl+=', 'Ctrl++', 'Ctrl+Shift++']),
    def('zoomOut', ['Ctrl+-']),
    def('zoomReset', ['Ctrl+0']),
    def('scrollLineUp', ['Ctrl+Shift+ArrowUp']),
    def('scrollLineDown', ['Ctrl+Shift+ArrowDown']),
    def('scrollPageUp', ['Ctrl+Shift+PageUp']),
    def('scrollPageDown', ['Ctrl+Shift+PageDown']),
    def('scrollTop', ['Ctrl+Shift+Home']),
    def('scrollBottom', ['Ctrl+Shift+End']),
    def('clear', ['Ctrl+Shift+K']),
    def('hints', ['Ctrl+Shift+E']),
    def('togglePanel', ['Ctrl+Shift+H']),
    ...PANE_DIRS.map((d) => def(`focus${d}`, [`Alt+Arrow${d}`])),
    ...PANE_DIRS.map((d) => def(`resize${d}`, [`Alt+Shift+Arrow${d}`])),
    def('splitRight', ['Alt+Shift++', 'Alt+Shift+=']),
    def('splitDown', ['Alt+Shift+_', 'Alt+Shift+-']),
    ...Array.from({ length: 9 }, (_, i) => def(`newTabProfile${i + 1}`, [`Ctrl+Shift+${i + 1}`], t('keys.terminal.newTabProfile', { n: i + 1 }))),
    def('newTabMenu', ['Ctrl+Shift+Space']),
  ];
}

export function terminalCommandById(id: string): CommandDef {
  const def = terminalCommands().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
