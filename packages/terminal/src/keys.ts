import { chordOf, type KeyLike } from '@kedalion/ui/keybindings';

/**
 * Commands a terminal pane runs itself, with their default keys (the fallback without a keymap;
 * the app lists the same ids and keys so they show in its shortcuts).
 */
export const PANE_COMMANDS = {
  'terminal.zoomIn': ['Ctrl+=', 'Ctrl++', 'Ctrl+Shift++'],
  'terminal.zoomOut': ['Ctrl+-'],
  'terminal.zoomReset': ['Ctrl+0'],
  'terminal.scrollLineUp': ['Ctrl+Shift+ArrowUp'],
  'terminal.scrollLineDown': ['Ctrl+Shift+ArrowDown'],
  'terminal.scrollPageUp': ['Ctrl+Shift+PageUp'],
  'terminal.scrollPageDown': ['Ctrl+Shift+PageDown'],
  'terminal.scrollTop': ['Ctrl+Shift+Home'],
  'terminal.scrollBottom': ['Ctrl+Shift+End'],
  'terminal.clear': ['Ctrl+Shift+K'],
  'terminal.hints': ['Ctrl+Shift+E'],
} as const satisfies Record<string, readonly string[]>;
export type PaneCommand = keyof typeof PANE_COMMANDS;

/** What a key pressed inside the terminal does. */
export type TerminalKeyAction = 'app' | 'find' | 'prevCommand' | 'nextCommand' | 'copy' | 'paste' | 'terminal' | PaneCommand;

/**
 * Keys go to the program, except the find chord (opens the find bar), the previous/next command chords, the pane command
 * chords (`pane`: chord to command), chords of the allowed app commands, Ctrl+C / Ctrl+Shift+C with text selected (copy),
 * and Ctrl+V / Ctrl+Shift+V (paste).
 */
export function terminalKeyAction(
  e: KeyLike,
  hasSelection: boolean,
  appChords: ReadonlySet<string>,
  findChords: ReadonlySet<string> = new Set(),
  navChords: { prev: ReadonlySet<string>; next: ReadonlySet<string> } = { prev: new Set(), next: new Set() },
  pane: ReadonlyMap<string, PaneCommand> = new Map(),
): TerminalKeyAction {
  const chord = chordOf(e);
  if (!chord) return 'terminal';
  if (findChords.has(chord)) return 'find';
  if (navChords.prev.has(chord)) return 'prevCommand';
  if (navChords.next.has(chord)) return 'nextCommand';
  const own = pane.get(chord);
  if (own) return own;
  if (appChords.has(chord)) return 'app';
  if ((chord === 'Ctrl+C' || chord === 'Ctrl+Shift+C') && hasSelection) return 'copy';
  if (chord === 'Ctrl+V' || chord === 'Ctrl+Shift+V') return 'paste';
  return 'terminal';
}
