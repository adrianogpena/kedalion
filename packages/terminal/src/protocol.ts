import type { ProfileAppearance } from './appearance.ts';
import type { DetectedResult } from './output-scan.ts';

export const TERMINAL_SOCKET_PATH = '/api/terminal/socket';
export const MAX_COLS = 1000;
export const MAX_ROWS = 1000;
export const MAX_CONTROL_BYTES = 64 * 1024;
export const MAX_TITLE = 256;

export const SHELL_IDS = ['auto', 'powershell', 'pwsh', 'cmd', 'git-bash', 'wsl', 'bash', 'zsh', 'fish', 'sh'] as const;
export type ShellId = (typeof SHELL_IDS)[number];

export const isShellId = (x: unknown): x is ShellId => typeof x === 'string' && (SHELL_IDS as readonly string[]).includes(x);

/** Display names of the built-in profiles (one per installed shell). */
export const SHELL_NAMES: Record<Exclude<ShellId, 'auto'>, string> = {
  powershell: 'PowerShell',
  pwsh: 'PowerShell 7',
  cmd: 'Command Prompt',
  'git-bash': 'Git Bash',
  wsl: 'WSL',
  bash: 'bash',
  zsh: 'zsh',
  fish: 'fish',
  sh: 'sh',
};

/** Id of the built-in profile that runs Git Bash with Kedalion's prompt. */
export const KEDALION_PROFILE_ID = 'kedalion';
export const KEDALION_PROFILE_ICON = 'terminal-kedalion';

/** Default icon names of the built-in profiles. */
export const SHELL_ICONS: Record<Exclude<ShellId, 'auto'>, string> = {
  powershell: 'terminal-powershell',
  pwsh: 'terminal-pwsh',
  cmd: 'terminal-cmd',
  'git-bash': 'terminal-git-bash',
  wsl: 'terminal-wsl',
  bash: 'shell-bash',
  zsh: 'shell-zsh',
  fish: 'shell-fish',
  sh: 'shell-bash',
};

/**
 * A terminal profile. Built-ins have a shell id as `id`; a saved entry with that id overrides
 * name, icon, args (appended to the shell's own), env, cwd, hidden, shellIntegration, prompt and appearance.
 * Other ids are custom: `shell: 'custom'` runs `command` (absolute path) with `args`; a known
 * `shell` runs that shell with `args` appended.
 */
export interface TerminalProfile {
  id: string;
  name: string;
  shell: ShellId | 'custom';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  icon?: string;
  hidden?: boolean;
  shellIntegration?: boolean;
  /** `kedalion` draws Kedalion's prompt (needs shell integration); default `shell`, which keeps the shell's own (.bash_profile, .bashrc). */
  prompt?: 'shell' | 'kedalion';
  /** Look of this profile's panes over the global terminal settings. */
  appearance?: ProfileAppearance;
}

/** A profile as `GET /api/terminal/profiles` lists it: built-ins first, then custom ones. */
export interface TerminalProfileInfo extends TerminalProfile {
  /** False when the shell or command is not on this machine. */
  available: boolean;
}

/** `clear` drops the session's scrollback on the server too, so a reattach does not bring it back. */
/** `visible`: whether the user sees this view (tab shown, window focused); a long command notifies only when not. */
export type ClientControl = { type: 'resize'; cols: number; rows: number } | { type: 'close' } | { type: 'clear' } | { type: 'visible'; visible: boolean };

/** A command shell integration reported: its line, folder, start and, once done, end and exit code. */
export interface CommandRecord {
  id: number;
  command: string;
  cwd: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
}

/** A result found in a terminal's output (pull request, app, commit...), with when and the command that printed it. */
export interface ResultRecord extends DetectedResult {
  id: number;
  at: number;
  command?: string;
}

/** An output line a trigger kept. */
export interface CaptureRecord {
  id: number;
  at: number;
  text: string;
  trigger: string;
}

/** One-off alerts on a terminal: its next command finishes, it goes quiet, it prints. */
export interface TerminalAlerts {
  finish: boolean;
  quiet: boolean;
  print: boolean;
}

/** A command of the app-wide history (all terminals, kept across runs). */
export interface HistoryEntry {
  command: string;
  cwd: string;
  at: number;
  durationMs: number | null;
  exitCode: number | null;
  terminal: string;
}

/** A match in a terminal's earlier output (lines that left its scrollback): the line and a few around it. */
export interface EarlierHit {
  line: string;
  before: string[];
  after: string[];
}

export type ServerControl =
  | { type: 'hello'; session: string; cols: number; rows: number }
  | { type: 'exit'; code: number | null }
  | { type: 'title'; title: string }
  | { type: 'command'; record: CommandRecord }
  | { type: 'result'; record: ResultRecord }
  | { type: 'capture'; record: CaptureRecord }
  | { type: 'alerts'; alerts: TerminalAlerts };

export type ClientMessage = { kind: 'input'; data: Uint8Array } | { kind: 'control'; msg: ClientControl };
export type ServerMessage = { kind: 'output'; data: Uint8Array } | { kind: 'control'; msg: ServerControl };

/** A session as `GET /api/terminal/sessions` lists it. */
export interface SessionInfo {
  id: string;
  label: string;
  launcher?: string;
  meta?: Record<string, unknown>;
  /** Start directory, then the last one shell integration reported (OSC 7). */
  cwd: string;
  /** Profile id the session was opened with, if any. */
  profile?: string;
  /** Shell id used (`custom` for a custom command); absent for launchers. */
  shell?: string;
  /** Shell integration (OSC 133): true while a command runs; absent without integration. */
  running?: boolean;
  cols: number;
  rows: number;
  createdAt: number;
  exited: number | null | undefined;
  title: string;
  bells: number;
  lastOutputAt: number;
  viewers: { interactive: boolean; previews: number };
}

type Frame = string | ArrayBuffer | Uint8Array;

export const encodeControl = (msg: ClientControl | ServerControl): string => JSON.stringify(msg);

const isSize = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;

const parseControl = (text: string): Record<string, unknown> | null => {
  if (text.length > MAX_CONTROL_BYTES) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const bytes = (frame: ArrayBuffer | Uint8Array): Uint8Array => (frame instanceof Uint8Array ? frame : new Uint8Array(frame));

export function decodeClientMessage(frame: Frame): ClientMessage | null {
  if (typeof frame !== 'string') return { kind: 'input', data: bytes(frame) };
  const m = parseControl(frame);
  if (!m) return null;
  if (m.type === 'close') return { kind: 'control', msg: { type: 'close' } };
  if (m.type === 'clear') return { kind: 'control', msg: { type: 'clear' } };
  if (m.type === 'visible' && typeof m.visible === 'boolean') return { kind: 'control', msg: { type: 'visible', visible: m.visible } };
  if (m.type === 'resize' && isSize(m.cols, MAX_COLS) && isSize(m.rows, MAX_ROWS)) {
    return { kind: 'control', msg: { type: 'resize', cols: m.cols, rows: m.rows } };
  }
  return null;
}

export function decodeServerMessage(frame: Frame): ServerMessage | null {
  if (typeof frame !== 'string') return { kind: 'output', data: bytes(frame) };
  const m = parseControl(frame);
  if (!m) return null;
  if (m.type === 'hello' && typeof m.session === 'string' && isSize(m.cols, MAX_COLS) && isSize(m.rows, MAX_ROWS)) {
    return { kind: 'control', msg: { type: 'hello', session: m.session, cols: m.cols, rows: m.rows } };
  }
  if (m.type === 'exit' && (m.code === null || (typeof m.code === 'number' && Number.isFinite(m.code)))) {
    return { kind: 'control', msg: { type: 'exit', code: m.code } };
  }
  if (m.type === 'title' && typeof m.title === 'string') {
    return { kind: 'control', msg: { type: 'title', title: m.title.slice(0, MAX_TITLE) } };
  }
  const r = m.record as Record<string, unknown> | undefined;
  const isRec = typeof r === 'object' && r !== null && typeof r.id === 'number';
  if (m.type === 'command' && isRec && typeof r.command === 'string' && typeof r.cwd === 'string' && typeof r.startedAt === 'number') {
    return { kind: 'control', msg: { type: 'command', record: r as unknown as CommandRecord } };
  }
  if (m.type === 'result' && isRec && typeof r.kind === 'string' && typeof r.title === 'string' && typeof r.at === 'number') {
    return { kind: 'control', msg: { type: 'result', record: r as unknown as ResultRecord } };
  }
  if (m.type === 'capture' && isRec && typeof r.text === 'string' && typeof r.trigger === 'string' && typeof r.at === 'number') {
    return { kind: 'control', msg: { type: 'capture', record: r as unknown as CaptureRecord } };
  }
  const a = m.alerts as Record<string, unknown> | undefined;
  if (m.type === 'alerts' && typeof a === 'object' && a !== null && ['finish', 'quiet', 'print'].every((k) => typeof a[k] === 'boolean')) {
    return { kind: 'control', msg: { type: 'alerts', alerts: a as unknown as TerminalAlerts } };
  }
  return null;
}
