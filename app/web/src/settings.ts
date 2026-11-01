import {
  AUTO_SAVE,
  fileBoolSetting,
  fileEnumSetting,
  type SectionPath,
  bool,
  createSettingsRegistry,
  DEFAULT_LINK_SETTINGS,
  type LinkTarget,
  gitSettingDefs,
  groupField as uiGroupField,
  num,
  oneOf,
  str,
  registerDefaultSections,
} from '@kedalion/ui';
import type { AppearanceSettings, EditorSettings, GeneralSettings, KeyboardSettings, Settings, WindowSettings } from './api';

export const settingsRegistry = createSettingsRegistry<Settings>();
registerDefaultSections(settingsRegistry);
settingsRegistry.registerSection({ path: ['general', 'links'], order: 10, label: 'settings.section.general.links' });

/** Default of a registered setting. */
export const settingDefault = <V = unknown>(id: string): V => settingsRegistry.setting(id)!.default as V;

/** Defaults of the settings `<prefix>.<key>` as `{ key: default }`. */
export const settingDefaults = <O>(prefix: string): O =>
  Object.fromEntries(
    settingsRegistry
      .settings()
      .filter((s) => s.id.startsWith(`${prefix}.`))
      .map((s) => [s.id.slice(prefix.length + 1), s.default]),
  ) as O;

const general: SectionPath = ['general'];
const editor: SectionPath = ['editor'];

type Group = 'appearance' | 'editor' | 'window' | 'general' | 'keyboard' | 'links';

const linksSection: SectionPath = ['general', 'links'];

const groupField = (group: Group, key: string, order: number, def: Parameters<typeof uiGroupField>[3], section?: SectionPath) => uiGroupField<Settings, Group>(group, key, order, def, section);

const MONO_FONT = "'Geist Mono','Cascadia Code',Consolas,monospace";


settingsRegistry.registerSettings([
  groupField('appearance', 'uiFontFamily', 100, str("'Geist', 'Segoe UI', system-ui, sans-serif")),
  groupField('appearance', 'editorFontFamily', 110, str(MONO_FONT)),
  groupField('appearance', 'editorFontSize', 120, num(12.5, 8, 32)),
  groupField('appearance', 'editorLineHeight', 130, num(1.55, 1, 3)),
  groupField('appearance', 'editorLigatures', 140, bool(false)),
  groupField('appearance', 'reduceMotion', 150, bool(false)),

  groupField('editor', 'tabSize', 100, num(4, 1, 8)),
  groupField('editor', 'insertSpaces', 110, bool(true)),
  groupField('editor', 'wordWrap', 120, bool(true)),
  groupField('editor', 'lineNumbers', 130, bool(true)),
  groupField('editor', 'highlightActiveLine', 140, bool(true)),
  groupField('editor', 'renderWhitespace', 150, oneOf('none', ['none', 'selection', 'all'])),
  groupField('editor', 'bracketMatching', 160, bool(true)),
  groupField('editor', 'autoCloseBrackets', 170, bool(true)),
  groupField('editor', 'cursorStyle', 180, oneOf('line', ['line', 'block', 'underline'])),
  groupField('editor', 'cursorBlink', 190, bool(true)),

  groupField('window', 'sidebarSide', 100, oneOf('left', ['left', 'right'])),
  groupField('window', 'statusBar', 110, bool(true)),
  groupField('window', 'tabSizing', 120, oneOf('fit', ['fit', 'shrink'])),
  groupField('window', 'tabCloseButton', 130, oneOf('right', ['right', 'left', 'hidden'])),
  groupField('window', 'tabIcons', 140, bool(true)),

  groupField('general', 'confirmCloseDirty', 100, bool(true)),
  groupField('general', 'toastDuration', 110, num(4000, 1000, 60_000)),
  groupField('general', 'browser', 115, str('')),

  groupField('keyboard', 'chordTimeout', 100, num(1500, 500, 10_000)),

  groupField('links', 'openIn', 100, oneOf(DEFAULT_LINK_SETTINGS.openIn, ['internal', 'external']), linksSection),
  {
    id: 'links.scopes',
    kind: 'custom',
    section: linksSection,
    order: 110,
    label: 'settings.links.scopes',
    description: 'settings.links.scopes.hint',
    default: DEFAULT_LINK_SETTINGS.scopes,
    get: (s) => s.links?.scopes ?? DEFAULT_LINK_SETTINGS.scopes,
    set: (s, scopes) => ({ links: { ...s.links, scopes: scopes as Record<string, LinkTarget> } }),
  },

  ...gitSettingDefs,


  {
    id: 'general.autostart',
    kind: 'boolean',
    section: general,
    order: 10,
    label: 'settings.autostart',
    description: 'settings.autostart.hint',
    default: false,
    get: (s) => s.autostart,
    set: (_, autostart) => ({ autostart }),
  },
  {
    id: 'general.closeToTray',
    kind: 'boolean',
    section: general,
    order: 20,
    label: 'settings.closeToTray',
    description: 'settings.closeToTray.hint',
    default: false,
    get: (s) => s.closeToTray,
    set: (_, closeToTray) => ({ closeToTray }),
  },
  {
    id: 'general.port',
    kind: 'number',
    section: general,
    order: 25,
    label: 'settings.port',
    description: 'settings.port.hint',
    default: 0,
    min: 0,
    max: 65535,
    get: (s) => s.port ?? 0,
    set: (_, port) => ({ port }),
  },
  {
    id: 'general.rememberSettingsPage',
    kind: 'boolean',
    section: general,
    order: 30,
    label: 'settings.rememberPage',
    description: 'settings.rememberPage.hint',
    default: true,
    get: (s) => s.rememberSettingsPage ?? true,
    set: (_, rememberSettingsPage) => ({ rememberSettingsPage }),
  },

  fileEnumSetting('autoSave', editor, 10, 'settings.explorer.autoSave', AUTO_SAVE),
  fileBoolSetting('trimTrailingWhitespace', editor, 20, 'settings.explorer.trim'),
  fileBoolSetting('insertFinalNewline', editor, 30, 'settings.explorer.finalNewline'),
]);

/** The appearance settings with their defaults filled in. */
export const appearanceSettingsOf = (s: Settings): Required<AppearanceSettings> => ({ ...settingDefaults<Required<AppearanceSettings>>('appearance'), ...s.appearance });

/** The editor settings with their defaults filled in. */
export const editorSettingsOf = (s: Settings): Required<EditorSettings> => ({ ...settingDefaults<Required<EditorSettings>>('editor'), ...s.editor });

/** The window settings with their defaults filled in. */
export const windowSettingsOf = (s: Settings): Required<WindowSettings> => ({ ...settingDefaults<Required<WindowSettings>>('window'), ...s.window });

/** The keyboard settings with their defaults filled in. */
export const keyboardSettingsOf = (s: Settings): Required<KeyboardSettings> => ({ ...settingDefaults<Required<KeyboardSettings>>('keyboard'), ...s.keyboard });

/** The link routing settings with their defaults filled in. */
export const linkSettingsOf = (s: Settings): { openIn: LinkTarget; scopes: Record<string, LinkTarget> } => ({
  openIn: s.links?.openIn ?? settingDefault<LinkTarget>('links.openIn'),
  scopes: s.links?.scopes ?? settingDefault<Record<string, LinkTarget>>('links.scopes'),
});

/** The settings stored in `general` (autostart and the other top-level ones are not) with their defaults filled in. */
export const generalSettingsOf = (s: Settings): Required<GeneralSettings> => ({
  confirmCloseDirty: s.general?.confirmCloseDirty ?? settingDefault<boolean>('general.confirmCloseDirty'),
  toastDuration: s.general?.toastDuration ?? settingDefault<number>('general.toastDuration'),
  startScreen: s.general?.startScreen ?? settingDefault<string>('general.startScreen'),
  browser: s.general?.browser ?? settingDefault<string>('general.browser'),
});
