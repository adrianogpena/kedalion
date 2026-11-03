// Layouts: switchable structural looks. A layout's CSS lives in `packages/ui/src/layouts/<id>.css`,
// scoped under `:root[data-layout='<id>']`; `original` has no file (it is the base styles.css).
// A layout also declares its screen structure (`LayoutStructure`) and its default icon set.
// Pure module, shared by the server (settings validation) and the web UI (applies `data-layout`).

import type { ThemeSettings } from './palettes.ts';

export interface LayoutStructure {
  sidebarSide: 'left' | 'right';
  sidebarMode: 'collapsed' | 'expanded';
  /** Brand row at the top of the sidebar. */
  sidebarBrand: boolean;
  tabBarPosition: 'top' | 'bottom';
  /** False: the StatusBar renders nothing (the user setting `window.statusBar` still applies when true). */
  statusBar: boolean;
  /** 'none': the Sidebar drops its footer; a swapped Frame can show the tools elsewhere. */
  navFooter: 'sidebar' | 'none';
  /** 'header': no sidebar column; the main menu is a strip of screen tabs across the top. */
  navPlacement: 'sidebar' | 'header';
}

export type MainMenu = 'labels' | 'icons';

/** True when the structure shows a labelled main menu (an expanded sidebar or a header nav). */
export function hasLabelledMenu(s: LayoutStructure): boolean {
  return s.navPlacement === 'header' || s.sidebarMode === 'expanded';
}

/** The structure with the main menu style applied: 'icons' collapses an expanded sidebar. */
export function applyMainMenu(s: LayoutStructure, mode?: MainMenu): LayoutStructure {
  return mode === 'icons' && s.sidebarMode === 'expanded' ? { ...s, sidebarMode: 'collapsed' } : s;
}

/** Layouts whose navigation is a header (or otherwise not a side dock): the dock side does not apply. */
export const HEADER_NAV_LAYOUTS: readonly string[] = ['ribbon', 'ledger', 'bridge'];

export function supportsDock(layoutId: string): boolean {
  return !HEADER_NAV_LAYOUTS.includes(layoutId);
}

/** The structure with the dock side applied; unset keeps the layout's own side. */
export function applyDockSide(s: LayoutStructure, side?: 'left' | 'right'): LayoutStructure {
  return side && side !== s.sidebarSide ? { ...s, sidebarSide: side } : s;
}

export interface Layout {
  id: string;
  label: string;
  /** Default icon-set id, one of ICON_SET_IDS. */
  icons: string;
  structure: LayoutStructure;
}

export const DEFAULT_LAYOUT = 'ribbon';

export const ORIGINAL_STRUCTURE: LayoutStructure = {
  sidebarSide: 'left',
  sidebarMode: 'collapsed',
  sidebarBrand: true,
  tabBarPosition: 'top',
  statusBar: true,
  navFooter: 'sidebar',
  navPlacement: 'sidebar',
};

export const LAYOUTS: readonly Layout[] = [
  { id: 'original', label: 'Original', icons: 'original', structure: ORIGINAL_STRUCTURE },
  { id: 'dense', label: 'Dense', icons: 'original', structure: ORIGINAL_STRUCTURE },
  {
    id: 'calm',
    label: 'Calm',
    icons: 'original',
    structure: { ...ORIGINAL_STRUCTURE, sidebarBrand: false, statusBar: false },
  },
  { id: 'material', label: 'Material', icons: 'material', structure: { ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded' } },
  { id: 'blueprint', label: 'Blueprint', icons: 'original', structure: { ...ORIGINAL_STRUCTURE, sidebarBrand: true } },
  { id: 'transit', label: 'Transit', icons: 'original', structure: { ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded' } },
  { id: 'islands', label: 'Islands', icons: 'original', structure: { ...ORIGINAL_STRUCTURE, sidebarMode: 'collapsed', sidebarBrand: false, statusBar: true } },
  { id: 'modeline', label: 'Modeline', icons: 'original', structure: { ...ORIGINAL_STRUCTURE, sidebarBrand: false, tabBarPosition: 'bottom' } },
  { id: 'ribbon', label: 'Ribbon', icons: 'atom', structure: { ...ORIGINAL_STRUCTURE, navPlacement: 'header', navFooter: 'none' } },
  { id: 'bridge', label: 'Bridge', icons: 'atom', structure: { ...ORIGINAL_STRUCTURE, navPlacement: 'header', navFooter: 'none' } },
  {
    id: 'ledger', label: 'Ledger', icons: 'original',
    structure: { ...ORIGINAL_STRUCTURE, navFooter: 'none', navPlacement: 'header', tabBarPosition: 'top' },
  },
  // Files-first: labelled sectioned sidebar (mainMenu 'icons' still collapses it), coloured Atom icons, tools in a status row.
  { id: 'atlas', label: 'Atlas', icons: 'atom', structure: { ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded', sidebarBrand: false, navFooter: 'none' } },
];

/** Layouts offered in Settings; the others stay defined (for building new layouts) but are not listed. */
export const SELECTABLE_LAYOUT_IDS: readonly string[] = ['ribbon', 'bridge', 'original', 'dense', 'calm', 'material', 'blueprint', 'transit', 'islands', 'modeline', 'ledger', 'atlas'];

export const ICON_SET_IDS: readonly string[] = ['original', 'material', 'atom'];

export function layoutById(id: string): Layout | undefined {
  return LAYOUTS.find((l) => l.id === id);
}

/** The layout for `id`; unknown or unset gives the default. */
export function resolveLayout(id?: string): Layout {
  return (id === undefined ? undefined : layoutById(id)) ?? layoutById(DEFAULT_LAYOUT)!;
}

/** The icon set to use: `override` when it is a known id, else the layout's own. */
export function resolveIconSetId(layout: Layout, override?: string): string {
  return override !== undefined && ICON_SET_IDS.includes(override) ? override : layout.icons;
}

// ---- Per-view layouts, Navigation, Look, presets and compatibility (design/LAYOUT-PLAN.md) ----

export type NavigationId = 'header' | 'header-command' | 'sidebar' | 'atlas';
export type DensityId = 'normal' | 'compact' | 'roomy';
export const SKIN_IDS = ['base', 'material', 'blueprint', 'transit', 'modeline', 'ledger', 'atlas', 'islands', 'rack'] as const;
export type SkinId = (typeof SKIN_IDS)[number];
export const NAVIGATION_IDS: readonly NavigationId[] = ['header', 'header-command', 'sidebar', 'atlas'];
export const DENSITY_IDS: readonly DensityId[] = ['normal', 'compact', 'roomy'];

/** The layouts each view offers; the first is its Base. */
export const VIEW_LAYOUTS: Readonly<Record<'git' | 'workbench' | 'rest', readonly string[]>> = {
  git: ['base', 'read-through'],
  workbench: ['base', 'one-surface'],
  rest: ['base', 'panes'],
};

/** Views that can be hidden from the navigation or moved to the side panel; the others always have their own screen. */
export const PLACEABLE_VIEWS = ['workbench', 'rest', 'terminal', 'git'] as const;
export type PlaceableView = (typeof PLACEABLE_VIEWS)[number];
/** 'tab': own screen in the navigation (default); 'hidden': not in the navigation, still opened by links; 'side': compact view in the side panel. */
export type Placement = 'tab' | 'hidden' | 'side';
export const PLACEMENTS: readonly Placement[] = ['tab', 'hidden', 'side'];

export interface NavToggles {
  labels?: boolean;
  brand?: boolean;
  statusBar?: boolean;
  tabBar?: 'top' | 'bottom';
  dock?: 'left' | 'right';
}

export interface LayoutsSetting {
  preset: string;
  views?: Partial<Record<string, string>>;
  /** Per view: absent means 'tab'. */
  placement?: Partial<Record<PlaceableView, Exclude<Placement, 'tab'>>>;
  navigation?: NavigationId;
  nav?: NavToggles;
  density?: DensityId;
  skin?: SkinId;
}

export interface Preset {
  id: 'ribbon' | 'bridge' | 'original';
  navigation: NavigationId;
  nav: Required<NavToggles>;
  density: DensityId;
  skin: SkinId;
  views: Record<string, string>;
  icons: string;
}

const BASE_VIEWS: Record<string, string> = { git: 'base', workbench: 'base', rest: 'base' };

export const PRESETS: readonly Preset[] = [
  {
    id: 'ribbon', navigation: 'header', nav: { labels: true, brand: true, statusBar: true, tabBar: 'top', dock: 'left' },
    density: 'normal', skin: 'base', views: { ...BASE_VIEWS }, icons: 'atom',
  },
  {
    id: 'bridge', navigation: 'header-command', nav: { labels: true, brand: true, statusBar: true, tabBar: 'top', dock: 'left' },
    density: 'normal', skin: 'base', views: { git: 'base', workbench: 'one-surface', rest: 'panes' }, icons: 'atom',
  },
  {
    id: 'original', navigation: 'sidebar', nav: { labels: false, brand: true, statusBar: true, tabBar: 'top', dock: 'left' },
    density: 'normal', skin: 'base', views: { ...BASE_VIEWS }, icons: 'original',
  },
];
export const DEFAULT_PRESET = 'ribbon';

function presetById(id: string | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
}

export interface ResolvedLayouts {
  preset: string;
  navigation: NavigationId;
  nav: Required<NavToggles>;
  density: DensityId;
  skin: SkinId;
  views: Record<string, string>;
  placement: Record<PlaceableView, Placement>;
  structure: LayoutStructure;
  icons: string;
}

export function navToggleApplies(n: NavigationId, toggle: keyof NavToggles): boolean {
  switch (toggle) {
    case 'labels':
    case 'dock':
      return n === 'sidebar' || n === 'atlas';
    case 'brand':
      return n === 'sidebar';
    default:
      return true;
  }
}

function structureFor(navigation: NavigationId, nav: Required<NavToggles>): LayoutStructure {
  const common = { statusBar: nav.statusBar, tabBarPosition: nav.tabBar, sidebarSide: nav.dock };
  const mode = nav.labels ? 'expanded' : 'collapsed';
  if (navigation === 'header' || navigation === 'header-command') {
    return { ...ORIGINAL_STRUCTURE, ...common, navPlacement: 'header', navFooter: 'none' };
  }
  if (navigation === 'atlas') {
    return { ...ORIGINAL_STRUCTURE, ...common, sidebarMode: mode, sidebarBrand: false, navFooter: 'none' };
  }
  return { ...ORIGINAL_STRUCTURE, ...common, sidebarMode: mode, sidebarBrand: nav.brand };
}

function pick<T extends string>(ids: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (ids as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Resolve a setting against its preset; a missing or unknown value follows the preset. */
export function resolveLayouts(s?: LayoutsSetting, iconsOverride?: string): ResolvedLayouts {
  const p = presetById(s?.preset);
  const navigation = pick(NAVIGATION_IDS, s?.navigation, p.navigation);
  const nav: Required<NavToggles> = {
    labels: typeof s?.nav?.labels === 'boolean' ? s.nav.labels : p.nav.labels,
    brand: typeof s?.nav?.brand === 'boolean' ? s.nav.brand : p.nav.brand,
    statusBar: typeof s?.nav?.statusBar === 'boolean' ? s.nav.statusBar : p.nav.statusBar,
    tabBar: pick(['top', 'bottom'] as const, s?.nav?.tabBar, p.nav.tabBar),
    dock: pick(['left', 'right'] as const, s?.nav?.dock, p.nav.dock),
  };
  const density = pick(DENSITY_IDS, s?.density, p.density);
  const skin = pick(SKIN_IDS, s?.skin, p.skin);
  const views: Record<string, string> = { ...p.views };
  for (const [view, id] of Object.entries(s?.views ?? {})) {
    const allowed = (VIEW_LAYOUTS as Record<string, readonly string[]>)[view];
    if (allowed && id !== undefined && allowed.includes(id)) views[view] = id;
  }
  const placement = { workbench: 'tab', rest: 'tab', terminal: 'tab', git: 'tab' } as Record<PlaceableView, Placement>;
  for (const view of PLACEABLE_VIEWS) {
    const v = s?.placement?.[view];
    if (v === 'hidden' || v === 'side') placement[view] = v;
  }
  const skinIcons = skin === 'material' ? 'material' : skin === 'atlas' ? 'atom' : p.icons;
  const icons = iconsOverride !== undefined && ICON_SET_IDS.includes(iconsOverride) ? iconsOverride : skinIcons;
  return { preset: p.id, navigation, nav, density, skin, views, placement, structure: structureFor(navigation, nav), icons };
}

function legacyEntry(id: string): LayoutsSetting {
  switch (id) {
    case 'original': return { preset: 'original' };
    case 'dense': return { preset: 'original', density: 'compact' };
    case 'calm': return { preset: 'original', nav: { brand: false, statusBar: false }, density: 'roomy' };
    case 'material': return { preset: 'original', nav: { labels: true }, skin: 'material' };
    case 'blueprint': return { preset: 'original', skin: 'blueprint' };
    case 'transit': return { preset: 'original', nav: { labels: true }, skin: 'transit' };
    case 'islands': return { preset: 'original', nav: { brand: false }, skin: 'islands' };
    case 'modeline': return { preset: 'original', nav: { brand: false, tabBar: 'bottom' }, skin: 'modeline' };
    case 'bridge': return { preset: 'bridge' };
    case 'ledger': return { preset: 'original', navigation: 'header', skin: 'ledger' };
    case 'atlas': return { preset: 'original', navigation: 'atlas', nav: { labels: true }, skin: 'atlas' };
    default: return { preset: 'ribbon' };
  }
}

/** The old `layout` / `mainMenu` / `dock` values as a layouts setting; only keys differing from the preset are written. */
export function layoutsFromLegacy(t: { layout?: string; mainMenu?: 'labels' | 'icons'; dock?: 'left' | 'right' }): LayoutsSetting {
  const out = legacyEntry(t.layout ?? DEFAULT_LAYOUT);
  const p = presetById(out.preset);
  const nav: NavToggles = { ...out.nav };
  if (t.mainMenu === 'icons') nav.labels = false;
  if (t.dock) nav.dock = t.dock;
  for (const k of Object.keys(nav) as (keyof NavToggles)[]) if (nav[k] === p.nav[k]) delete nav[k];
  const { nav: _drop, ...rest } = out;
  return Object.keys(nav).length ? { ...rest, nav } : rest;
}

export function effectiveLayouts(t: ThemeSettings): LayoutsSetting {
  return t.layouts ?? layoutsFromLegacy(t);
}

/** Shape check: keeps known keys and ids, drops the rest; undefined when `input` has no valid preset. */
export function validLayouts(input: unknown): LayoutsSetting | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.preset !== 'string' || !PRESETS.some((p) => p.id === o.preset)) return undefined;
  const out: LayoutsSetting = { preset: o.preset };
  if (typeof o.views === 'object' && o.views !== null) {
    const views: Record<string, string> = {};
    for (const [view, id] of Object.entries(o.views as Record<string, unknown>)) {
      const allowed = (VIEW_LAYOUTS as Record<string, readonly string[]>)[view];
      if (allowed && typeof id === 'string' && allowed.includes(id)) views[view] = id;
    }
    if (Object.keys(views).length) out.views = views;
  }
  if (typeof o.placement === 'object' && o.placement !== null) {
    const placement: NonNullable<LayoutsSetting['placement']> = {};
    for (const view of PLACEABLE_VIEWS) {
      const v = (o.placement as Record<string, unknown>)[view];
      if (v === 'hidden' || v === 'side') placement[view] = v;
    }
    if (Object.keys(placement).length) out.placement = placement;
  }
  if ((NAVIGATION_IDS as readonly unknown[]).includes(o.navigation)) out.navigation = o.navigation as NavigationId;
  if (typeof o.nav === 'object' && o.nav !== null) {
    const n = o.nav as Record<string, unknown>;
    const nav: NavToggles = {};
    if (typeof n.labels === 'boolean') nav.labels = n.labels;
    if (typeof n.brand === 'boolean') nav.brand = n.brand;
    if (typeof n.statusBar === 'boolean') nav.statusBar = n.statusBar;
    if (n.tabBar === 'top' || n.tabBar === 'bottom') nav.tabBar = n.tabBar;
    if (n.dock === 'left' || n.dock === 'right') nav.dock = n.dock;
    if (Object.keys(nav).length) out.nav = nav;
  }
  if ((DENSITY_IDS as readonly unknown[]).includes(o.density)) out.density = o.density as DensityId;
  if ((SKIN_IDS as readonly unknown[]).includes(o.skin)) out.skin = o.skin as SkinId;
  return out;
}

export type LayoutRow =
  | 'preset' | 'navigation' | 'nav.labels' | 'nav.brand' | 'nav.statusBar' | 'nav.tabBar' | 'nav.dock'
  | 'density' | 'skin' | `view.${string}`;

export interface LayoutConflict {
  row: LayoutRow;
  option: string;
  blockedBy: LayoutRow;
  reason: 'needsHeader' | 'needsSidebar' | 'needsBottomTabs' | 'needsStatusBar';
}

/** Every unmet requirement of the combination: Ledger needs a header, Modeline bottom tabs and a status bar, Islands a sidebar. */
export function layoutsConflicts(r: ResolvedLayouts): LayoutConflict[] {
  const out: LayoutConflict[] = [];
  const header = r.navigation === 'header' || r.navigation === 'header-command';
  if (r.skin === 'ledger' && !header) out.push({ row: 'skin', option: 'ledger', blockedBy: 'navigation', reason: 'needsHeader' });
  if (r.skin === 'modeline' && r.nav.tabBar !== 'bottom') out.push({ row: 'skin', option: 'modeline', blockedBy: 'nav.tabBar', reason: 'needsBottomTabs' });
  if (r.skin === 'modeline' && !r.nav.statusBar) out.push({ row: 'skin', option: 'modeline', blockedBy: 'nav.statusBar', reason: 'needsStatusBar' });
  if (r.skin === 'islands' && header) out.push({ row: 'skin', option: 'islands', blockedBy: 'navigation', reason: 'needsSidebar' });
  return out;
}

function withOption(c: ResolvedLayouts, row: LayoutRow, option: string): ResolvedLayouts {
  const next: ResolvedLayouts = { ...c, nav: { ...c.nav }, views: { ...c.views }, placement: { ...c.placement } };
  if (row === 'preset') return resolveLayouts({ preset: option });
  if (row === 'navigation') next.navigation = option as NavigationId;
  else if (row === 'density') next.density = option as DensityId;
  else if (row === 'skin') next.skin = option as SkinId;
  else if (row === 'nav.labels') next.nav.labels = option === 'true';
  else if (row === 'nav.brand') next.nav.brand = option === 'true';
  else if (row === 'nav.statusBar') next.nav.statusBar = option === 'true';
  else if (row === 'nav.tabBar') next.nav.tabBar = option === 'bottom' ? 'bottom' : 'top';
  else if (row === 'nav.dock') next.nav.dock = option === 'right' ? 'right' : 'left';
  else next.views[row.slice(5)] = option;
  return next;
}

/** Conflicts picking `option` in `row` would cause, in either direction (the option's own needs, or the rows that need the old value). [] = allowed. */
export function optionConflicts(current: ResolvedLayouts, row: LayoutRow, option: string): LayoutConflict[] {
  return layoutsConflicts(withOption(current, row, option)).filter((c) => c.row === row || c.blockedBy === row);
}

/** Rows whose value overrides the preset ("Custom"). */
export function differsFromPreset(s: LayoutsSetting): LayoutRow[] {
  const base = resolveLayouts({ preset: s.preset });
  const r = resolveLayouts(s);
  const rows: LayoutRow[] = [];
  if (r.navigation !== base.navigation) rows.push('navigation');
  for (const k of ['labels', 'brand', 'statusBar', 'tabBar', 'dock'] as const) {
    if (r.nav[k] !== base.nav[k]) rows.push(`nav.${k}`);
  }
  if (r.density !== base.density) rows.push('density');
  if (r.skin !== base.skin) rows.push('skin');
  for (const view of Object.keys(r.views)) if (r.views[view] !== base.views[view]) rows.push(`view.${view}`);
  return rows;
}

/** The LAYOUTS id whose CSS matches the combination (until the skins own their CSS). */
export function legacyLayoutId(r: ResolvedLayouts): string {
  if (r.skin !== 'base') return r.skin;
  if (r.density === 'roomy') return 'calm';
  if (r.density === 'compact') return 'dense';
  if (r.navigation === 'header-command') return 'bridge';
  if (r.navigation === 'header') return 'ribbon';
  return r.navigation === 'atlas' ? 'atlas' : 'original';
}
