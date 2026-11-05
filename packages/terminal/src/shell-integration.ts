/** An OSC 133 mark: A prompt start, B prompt end (input starts), C command output starts, D command done with its exit code. */
export type PromptMark = { kind: 'A' } | { kind: 'B' } | { kind: 'C' } | { kind: 'D'; code: number | null };

/** Parses the data of an OSC 133 sequence (`A`, `B`, `C`, `D;0`, `D`); null for anything else. */
export function parseOsc133(data: string): PromptMark | null {
  const [kind, arg] = data.split(';');
  if (kind === 'A' || kind === 'B' || kind === 'C') return { kind };
  if (kind !== 'D') return null;
  const code = arg !== undefined && /^-?\d+$/.test(arg.trim()) ? Number(arg.trim()) : null;
  return { kind: 'D', code };
}

/**
 * The command line of an OSC 633 `E` report (VS Code's escaping: `\\` for a backslash, `\xHH` for `;`, newlines
 * and control characters); null for any other OSC 633 sequence.
 */
export function parseOsc633Command(data: string): string | null {
  if (!data.startsWith('E;')) return null;
  const raw = data.slice(2).split(';', 1)[0];
  return raw.replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_all, _esc: string, hex?: string) => (hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'));
}

/**
 * The folder of an OSC 7 report (`file://host/path`, percent-encoded); a Windows drive path loses its
 * leading slash (`/C:/x` → `C:/x`). Null when it is not a file URL.
 */
export function parseOsc7(data: string): string | null {
  if (data.length > 4096) return null;
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    path = m[1];
  }
  return /^\/[A-Za-z]:([\\/]|$)/.test(path) ? path.slice(1) : path;
}

/** Values of the `{name}` placeholders in a tab title template. */
export interface TitleVars {
  name?: string;
  shell?: string;
  folder?: string;
  cwd?: string;
  title?: string;
}

/** Fills a tab title template; unknown placeholders stay as typed, empty ones vanish; the result is trimmed. */
export function formatTabTitle(template: string, vars: TitleVars): string {
  return template
    .replace(/\{(\w+)\}/g, (all, key: string) => (key in TITLE_KEYS ? (vars[key as keyof TitleVars] ?? '') : all))
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_KEYS = { name: 1, shell: 1, folder: 1, cwd: 1, title: 1 };
