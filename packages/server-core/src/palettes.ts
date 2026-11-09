// Colour palettes: values for every colour token of packages/ui/src/styles.css. Pure module,
// shared by the server (settings validation) and the web UI (applies the tokens).

import type { LayoutsSetting } from './layouts.ts';

export type ThemeKind = 'dark' | 'light';
export type ThemePreference = 'system' | ThemeKind;

export interface ThemeSettings {
  theme: ThemePreference;
  /** Palette id used when the effective theme is dark; unset means the default (or the light pick's family). */
  paletteDark?: string;
  paletteLight?: string;
  /** Zoom of the app window, one of `ZOOM_LEVELS`; unset means 1. */
  zoom?: number;
  /** Layout id from LAYOUTS; unset means DEFAULT_LAYOUT. */
  layout?: string;
  /** Icon-set id from ICON_SET_IDS; unset means the layout's own set. */
  icons?: string;
  /** Icons of the view entries in the Navigation: unset uses the icon set, 'mythology' the view icons of docs/ICONS.md. */
  navIcons?: '' | 'mythology' | 'forge';
  /** Main menu style for layouts with a labelled menu; unset means 'labels'. */
  mainMenu?: 'labels' | 'icons';
  /** Side of the main menu dock; unset means the layout's own. */
  dock?: 'left' | 'right';
  /** Per-view layouts, Navigation and Look; unset migrates from `layout`/`mainMenu`/`dock` (see effectiveLayouts). */
  layouts?: LayoutsSetting;
}

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const TOKENS = [
  '--bg', '--bg-elev', '--bg-sunken', '--panel', '--panel-2', '--hover', '--selected', '--side-active',
  '--border', '--border-soft', '--row-border', '--keycap',
  '--text', '--text-2', '--text-3',
  '--accent', '--accent-2', '--accent-soft', '--ink-on-accent',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--err', '--err-soft', '--ink-on-err',
  '--info', '--info-soft', '--debug', '--debug-soft', '--muted-soft',
  '--y-key', '--y-str', '--y-num', '--y-bool', '--y-comment', '--mark',
  '--shadow', '--backdrop',
] as const;

export type Token = (typeof TOKENS)[number];

export interface Palette {
  id: string;
  label: string;
  /** Palettes of one family are the dark and light take on the same scheme. */
  family: string;
  kind: ThemeKind;
  /** `--shadow` is a box-shadow value, every other token a colour. */
  tokens: Record<Token, string>;
}

export const DEFAULT_DARK = 'transit-dark';
export const DEFAULT_LIGHT = 'transit-light';

const KEDALION_DARK: Record<Token, string> = {
  '--bg': '#0d0e11',
  '--bg-elev': '#121317',
  '--bg-sunken': '#0a0b0d',
  '--panel': '#121317',
  '--panel-2': '#16181d',
  '--hover': '#1c1f25',
  '--selected': '#1a1830',
  '--side-active': '#1f1c33',
  '--border': '#262a32',
  '--border-soft': '#1d2027',
  '--row-border': '#1a1d23',
  '--keycap': '#363b45',
  '--text': '#eceef2',
  '--text-2': '#a6acb7',
  '--text-3': '#6c727d',
  '--accent': '#9b8cff',
  '--accent-2': '#c3b9ff',
  '--accent-soft': 'rgba(155, 140, 255, 0.14)',
  '--ink-on-accent': '#120d2b',
  '--ok': '#3ddc97',
  '--ok-soft': 'rgba(61, 220, 151, 0.12)',
  '--warn': '#f5b83d',
  '--warn-soft': 'rgba(245, 184, 61, 0.13)',
  '--err': '#ff6b6b',
  '--err-soft': 'rgba(255, 107, 107, 0.13)',
  '--ink-on-err': '#fff',
  '--info': '#5fb4ff',
  '--info-soft': 'rgba(95, 180, 255, 0.13)',
  '--debug': '#8b93a1',
  '--debug-soft': 'rgba(139, 147, 161, 0.14)',
  '--muted-soft': 'rgba(148, 163, 184, 0.12)',
  '--y-key': '#7cc4ff',
  '--y-str': '#9ee6c0',
  '--y-num': '#fcd34d',
  '--y-bool': '#f0abfc',
  '--y-comment': '#5b6370',
  '--mark': 'rgba(245, 184, 61, 0.35)',
  '--shadow': '0 30px 80px rgba(0, 0, 0, 0.6)',
  '--backdrop': 'rgba(3, 7, 12, 0.55)',
};

const KEDALION_LIGHT: Record<Token, string> = {
  '--bg': '#f4f6f9',
  '--bg-elev': '#ffffff',
  '--bg-sunken': '#eef1f5',
  '--panel': '#ffffff',
  '--panel-2': '#f7f9fb',
  '--hover': '#eef3f8',
  '--selected': '#ece8fd',
  '--side-active': 'rgba(106, 79, 216, 0.1)',
  '--border': '#d7dee7',
  '--border-soft': '#e6ebf1',
  '--row-border': '#e6ebf1',
  '--keycap': '#c9d2dc',
  '--text': '#17212c',
  '--text-2': '#4b5b6c',
  '--text-3': '#7c8a99',
  '--accent': '#6a4fd8',
  '--accent-2': '#5638c4',
  '--accent-soft': 'rgba(106, 79, 216, 0.1)',
  '--ink-on-accent': '#ffffff',
  '--ok': '#059669',
  '--ok-soft': 'rgba(5, 150, 105, 0.1)',
  '--warn': '#b45309',
  '--warn-soft': 'rgba(217, 119, 6, 0.12)',
  '--err': '#dc2626',
  '--err-soft': 'rgba(220, 38, 38, 0.1)',
  '--ink-on-err': '#fff',
  '--info': '#2563eb',
  '--info-soft': 'rgba(37, 99, 235, 0.1)',
  '--debug': '#64748b',
  '--debug-soft': 'rgba(100, 116, 139, 0.12)',
  '--muted-soft': 'rgba(100, 116, 139, 0.1)',
  '--y-key': '#0369a1',
  '--y-str': '#047857',
  '--y-num': '#b45309',
  '--y-bool': '#a21caf',
  '--y-comment': '#94a3b8',
  '--mark': 'rgba(251, 191, 36, 0.45)',
  '--shadow': '0 20px 50px rgba(15, 23, 42, 0.18)',
  '--backdrop': 'rgba(15, 23, 42, 0.35)',
};

/** The 12 role colours of a session-deck palette, in this order. */
type Roles = [
  bg: number, surface: number, border: number, text: number, textDim: number, accent: number,
  purple: number, cyan: number, green: number, yellow: number, orange: number, red: number,
];

type Rgb = [number, number, number];

const rgb = (hex: number): Rgb => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
/** Per-channel blend of the sRGB values, like CSS `color-mix(in srgb, a, b t)`. */
const mix = (a: Rgb, b: Rgb, t: number) => hex(a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)) as Rgb);
const alpha = (c: Rgb, a: number) => `rgba(${c.join(', ')}, ${a})`;

const BLACK: Rgb = [0, 0, 0];

/** Tokens of a session-deck palette, derived from its role colours. */
function fromRoles(kind: ThemeKind, roles: Roles): Record<Token, string> {
  const [bg, surface, border, text, textDim, accent, purple, cyan, green, yellow, orange, red] = roles.map(rgb);
  const base = kind === 'dark' ? KEDALION_DARK : KEDALION_LIGHT;
  return {
    '--bg': hex(bg),
    '--bg-elev': mix(bg, surface, 0.5),
    '--bg-sunken': kind === 'dark' ? mix(bg, BLACK, 0.2) : mix(bg, border, 0.15),
    '--panel': mix(bg, surface, 0.5),
    '--panel-2': hex(surface),
    '--hover': mix(surface, text, 0.06),
    '--selected': mix(bg, accent, 0.16),
    '--side-active': mix(bg, accent, 0.2),
    '--border': hex(border),
    '--border-soft': mix(border, bg, 0.45),
    '--row-border': mix(border, bg, 0.6),
    '--keycap': hex(border),
    '--text': hex(text),
    '--text-2': mix(text, textDim, 0.5),
    '--text-3': hex(textDim),
    '--accent': hex(accent),
    '--accent-2': mix(accent, text, 0.3),
    '--accent-soft': alpha(accent, 0.14),
    '--ink-on-accent': hex(bg),
    '--ok': hex(green),
    '--ok-soft': alpha(green, 0.13),
    '--warn': hex(yellow),
    '--warn-soft': alpha(yellow, 0.13),
    '--err': hex(red),
    '--err-soft': alpha(red, 0.13),
    '--ink-on-err': '#fff',
    '--info': hex(cyan),
    '--info-soft': alpha(cyan, 0.13),
    '--debug': hex(textDim),
    '--debug-soft': alpha(textDim, 0.13),
    '--muted-soft': alpha(textDim, 0.12),
    '--y-key': hex(accent),
    '--y-str': hex(green),
    '--y-num': hex(orange),
    '--y-bool': hex(purple),
    '--y-comment': hex(textDim),
    '--mark': alpha(yellow, 0.35),
    '--shadow': base['--shadow'],
    '--backdrop': base['--backdrop'],
  };
}

const deck = (id: string, label: string, family: string, kind: ThemeKind, roles: Roles): Palette => ({
  id, label, family, kind, tokens: fromRoles(kind, roles),
});

/** Blueprint family: navy drafting sheet (dark) and blue-white paper (light); exact surface, line and ink values. */
const blueprint = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'blueprint', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

/** Transit family: blue-grey asphalt dark and signage light; exact surface and ink values (accent is the blue line). */
const transit = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'transit', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

/** Islands family: green-grey frame with lighter islands; exact frame, surface, line and ink values. */
const islands = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'islands', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

/** Modeline family: deep teal terminal dark and pale teal light; ochre accent; exact surface and ink values. */
const modeline = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'modeline', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

/** Ledger family: cool white paper and ink-navy dark; exact surface and ink values (accent is ink blue). */
const ledger = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'ledger', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

/** Atlas family: quiet cool grey, teal accent for selection and primary only; exact surface and ink values. */
const atlas = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'atlas', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

/** Rack family: graphite instrument bezel (dark) and pale equipment grey (light); amber signal accent; exact surface and ink values. */
const rack = (id: string, label: string, kind: ThemeKind, roles: Roles, exact: Partial<Record<Token, string>>): Palette => ({
  id, label, family: 'rack', kind, tokens: { ...fromRoles(kind, roles), ...exact },
});

const RAW_PALETTES: readonly Palette[] = [
  { id: 'kedalion-dark', label: 'Kedalion Dark', family: 'kedalion', kind: 'dark', tokens: KEDALION_DARK },
  { id: 'kedalion-light', label: 'Kedalion Light', family: 'kedalion', kind: 'light', tokens: KEDALION_LIGHT },
  // Ported from session-deck (crates/sdeck/src/theme.rs).
  deck('tokyo-night', 'Tokyo Night', 'tokyo-night', 'dark', [
    0x1a1b26, 0x24283b, 0x414868, 0xc0caf5, 0x787fa0, 0x7aa2f7, 0xbb9af7, 0x7dcfff, 0x9ece6a, 0xe0af68, 0xff9e64, 0xf7768e]),
  deck('catppuccin-mocha', 'Catppuccin Mocha', 'catppuccin', 'dark', [
    0x1e1e2e, 0x313244, 0x585b70, 0xcdd6f4, 0x7f849c, 0x89b4fa, 0xcba6f7, 0x94e2d5, 0xa6e3a1, 0xf9e2af, 0xfab387, 0xf38ba8]),
  deck('gruvbox-dark', 'Gruvbox Dark', 'gruvbox', 'dark', [
    0x282828, 0x3c3836, 0x665c54, 0xebdbb2, 0xa89984, 0x83a598, 0xd3869b, 0x8ec07c, 0xb8bb26, 0xfabd2f, 0xfe8019, 0xfb4934]),
  deck('nord', 'Nord', 'nord', 'dark', [
    0x2e3440, 0x3b4252, 0x4c566a, 0xd8dee9, 0x7b88a1, 0x81a1c1, 0xb48ead, 0x88c0d0, 0xa3be8c, 0xebcb8b, 0xd08770, 0xbf616a]),
  deck('dracula', 'Dracula', 'dracula', 'dark', [
    0x282a36, 0x44475a, 0x6272a4, 0xf8f8f2, 0x8f9bd0, 0xbd93f9, 0xff79c6, 0x8be9fd, 0x50fa7b, 0xf1fa8c, 0xffb86c, 0xff5555]),
  deck('rose-pine', 'Rose Pine', 'rose-pine', 'dark', [
    0x191724, 0x1f1d2e, 0x403d52, 0xe0def4, 0x908caa, 0xc4a7e7, 0xc4a7e7, 0x9ccfd8, 0x31748f, 0xf6c177, 0xebbcba, 0xeb6f92]),
  deck('solarized-dark', 'Solarized Dark', 'solarized', 'dark', [
    0x002b36, 0x073642, 0x586e75, 0x93a1a1, 0x657b83, 0x268bd2, 0x6c71c4, 0x2aa198, 0x859900, 0xb58900, 0xcb4b16, 0xdc322f]),
  deck('tokyo-night-light', 'Tokyo Night Light', 'tokyo-night', 'light', [
    0xd5d6db, 0xe9e9ec, 0x9699a3, 0x343b58, 0x6a6d7c, 0x34548a, 0x7847bd, 0x166775, 0x485e30, 0x8f5e15, 0x965027, 0x8c4351]),
  deck('catppuccin-latte', 'Catppuccin Latte', 'catppuccin', 'light', [
    0xeff1f5, 0xccd0da, 0xacb0be, 0x4c4f69, 0x6c6f85, 0x1e66f5, 0x8839ef, 0x179299, 0x358021, 0xa8680f, 0xcc4a00, 0xd20f39]),
  deck('gruvbox-light', 'Gruvbox Light', 'gruvbox', 'light', [
    0xfbf1c7, 0xebdbb2, 0xa89984, 0x3c3836, 0x7c6f64, 0x076678, 0x8f3f71, 0x427b58, 0x79740e, 0xb57614, 0xaf3a03, 0x9d0006]),
  deck('rose-pine-dawn', 'Rose Pine Dawn', 'rose-pine', 'light', [
    0xfaf4ed, 0xfffaf3, 0xcecacd, 0x575279, 0x797593, 0x907aa9, 0x907aa9, 0x56949f, 0x286983, 0xb36b00, 0xb85c58, 0xb4637a]),
  deck('solarized-light', 'Solarized Light', 'solarized', 'light', [
    0xfdf6e3, 0xeee8d5, 0x93a1a1, 0x586e75, 0x78898b, 0x268bd2, 0x6c71c4, 0x1d8a82, 0x6f8000, 0x9d7500, 0xcb4b16, 0xdc322f]),
  deck('alucard', 'Alucard', 'dracula', 'light', [
    0xfffbeb, 0xece6d0, 0xc8c2a8, 0x1f1f1f, 0x6c664b, 0x644ac9, 0xa3144d, 0x036a96, 0x14710a, 0x846e15, 0xa34d14, 0xcb3a2a]),
  blueprint('blueprint-dark', 'Blueprint Dark', 'dark', [
    0x10263f, 0x15304e, 0x2a4c72, 0xe3eef8, 0x6f8ba8, 0x5cc8f0, 0xb39cf5, 0x7fb2ff, 0x5ed6a0, 0xf2c46b, 0xf59e6b, 0xff7a7a], {
    '--bg-sunken': '#0b1e33', '--bg': '#10263f', '--bg-elev': '#15304e', '--panel': '#15304e', '--panel-2': '#1a3858',
    '--border': '#2a4c72', '--text': '#e3eef8', '--text-2': '#a7bed6', '--text-3': '#6f8ba8', '--accent': '#5cc8f0',
    '--ink-on-accent': '#0b1e33', '--shadow': '0 24px 60px rgba(3, 12, 24, 0.6)',
  }),
  blueprint('blueprint-light', 'Blueprint Light', 'light', [
    0xeef3f8, 0xf8fafc, 0xb5c7da, 0x122840, 0x7088a2, 0x0b6fa4, 0x6d4fc2, 0x1d5fd1, 0x0f8a5f, 0xa86a00, 0xb4531b, 0xc9302c], {
    '--bg-sunken': '#e3ebf3', '--bg': '#eef3f8', '--bg-elev': '#f8fafc', '--panel': '#f8fafc', '--panel-2': '#f2f6fa',
    '--border': '#b5c7da', '--text': '#122840', '--text-2': '#3e5874', '--text-3': '#7088a2', '--accent': '#0b6fa4',
    '--ink-on-accent': '#ffffff',
  }),
  transit('transit-dark', 'Transit Dark', 'dark', [
    0x1e232a, 0x252b33, 0x363e49, 0xeceff3, 0x7a8491, 0x4c9bf0, 0xa487f0, 0x3cc3c0, 0x4cc07a, 0xe8b13a, 0xe46bb4, 0xf0605a], {
    '--bg-sunken': '#181c22', '--bg': '#1e232a', '--bg-elev': '#252b33', '--panel': '#252b33', '--panel-2': '#2a313a',
    '--border': '#363e49', '--text': '#eceff3', '--text-2': '#aeb6c1', '--text-3': '#7a8491', '--accent': '#4c9bf0',
    '--ink-on-accent': '#0f1720',
  }),
  transit('transit-light', 'Transit Light', 'light', [
    0xf4f5f7, 0xffffff, 0xcdd3db, 0x1a1f26, 0x808a97, 0x1f62c4, 0x6a48c9, 0x0e8a87, 0x1e8a4b, 0xa87100, 0xb0347e, 0xc8322c], {
    '--bg-sunken': '#e8ebef', '--bg': '#f4f5f7', '--bg-elev': '#ffffff', '--panel': '#ffffff', '--panel-2': '#f8f9fa',
    '--border': '#cdd3db', '--text': '#1a1f26', '--text-2': '#4d5663', '--text-3': '#808a97', '--accent': '#1f62c4',
    '--ink-on-accent': '#ffffff',
  }),
  islands('islands-dark', 'Islands Dark', 'dark', [
    0x1c221f, 0x232a26, 0x303a34, 0xe4eae5, 0x76847b, 0x8fc17a, 0xb7a0e0, 0x7cc4c9, 0x7fd19a, 0xe3c56e, 0xe79d6a, 0xef7b72], {
    '--bg-sunken': '#161b18', '--bg': '#1c221f', '--bg-elev': '#232a26', '--panel': '#232a26', '--panel-2': '#29312c',
    '--border': '#303a34', '--text': '#e4eae5', '--text-2': '#a9b5ad', '--text-3': '#76847b', '--accent': '#8fc17a',
    '--ink-on-accent': '#161b18', '--shadow': '0 18px 48px rgba(6, 10, 8, 0.55)',
  }),
  islands('islands-light', 'Islands Light', 'light', [
    0xeef2ee, 0xfbfcfb, 0xc6d0c8, 0x18221c, 0x7c8b81, 0x3e7d4a, 0x6a52b8, 0x1f6f8b, 0x2f7d3e, 0x9a6b00, 0xb0561c, 0xc23b32], {
    '--bg-sunken': '#d9e0da', '--bg': '#eef2ee', '--bg-elev': '#fbfcfb', '--panel': '#fbfcfb', '--panel-2': '#f3f6f3',
    '--border': '#c6d0c8', '--text': '#18221c', '--text-2': '#4a5a4f', '--text-3': '#7c8b81', '--accent': '#3e7d4a',
    '--ink-on-accent': '#ffffff',
  }),
  islands('midnight-dark', 'Midnight Dark', 'dark', [
    0x111418, 0x151a20, 0x232932, 0xe6e8eb, 0x6e7682, 0x4f8cff, 0xa78bfa, 0x38bdf8, 0x22c55e, 0xf5a524, 0xf0883e, 0xef4444], {
    '--bg-sunken': '#0b0d10', '--bg': '#111418', '--bg-elev': '#151a20', '--panel': '#151a20', '--panel-2': '#1c222b',
    '--border': '#232932', '--text': '#e6e8eb', '--text-2': '#a8b0bb', '--text-3': '#6e7682', '--accent': '#4f8cff',
    '--ink-on-accent': '#0b0d10', '--shadow': '0 18px 48px rgba(0, 0, 0, 0.6)',
  }),
  islands('midnight-light', 'Midnight Light', 'light', [
    0xffffff, 0xffffff, 0xc6d0c8, 0x18221c, 0x7c8b81, 0x2f6fdf, 0x7c4ddb, 0x1f6f8b, 0x2f7d3e, 0xb7791f, 0xb0561c, 0xc23b32], {
    '--bg-sunken': '#e9ecf0', '--bg': '#ffffff', '--bg-elev': '#ffffff', '--panel': '#ffffff', '--panel-2': '#f3f6f3',
    '--border': '#c6d0c8', '--text': '#18221c', '--text-2': '#4a5a4f', '--text-3': '#7c8b81', '--accent': '#2f6fdf',
    '--ink-on-accent': '#ffffff',
  }),
  modeline('modeline-dark','Modeline Dark', 'dark', [
    0x0f2a2e, 0x143338, 0x2c4d52, 0xd8e4df, 0x6a817c, 0xe2b33c, 0xc39bd3, 0x6cc4c4, 0x8cc47a, 0xe2b33c, 0xe08a4f, 0xe5675f], {
    '--bg-sunken': '#0c2427', '--bg': '#0f2a2e', '--bg-elev': '#143338', '--panel': '#143338', '--panel-2': '#183a40',
    '--border': '#2c4d52', '--text': '#d8e4df', '--text-2': '#9db3ad', '--text-3': '#6a817c', '--accent': '#e2b33c',
    '--ink-on-accent': '#0c2427',
  }),
  modeline('modeline-light', 'Modeline Light', 'light', [
    0xedf1f0, 0xf7f9f8, 0xb9c6c3, 0x123236, 0x748a8c, 0x9a6b00, 0x7b4a9a, 0x16777a, 0x2f7a3a, 0x9a6b00, 0xa84d14, 0xb8322c], {
    '--bg-sunken': '#e2e8e6', '--bg': '#edf1f0', '--bg-elev': '#f7f9f8', '--panel': '#f7f9f8', '--panel-2': '#f1f5f4',
    '--border': '#b9c6c3', '--text': '#123236', '--text-2': '#40595c', '--text-3': '#748a8c', '--accent': '#9a6b00',
    '--ink-on-accent': '#ffffff',
  }),
  ledger('ledger-dark', 'Ledger Dark', 'dark', [
    0x1c2230, 0x222a3a, 0x33405a, 0xe6eaf2, 0x76819a, 0x7fa6ff, 0xb49cff, 0x5fc4d8, 0x5cc98a, 0xe2b54a, 0xf08a4b, 0xf06868], {
    '--bg-sunken': '#151b27', '--bg': '#1c2230', '--bg-elev': '#222a3a', '--panel': '#222a3a', '--panel-2': '#27304a',
    '--border': '#33405a', '--text': '#e6eaf2', '--text-2': '#a6b0c3', '--text-3': '#76819a', '--accent': '#7fa6ff',
    '--ink-on-accent': '#0e1424',
  }),
  ledger('ledger-light', 'Ledger Light', 'light', [
    0xf7f8fa, 0xffffff, 0xd5d9e0, 0x141a24, 0x8790a0, 0x1f4fbf, 0x6a3fc0, 0x0f7f95, 0x1d7f45, 0x9a6a00, 0xb4501a, 0xc0322c], {
    '--bg-sunken': '#eceef1', '--bg': '#f7f8fa', '--bg-elev': '#ffffff', '--panel': '#ffffff', '--panel-2': '#f9fafb',
    '--border': '#d5d9e0', '--text': '#141a24', '--text-2': '#4a5363', '--text-3': '#8790a0', '--accent': '#1f4fbf',
    '--ink-on-accent': '#ffffff',
  }),
  atlas('atlas-dark', 'Atlas Dark', 'dark', [
    0x25282f, 0x2b2f37, 0x3a3f49, 0xe7e9ee, 0x7c828e, 0x2fb3a6, 0xb39ddb, 0x5fc4d8, 0x8bc78a, 0xe5c07b, 0xe8975a, 0xef6f6c], {
    '--bg-sunken': '#1f2228', '--bg': '#25282f', '--bg-elev': '#2b2f37', '--panel': '#2b2f37', '--panel-2': '#30343d',
    '--border': '#3a3f49', '--text': '#e7e9ee', '--text-2': '#aeb3be', '--text-3': '#7c828e', '--accent': '#2fb3a6',
    '--ink-on-accent': '#0f1a19',
  }),
  atlas('atlas-light', 'Atlas Light', 'light', [
    0xf7f7f9, 0xffffff, 0xd6d9df, 0x1c1f25, 0x8a909c, 0x0e8a7e, 0x6a4fb3, 0x1279a0, 0x2f7d3a, 0x8f6a00, 0xb0541a, 0xbf3530], {
    '--bg-sunken': '#eeeff2', '--bg': '#f7f7f9', '--bg-elev': '#ffffff', '--panel': '#ffffff', '--panel-2': '#fafbfc',
    '--border': '#d6d9df', '--text': '#1c1f25', '--text-2': '#535966', '--text-3': '#8a909c', '--accent': '#0e8a7e',
    '--ink-on-accent': '#ffffff',
  }),
  rack('rack-dark', 'Rack Dark', 'dark', [
    0x2a2d31, 0x32363b, 0x484d54, 0xe7e9ec, 0x8d939b, 0xffb340, 0xb39ddb, 0x5fc4d8, 0x6fd08c, 0xf2c14e, 0xf08a4b, 0xf0625f], {
    '--bg-sunken': '#202225', '--bg': '#2a2d31', '--bg-elev': '#32363b', '--panel': '#32363b', '--panel-2': '#383c42',
    '--border': '#484d54', '--text': '#e7e9ec', '--text-2': '#b3b8bf', '--text-3': '#8d939b', '--accent': '#ffb340',
    '--ink-on-accent': '#1d1608',
  }),
  rack('rack-light', 'Rack Light', 'light', [
    0xdde0e3, 0xeceef0, 0xaab0b7, 0x1b1e22, 0x636a73, 0x8a4a00, 0x6a4fb3, 0x1279a0, 0x1f7a3a, 0x8a6200, 0xa84a12, 0xb82f2a], {
    '--bg-sunken': '#cfd3d7', '--bg': '#dde0e3', '--bg-elev': '#eceef0', '--panel': '#eceef0', '--panel-2': '#f3f4f6',
    '--border': '#aab0b7', '--text': '#1b1e22', '--text-2': '#454b53', '--text-3': '#636a73', '--accent': '#8a4a00',
    '--ink-on-accent': '#ffffff',
  }),
];

export const SURFACES: Token[] = ['--bg', '--bg-elev', '--bg-sunken', '--panel', '--panel-2', '--hover', '--selected', '--side-active'];
export const CONTRAST_FLOORS: [fg: Token, bgs: Token[], floor: number][] = [
  ['--text', SURFACES, 4.5],
  ['--text-2', SURFACES, 4.5],
  ['--text-3', ['--bg', '--bg-elev', '--panel', '--panel-2'], 3],
  ['--accent', ['--bg', '--bg-elev', '--panel', '--bg-sunken'], 4.5],
  ['--ink-on-accent', ['--accent'], 4.5],
  ['--ok', ['--bg', '--panel'], 4.5],
  ['--warn', ['--bg', '--panel'], 4.5],
  ['--err', ['--bg', '--panel'], 4.5],
  ['--ink-on-err', ['--err'], 4.5],
  ['--info', ['--bg', '--panel'], 4.5],
];

/** Extra floors of one palette family, for surfaces its layout paints text on (other families keep their values). */
export const FAMILY_FLOORS: Readonly<Record<string, [fg: Token, bgs: Token[], floor: number][]>> = {
};

export function parseColor(value: string): { rgb: Rgb; a: number } {
  const v = value.trim().toLowerCase();
  const m = v.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (m) return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
  let h = v.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return { rgb: rgb(parseInt(h, 16)), a: 1 };
}

/** The colour `value` shows when painted over the opaque `base`. */
export function composite(value: string, base: Rgb): Rgb {
  const { rgb: c, a } = parseColor(value);
  return c.map((v, i) => v * a + base[i]! * (1 - a)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === x ? ((y - z) / d + 6) % 6 : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as Rgb;
}

/** `color` with its lightness moved in `dir` (hue and saturation kept) until `ok` holds; the extreme if never. */
function nudge(color: Rgb, dir: 1 | -1, ok: (c: Rgb) => boolean): Rgb {
  const [h, s, l0] = toHsl(color);
  let c = color;
  for (let l = l0; l >= 0 && l <= 1 && !ok(c); l += dir * 0.004) c = fromHsl(h, s, Math.min(1, Math.max(0, l)));
  return c;
}

/** Palette with the foreground tokens moved just far enough to meet `CONTRAST_FLOORS` on its own surfaces. */
function legible(p: Palette): Palette {
  const tokens = { ...p.tokens };
  const base = composite(tokens['--bg'], [0, 0, 0]);
  const surface = (t: Token) => composite(tokens[t], base);
  const dir = p.kind === 'dark' ? 1 : -1;
  for (const [fg, bgs, floor] of [...CONTRAST_FLOORS, ...(FAMILY_FLOORS[p.family] ?? [])]) {
    const surfaces = bgs.map(surface);
    const fgOver = (c: Rgb, s: Rgb) => contrastRatio(c, s);
    let color = composite(tokens[fg], surfaces[0]!);
    if (surfaces.every((s) => fgOver(color, s) >= floor)) continue;
    let d: 1 | -1 = dir;
    if (fg.startsWith('--ink-')) d = contrastRatio([255, 255, 255], surfaces[0]!) >= contrastRatio([0, 0, 0], surfaces[0]!) ? 1 : -1;
    color = nudge(color, d, (c) => surfaces.every((s) => fgOver(c, s) >= floor));
    tokens[fg] = hex(color);
  }
  return { ...p, tokens };
}

export const PALETTES: readonly Palette[] = RAW_PALETTES.map(legible);

export function paletteById(id: string | undefined): Palette | undefined {
  return id ? PALETTES.find((p) => p.id === id) : undefined;
}

/** The palette of `id`'s family with that kind, if the family has one. */
export function familySibling(id: string, kind: ThemeKind): Palette | undefined {
  const p = paletteById(id);
  return p && PALETTES.find((q) => q.family === p.family && q.kind === kind);
}

/**
 * The palette a saved `id` names, if it is one of `kind`; else the `kind` take on the family of the
 * other side's saved palette (`dracula` → `alucard`); else that kind's default.
 */
export function resolvePalette(kind: ThemeKind, id?: string, otherSideId?: string): Palette {
  const own = paletteById(id);
  if (own?.kind === kind) return own;
  return (otherSideId && familySibling(otherSideId, kind)) || paletteById(kind === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT)!;
}

export function effectiveKind(pref: ThemePreference, systemKind: ThemeKind): ThemeKind {
  return pref === 'system' ? systemKind : pref;
}

/** The palette to show; `systemKind` (the OS light/dark setting) only matters for `theme: 'system'`. */
export function paletteFor(settings: ThemeSettings, systemKind: ThemeKind): Palette {
  return effectiveKind(settings.theme, systemKind) === 'dark'
    ? resolvePalette('dark', settings.paletteDark, settings.paletteLight)
    : resolvePalette('light', settings.paletteLight, settings.paletteDark);
}
