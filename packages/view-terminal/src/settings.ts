import { DEFAULT_WORD_SEPARATORS, TERMINAL_THEMES, type ColorScheme } from '@kedalion/terminal/options';
import type { TerminalProfile } from '@kedalion/terminal/protocol';
import { DEFAULT_PROMPT_STYLE, type PromptStyle, type TerminalTrigger } from '@kedalion/terminal';
import { bool, type FieldDef, groupField, num, oneOf, type SettingDef, settingDefaultsOf, str } from '@kedalion/ui';

export type TerminalFontWeight = 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface TerminalSettings {
  fontFamily?: string;
  /** Pixels, 8 to 32. */
  fontSize?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorBlink?: boolean;
  /** Lines kept, 100 to 100 000. */
  scrollback?: number;
  copyOnSelect?: boolean;
  rightClickPaste?: boolean;
  restoreTabs?: boolean;
  tabTitle?: string;
  /** 1 to 2. */
  lineHeight?: number;
  /** Pixels, 0 to 10. */
  letterSpacing?: number;
  fontWeight?: TerminalFontWeight;
  fontWeightBold?: TerminalFontWeight;
  /** A preset id ('app', 'dark-plus', ...) or a `schemes` id; an unknown one follows the app. */
  theme?: string;
  /** Custom color schemes (at most 100). */
  schemes?: ColorScheme[];
  /** Pixels, 0 to 48. */
  padding?: number;
  scrollbar?: 'visible' | 'hover' | 'hidden';
  /** Percent, 0 to 80. */
  dimUnfocused?: number;
  pasteWarning?: 'multiLine' | 'large' | 'never';
  /** Characters, 256 to 1 000 000. */
  pasteLargeSize?: number;
  trimCopy?: boolean;
  /** 1 to 21. */
  minimumContrastRatio?: number;
  ligatures?: boolean;
  gpuAcceleration?: 'auto' | 'on' | 'off';
  bellStyle?: 'tab' | 'sound' | 'both' | 'none';
  wordSeparators?: string;
  /** 1 to 10. */
  scrollSensitivity?: number;
  /** 1 to 20. */
  fastScrollSensitivity?: number;
  altIsMeta?: boolean;
  onExit?: 'keep' | 'close' | 'closeIfClean' | 'restart';
  confirmCloseRunning?: boolean;
  /** OSC 133/OSC 7 scripts injected into supported shells; default true. */
  shellIntegration?: boolean;
  /** Retired: the prompt is now per profile (the built-in Kedalion profile uses Kedalion's). */
  prompt?: 'shell' | 'kedalion';
  /** Segments, colors and symbol of Kedalion's prompt; default `DEFAULT_PROMPT_STYLE`. */
  promptStyle?: PromptStyle;
  commandDecorations?: boolean;
  /** Start directory when the tab and profile give none; `~` = home. */
  defaultCwd?: string;
  /** Profile id for new tabs; unset = Kedalion, '' = the `shell` setting. Set by the Shell select. */
  defaultProfile?: string;
  /** Overrides of built-in profiles (shell id as `id`) and custom profiles. */
  profiles?: TerminalProfile[];
  /** Regular expressions over output lines: highlight, capture or notify (at most 50). */
  triggers?: TerminalTrigger[];
  /** Pull requests, issues, local apps, commits and pushes in output go to the session panel; default true. */
  detectResults?: boolean;
  /** File paths and commit hashes on screen open in the Explorer and Git views; default true. */
  pathLinks?: boolean;
  /** Seconds a command runs before its end is notified when the terminal is not in view; 0 never; default 30. */
  notifyAfter?: number;
  /** Lines that leave the scrollback are kept for the find bar; default true. */
  earlierOutput?: boolean;
}

/** The part of the app settings the Terminal view reads and writes; the app's `Settings` extends it. */
export interface TerminalViewSettings {
  /** The shell id new sessions start (`'auto'` when omitted); the server validates it. */
  terminal?: TerminalSettings & { shell?: string };
  /** Layout of the Terminal screen's tabs (`serialize`); validated on restore. */
  terminalLayout?: unknown;
  general?: { confirmCloseDirty?: boolean };
}

const FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const MONO_FONT = "'Geist Mono','Cascadia Code',Consolas,monospace";
// Geist Mono has no ligatures, so with ligatures on the default stack leads with fonts that do.
const LIGATURE_FONT = "'Cascadia Code','JetBrains Mono','Fira Code',Consolas,monospace";

const field = (key: string, order: number, def: FieldDef, section: string): SettingDef<TerminalViewSettings> =>
  groupField<TerminalViewSettings, 'terminal'>('terminal', key, order, def, ['terminal', section]);

export const terminalSettingDefs: SettingDef<TerminalViewSettings>[] = [
  field('fontFamily', 100, str(MONO_FONT), 'appearance'),
  field('fontSize', 110, num(13, 8, 32), 'appearance'),
  field('cursorStyle', 120, oneOf('block', ['block', 'bar', 'underline']), 'appearance'),
  field('cursorBlink', 130, bool(true), 'appearance'),
  field('scrollback', 140, num(5000, 100, 100_000), 'behavior'),
  field('copyOnSelect', 150, bool(false), 'behavior'),
  field('rightClickPaste', 160, bool(false), 'behavior'),
  field('lineHeight', 170, num(1, 1, 2), 'appearance'),
  field('letterSpacing', 180, num(0, 0, 10), 'appearance'),
  field('fontWeight', 190, oneOf('normal', FONT_WEIGHTS), 'appearance'),
  field('fontWeightBold', 200, oneOf('bold', FONT_WEIGHTS), 'appearance'),
  field('ligatures', 210, bool(false), 'appearance'),
  field('theme', 220, oneOf('app', TERMINAL_THEMES), 'appearance'),
  field('minimumContrastRatio', 230, num(1, 1, 21), 'appearance'),
  field('gpuAcceleration', 240, oneOf('auto', ['auto', 'on', 'off']), 'appearance'),
  field('padding', 250, num(8, 0, 48), 'appearance'),
  field('scrollbar', 260, oneOf('visible', ['visible', 'hover', 'hidden']), 'appearance'),
  field('dimUnfocused', 270, num(0, 0, 80), 'appearance'),
  { id: 'terminal.schemes', kind: 'custom', section: ['terminal', 'appearance'], order: 280, label: 'settings.terminal.schemes', description: 'settings.terminal.schemes.hint', default: [] as ColorScheme[], get: (s) => s.terminal?.schemes ?? [], set: (s, v) => ({ terminal: { ...s.terminal, schemes: v as ColorScheme[] } }) },
  field('wordSeparators', 300, str(DEFAULT_WORD_SEPARATORS), 'behavior'),
  field('scrollSensitivity', 310, num(1, 1, 10), 'behavior'),
  field('fastScrollSensitivity', 320, num(5, 1, 20), 'behavior'),
  field('altIsMeta', 330, bool(false), 'behavior'),
  field('pasteWarning', 335, oneOf('multiLine', ['multiLine', 'large', 'never']), 'behavior'),
  field('pasteLargeSize', 336, num(5120, 256, 1_000_000), 'behavior'),
  field('trimCopy', 337, bool(true), 'behavior'),
  field('bellStyle', 340, oneOf('tab', ['tab', 'sound', 'both', 'none']), 'tabs'),
  field('restoreTabs', 400, bool(true), 'tabs'),
  field('tabTitle', 410, str('{name}'), 'tabs'),
  field('defaultCwd', 430, str(''), 'profiles'),
  field('onExit', 440, oneOf('keep', ['keep', 'close', 'closeIfClean', 'restart']), 'tabs'),
  field('confirmCloseRunning', 450, bool(true), 'tabs'),
  field('detectResults', 700, bool(true), 'output'),
  field('pathLinks', 710, bool(true), 'output'),
  field('notifyAfter', 720, num(30, 0, 86_400), 'output'),
  field('earlierOutput', 730, bool(true), 'output'),
  { id: 'terminal.triggers', kind: 'custom', section: ['terminal', 'output'], order: 740, label: 'settings.terminal.triggers', description: 'settings.terminal.triggers.hint', default: [] as TerminalTrigger[], get: (s) => s.terminal?.triggers ?? [], set: (s, v) => ({ terminal: { ...s.terminal, triggers: v as TerminalTrigger[] } }) },
  field('shellIntegration', 500, bool(true), 'profiles'),
  { id: 'terminal.promptStyle', kind: 'custom', section: ['terminal', 'prompt'], order: 506, label: 'settings.terminal.promptStyle', description: 'settings.terminal.promptStyle.hint', default: DEFAULT_PROMPT_STYLE, get: (s) => s.terminal?.promptStyle ?? DEFAULT_PROMPT_STYLE, set: (s, v) => ({ terminal: { ...s.terminal, promptStyle: v as PromptStyle } }) },
  field('commandDecorations', 510, bool(true), 'profiles'),
  { id: 'terminal.profiles', kind: 'custom', section: ['terminal', 'profiles'], order: 600, label: 'settings.terminal.profiles', description: 'settings.terminal.profiles.hint', default: [] as TerminalProfile[], get: (s) => s.terminal?.profiles ?? [], set: (s, v) => ({ terminal: { ...s.terminal, profiles: v as TerminalProfile[] } }) },
];

const defaults = settingDefaultsOf(terminalSettingDefs, 'terminal') as Required<TerminalSettings>;

/** Default of the setting `terminal.<key>`. */
export const terminalDefault = <V = unknown>(key: string): V => (defaults as Record<string, unknown>)[key] as V;

/** The terminal look and behavior settings (not the shell) with their defaults filled in. */
export const terminalSettingsOf = (s: TerminalViewSettings): Required<TerminalSettings> => {
  const { shell: _shell, ...fields } = s.terminal ?? {};
  const merged = { ...defaults, ...fields, defaultProfile: fields.defaultProfile ?? 'kedalion' };
  if (merged.ligatures && merged.fontFamily === MONO_FONT) merged.fontFamily = LIGATURE_FONT;
  return merged;
};
