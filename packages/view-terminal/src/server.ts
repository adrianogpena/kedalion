import { isAbsolute } from 'node:path';
import { defineServerView, type FieldSpec, isRecord, validGroup } from '@kedalion/server-core';
import {
  isShellId,
  type Launchers,
  terminalRoutes,
  terminalSessions,
  type TerminalSessions,
  validAppearance,
  validSchemes,
  validPromptStyle,
  validTriggers,
  type PromptStyle,
  type ColorScheme,
  type SessionsConfig,
  type TerminalTrigger,
  type ShellId,
  type TerminalProfile,
} from '@kedalion/terminal/server';

/** The part of the server settings the Terminal view owns; the app's `Settings` extends it. */
export interface TerminalServerSettings {
  /** Terminal: the shell new sessions start, plus look and behavior, checked by `validTerminal`. */
  terminal?: {
    shell?: ShellId;
    profiles?: TerminalProfile[];
    schemes?: ColorScheme[];
    triggers?: TerminalTrigger[];
    promptStyle?: PromptStyle;
    [field: string]: string | number | boolean | TerminalProfile[] | ColorScheme[] | TerminalTrigger[] | PromptStyle | undefined;
  };
  /** Layout of the Terminal screen's tabs (`serialize`); the UI validates it on restore. */
  terminalLayout?: unknown;
}

const MAX_TABS_LAYOUT_BYTES = 64 * 1024;
const FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
export const TERMINAL_SPEC: Record<string, FieldSpec> = {
  fontFamily: 'string',
  fontSize: [8, 32],
  cursorStyle: ['block', 'bar', 'underline'],
  cursorBlink: 'boolean',
  scrollback: [100, 100_000],
  copyOnSelect: 'boolean',
  rightClickPaste: 'boolean',
  restoreTabs: 'boolean',
  tabTitle: 'string',
  lineHeight: [1, 2],
  letterSpacing: [0, 10],
  fontWeight: FONT_WEIGHTS,
  fontWeightBold: FONT_WEIGHTS,
  // A preset or custom scheme id; an unknown one follows the app.
  theme: 'string',
  padding: [0, 48],
  scrollbar: ['visible', 'hover', 'hidden'],
  dimUnfocused: [0, 80],
  pasteWarning: ['multiLine', 'large', 'never'],
  pasteLargeSize: [256, 1_000_000],
  trimCopy: 'boolean',
  minimumContrastRatio: [1, 21],
  ligatures: 'boolean',
  gpuAcceleration: ['auto', 'on', 'off'],
  bellStyle: ['tab', 'sound', 'both', 'none'],
  wordSeparators: 'string',
  scrollSensitivity: [1, 10],
  fastScrollSensitivity: [1, 20],
  altIsMeta: 'boolean',
  onExit: ['keep', 'close', 'closeIfClean', 'restart'],
  confirmCloseRunning: 'boolean',
  shellIntegration: 'boolean',
  prompt: ['shell', 'kedalion'],
  commandDecorations: 'boolean',
  defaultCwd: 'string',
  defaultProfile: 'string',
  detectResults: 'boolean',
  pathLinks: 'boolean',
  notifyAfter: [0, 86_400],
  earlierOutput: 'boolean',
};

const MAX_PROFILES = 50;
const PROFILE_KEYS = new Set(['id', 'name', 'shell', 'command', 'args', 'env', 'cwd', 'icon', 'hidden', 'shellIntegration', 'appearance']);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const strUpTo = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const optional = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);

/** A terminal profile with only known keys and bounded strings; a custom one needs an absolute `command`. */
function validProfile(v: unknown): TerminalProfile | null {
  if (!isRecord(v) || !Object.keys(v).every((k) => PROFILE_KEYS.has(k))) return null;
  if (!strUpTo(v.id, 64) || !v.id || !strUpTo(v.name, 80) || !v.name) return null;
  if (v.shell !== 'custom' && !isShellId(v.shell)) return null;
  if (!optional(v.command, (c) => strUpTo(c, 1024) && isAbsolute(c))) return null;
  if (v.shell === 'custom' && !v.command) return null;
  if (!optional(v.args, (a) => Array.isArray(a) && a.length <= 50 && a.every((x) => strUpTo(x, 1024)))) return null;
  const envOk = (e: unknown) =>
    isRecord(e) && Object.keys(e).length <= 50 && Object.entries(e).every(([k, x]) => k.length <= 128 && ENV_KEY.test(k) && strUpTo(x, 4096));
  if (!optional(v.env, envOk)) return null;
  if (!optional(v.cwd, (c) => strUpTo(c, 1024)) || !optional(v.icon, (c) => strUpTo(c, 64))) return null;
  if (!optional(v.hidden, (b) => typeof b === 'boolean') || !optional(v.shellIntegration, (b) => typeof b === 'boolean')) return null;
  if (!optional(v.appearance, (a) => validAppearance(a) !== null)) return null;
  return v as unknown as TerminalProfile;
}

/** Up to MAX_PROFILES valid profiles with distinct ids, else null. */
function validProfiles(raw: unknown): TerminalProfile[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PROFILES) return null;
  const out = raw.map(validProfile);
  if (out.some((p) => !p)) return null;
  return new Set(out.map((p) => p!.id)).size === out.length ? (out as TerminalProfile[]) : null;
}

/** The terminal group: a valid `shell` id plus the fields of `TERMINAL_SPEC`. */
export function validTerminal(raw: unknown): TerminalServerSettings['terminal'] | null {
  if (!isRecord(raw)) return null;
  const { shell, profiles, schemes, triggers, promptStyle, ...rest } = raw;
  if (shell !== undefined && !isShellId(shell)) return null;
  const validated = profiles === undefined ? undefined : validProfiles(profiles);
  if (validated === null) return null;
  const validSchemeList = schemes === undefined ? undefined : validSchemes(schemes);
  if (validSchemeList === null) return null;
  const validTriggerList = triggers === undefined ? undefined : validTriggers(triggers);
  if (validTriggerList === null) return null;
  const validStyle = promptStyle === undefined ? undefined : validPromptStyle(promptStyle);
  if (validStyle === null) return null;
  if (typeof rest.theme === 'string' && !/^[\w.-]{1,64}$/.test(rest.theme)) return null;
  const fields: NonNullable<TerminalServerSettings['terminal']> | null = validGroup(rest, TERMINAL_SPEC);
  if (!fields) return null;
  if (validated) fields.profiles = validated;
  if (validSchemeList) fields.schemes = validSchemeList;
  if (validTriggerList) fields.triggers = validTriggerList;
  if (validStyle) fields.promptStyle = validStyle;
  return shell === undefined ? fields : { ...fields, shell };
}

/** What the session store reads from the settings: triggers, result detection, long-command notices, earlier output. */
export function terminalSessionsConfig(settings: TerminalServerSettings): SessionsConfig {
  const t = settings.terminal ?? {};
  return {
    triggers: t.triggers,
    detectResults: t.detectResults !== false,
    notifyAfter: typeof t.notifyAfter === 'number' ? t.notifyAfter : 30,
    earlierOutput: t.earlierOutput !== false,
  };
}

const validLayout = (raw: unknown) =>
  typeof raw === 'object' && raw !== null && JSON.stringify(raw).length < MAX_TABS_LAYOUT_BYTES ? raw : null;

export interface TerminalServerViewOptions {
  /** Where the shell-integration scripts are written. */
  integrationDir: string;
  /** Absolute folder of a project-relative path (`cwd` of a tab). */
  resolveCwd(root: string, path: string): Promise<string>;
  /** Extra programs the client may start by id (see `launchers`), e.g. the Agents view's `claude`. */
  launchers?: Launchers;
  /** The session store; pass one to read the sessions elsewhere (the Agents view reads their screens). */
  sessions?: TerminalSessions;
}

/** Server half of the Terminal view: routes, sockets, session cleanup and the `terminal` settings groups. */
export function terminalServerView({ integrationDir, resolveCwd, launchers, sessions = terminalSessions() }: TerminalServerViewOptions) {
  /** Shells of every Terminal tab; they outlive the window's sockets and end at app quit. */
  let mounted: ReturnType<typeof terminalRoutes> | undefined;
  const mount = (ctx: { settings: { load(): Promise<TerminalServerSettings> } }) => {
    const setting = async (key: string) => (await ctx.settings.load()).terminal?.[key];
    return (mounted ??= terminalRoutes({
      sessions,
      shell: async () => (await ctx.settings.load()).terminal?.shell ?? 'auto',
      profiles: async () => (await ctx.settings.load()).terminal?.profiles ?? [],
      defaultProfile: async () => {
        const v = await setting('defaultProfile');
        return typeof v === 'string' ? v : '';
      },
      defaultCwd: async () => {
        const v = await setting('defaultCwd');
        return typeof v === 'string' ? v : '';
      },
      shellIntegration: async () => (await setting('shellIntegration')) !== false,
      prompt: async () => ((await setting('prompt')) === 'kedalion' ? 'kedalion' : 'shell'),
      promptStyle: async () => validPromptStyle((await ctx.settings.load()).terminal?.promptStyle) ?? undefined,
      integrationDir,
      resolveCwd,
      launchers,
    }));
  };
  return defineServerView<TerminalServerSettings>({
    id: 'terminal',
    icon: 'terminal',
    routes: (ctx) => mount(ctx).routes,
    sockets: (ctx) => mount(ctx).sockets,
    onQuit: () => sessions.closeAll(),
    settings: { validate: { terminal: validTerminal, terminalLayout: validLayout }, spec: TERMINAL_SPEC },
  });
}
