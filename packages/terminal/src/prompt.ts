/**
 * Kedalion's prompt (`terminal.prompt = kedalion`): an ordered list of segments with a color each, plus the symbol.
 * The server sends it to the shell scripts as a compact spec (`promptSpec`); the Settings preview renders the
 * same segments with sample values (`promptPreview`). Pure, shared by the server and the web UI.
 */

export const PROMPT_SEGMENT_KINDS = ['cwd', 'folder', 'branch', 'gitstatus', 'user', 'host', 'os', 'shell', 'date', 'time', 'duration', 'jobs', 'venv', 'node', 'java', 'status', 'newline', 'symbol'] as const;
export type PromptSegmentKind = (typeof PROMPT_SEGMENT_KINDS)[number];

/** The 16 ANSI colors plus `default` (the terminal's foreground); drawn with the terminal theme's palette. */
export const PROMPT_COLORS = [
  'default',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;
export type PromptColor = (typeof PROMPT_COLORS)[number];

export interface PromptSegment {
  /** A built-in kind, or `custom`: the output of the bash function `prompt_<name>` from `customs`. */
  kind: PromptSegmentKind | 'custom';
  /** `custom` only: the function's name without the `prompt_` prefix. */
  name?: string;
  color?: PromptColor;
  bold?: boolean;
  /** `symbol` only: its color after a failed command. */
  errorColor?: PromptColor;
}

/** A custom segment's bash code: the body of `prompt_<name>() { ... }`; what it prints is shown, nothing hides it. */
export interface PromptCustom {
  name: string;
  script: string;
}

export interface PromptStyle {
  segments: PromptSegment[];
  /** Text of the `symbol` segment, 1 to 8 characters. */
  symbol: string;
  /** Custom segment functions, kept even while no segment uses them. */
  customs?: PromptCustom[];
}

export const MAX_PROMPT_SEGMENTS = 24;
export const MAX_PROMPT_SYMBOL = 8;
export const MAX_PROMPT_CUSTOMS = 10;
export const MAX_PROMPT_SCRIPT = 4000;
/** A custom segment name: what follows `prompt_` in the function name. */
export const PROMPT_CUSTOM_NAME = /^[a-z][a-z0-9_]{0,23}$/;

export const DEFAULT_PROMPT_STYLE: PromptStyle = {
  segments: [
    { kind: 'cwd', color: 'cyan' },
    { kind: 'branch', color: 'magenta' },
    { kind: 'status', color: 'red' },
    { kind: 'symbol', color: 'green', errorColor: 'red' },
  ],
  symbol: '$',
};

const isColor = (v: unknown): v is PromptColor => typeof v === 'string' && (PROMPT_COLORS as readonly string[]).includes(v);
const isKind = (v: unknown): v is PromptSegmentKind => typeof v === 'string' && (PROMPT_SEGMENT_KINDS as readonly string[]).includes(v);

/**
 * A valid style (unknown keys dropped), else null: known kinds and colors, at most one of each kind but `newline`,
 * custom segments naming a function of `customs` (distinct names that are not built-in kinds).
 */
export function validPromptStyle(raw: unknown): PromptStyle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { segments, symbol, customs } = raw as Record<string, unknown>;
  const fns: PromptCustom[] = [];
  if (customs !== undefined) {
    if (!Array.isArray(customs) || customs.length > MAX_PROMPT_CUSTOMS) return null;
    for (const c of customs) {
      if (!c || typeof c !== 'object') return null;
      const { name, script } = c as Record<string, unknown>;
      if (typeof name !== 'string' || !PROMPT_CUSTOM_NAME.test(name) || isKind(name) || fns.some((f) => f.name === name)) return null;
      if (typeof script !== 'string' || script.length > MAX_PROMPT_SCRIPT || script.includes(String.fromCharCode(0))) return null;
      fns.push({ name, script });
    }
  }
  if (!Array.isArray(segments) || segments.length > MAX_PROMPT_SEGMENTS) return null;
  if (typeof symbol !== 'string' || !symbol.trim() || [...symbol].length > MAX_PROMPT_SYMBOL || /[\x00-\x1f\x7f]/.test(symbol)) return null;
  const out: PromptSegment[] = [];
  const seen = new Set<string>();
  for (const s of segments) {
    if (!s || typeof s !== 'object') return null;
    const { kind, name, color, bold, errorColor } = s as Record<string, unknown>;
    if (kind === 'custom') {
      if (typeof name !== 'string' || !fns.some((f) => f.name === name)) return null;
    } else if (!isKind(kind)) return null;
    const key = kind === 'custom' ? `custom:${name as string}` : kind;
    if (kind !== 'newline' && seen.has(key)) return null;
    seen.add(key);
    if (color !== undefined && !isColor(color)) return null;
    if (errorColor !== undefined && !isColor(errorColor)) return null;
    if (bold !== undefined && typeof bold !== 'boolean') return null;
    const seg: PromptSegment = kind === 'custom' ? { kind, name: name as string } : { kind };
    if (color !== undefined) seg.color = color;
    if (bold) seg.bold = true;
    if (kind === 'symbol' && errorColor !== undefined) seg.errorColor = errorColor;
    out.push(seg);
  }
  return fns.length ? { segments: out, symbol, customs: fns } : { segments: out, symbol };
}

const SGR: Record<PromptColor, number> = {
  default: 39,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

const sgr = (color: PromptColor | undefined, bold: boolean | undefined) => (bold ? `1;${SGR[color ?? 'default']}` : String(SGR[color ?? 'default']));

/**
 * The `KEDALION_PROMPT` value the scripts read: space-separated `kind:sgr` tokens (`symbol:sgr:errorSgr`,
 * `custom:sgr:name`, `newline` alone), e.g. `cwd:36 branch:35 status:31 symbol:32:31`. The symbol text goes in `KEDALION_PROMPT_SYMBOL`.
 */
export function promptSpec(style: PromptStyle): string {
  return style.segments
    .map((s) => {
      if (s.kind === 'newline') return 'newline';
      const base = `${s.kind}:${sgr(s.color, s.bold)}`;
      if (s.kind === 'custom') return `${base}:${s.name}`;
      return s.kind === 'symbol' ? `${base}:${sgr(s.errorColor ?? s.color, s.bold)}` : base;
    })
    .join(' ');
}

/** Sample values the preview shows for each segment. */
export interface PromptSample {
  cwd: string;
  folder: string;
  branch: string;
  user: string;
  host: string;
  time: string;
  gitstatus: string;
  os: string;
  shell: string;
  date: string;
  duration: string;
  jobs: string;
  venv: string;
  node: string;
  java: string;
  /** Exit code of the last command; 0 = success. */
  status: number;
}

export interface PromptSpan {
  text: string;
  color: PromptColor;
  bold?: boolean;
}

/**
 * The prompt as the scripts draw it, one array of spans per line: segments joined by one space, an empty
 * branch or a zero status left out with its space, a space at the end.
 */
export function promptPreview(style: PromptStyle, sample: PromptSample): PromptSpan[][] {
  const lines: PromptSpan[][] = [[]];
  for (const s of style.segments) {
    const line = lines[lines.length - 1]!;
    if (s.kind === 'newline') {
      lines.push([]);
      continue;
    }
    let text: string;
    let color = s.color ?? 'default';
    switch (s.kind) {
      case 'status':
        text = sample.status ? String(sample.status) : '';
        break;
      case 'symbol':
        text = style.symbol;
        if (sample.status) color = s.errorColor ?? color;
        break;
      case 'custom':
        // The function runs in the shell; the preview shows its name.
        text = `‹${s.name ?? ''}›`;
        break;
      default:
        text = sample[s.kind];
    }
    if (!text) continue;
    if (line.length) line.push({ text: ' ', color: 'default' });
    line.push(s.bold ? { text, color, bold: true } : { text, color });
  }
  lines[lines.length - 1]!.push({ text: ' ', color: 'default' });
  return lines;
}
