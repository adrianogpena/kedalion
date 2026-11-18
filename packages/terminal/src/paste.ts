/** When a paste asks first: 'multiLine' on a line break or a large paste, 'large' only on a large one. */
export type PasteWarning = 'multiLine' | 'large' | 'never';

/** Whether pasting `text` asks first. */
export function pasteNeedsWarning(text: string, mode: PasteWarning, largeSize: number): boolean {
  if (mode === 'never') return false;
  if (text.length > largeSize) return true;
  return mode === 'multiLine' && /[\r\n]/.test(text);
}

/** Line count, size and the first lines (each cut short) of a paste, for the warning. */
export function pasteSummary(text: string, maxLines = 5, maxWidth = 120): { lines: number; chars: number; preview: string } {
  const all = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const preview = all
    .slice(0, maxLines)
    .map((l) => (l.length > maxWidth ? `${l.slice(0, maxWidth)}…` : l))
    .join('\n');
  return { lines: all.length, chars: text.length, preview: all.length > maxLines ? `${preview}\n…` : preview };
}

/** Line continuation of a shell: what ends a line so the next one joins the same pending command. */
export function continuationOf(shell: string | undefined): string {
  switch (shell) {
    case 'bash':
    case 'zsh':
    case 'sh':
    case 'fish':
    case 'git-bash':
    case 'wsl':
      return ' \\\n';
    case 'pwsh':
    case 'powershell':
      return ' `\n';
    case 'cmd':
      return ' ^\n';
    default:
      return ' ';
  }
}

// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x9d[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[PX^_][^\x1b\x9c]*(?:\x1b\\|\x9c)?|\x1b[ -/]*[0-~]?/g;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/**
 * A paste that cannot run anything before the user presses Enter: escape sequences (injected
 * bracketed-paste markers too) and control characters other than tab and newline removed, trailing
 * line breaks dropped. With `bracketed` (the program turned bracketed paste on) the lines stay as
 * they are, for the terminal to bracket; otherwise they are joined with the shell's line
 * continuation (`continuationOf`), so they stay one pending command.
 */
export function sanitizePaste(text: string, opts: { bracketed: boolean; shell?: string }): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(ESCAPES, '')
    .replace(CONTROLS, '')
    .replace(/\s+$/, '')
    .split('\n');
  return opts.bracketed ? lines.join('\n') : lines.join(continuationOf(opts.shell));
}

/** Copied text without the trailing spaces of each line. */
export const trimCopied = (text: string): string => text.replace(/ +$/gm, '');

/** The `[Pasted text #N +M lines]` placeholder a program shows for a paste: the one under the column, else the last one before it, else the first. */
export function placeholderAt(text: string, col: number): { n: number; lines: number } | null {
  const found = [...text.matchAll(/\[Pasted text #(\d+)(?: \+(\d+) lines)?\]/g)];
  if (!found.length) return null;
  const at = (m: RegExpMatchArray) => m.index ?? 0;
  const under = found.find((m) => col >= at(m) && col <= at(m) + m[0].length);
  const before = found.filter((m) => at(m) <= col).pop();
  const m = under ?? before ?? found[0]!;
  return { n: Number(m[1]), lines: Number(m[2] ?? 0) };
}
