// Layouts: switchable structural looks. A layout's CSS lives in `packages/ui/src/layouts/<id>.css`,
// scoped under `:root[data-layout='<id>']`; `original` has no file (it is the base styles.css).
// A layout also declares its screen structure (`LayoutStructure`) and its default icon set.
// Pure module, shared by the server (settings validation) and the web UI (applies `data-layout`).

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
export const HEADER_NAV_LAYOUTS: readonly string[] = ['ribbon', 'ledger', 'bridge', 'dossier'];

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
  // Project-first (preview): a left spine of projects, the screens as chapters of the project's dossier, tools in the dossier header.
  { id: 'dossier', label: 'Dossier', icons: 'dossier', structure: { ...ORIGINAL_STRUCTURE, sidebarMode: 'expanded', sidebarBrand: false, navFooter: 'none', statusBar: true } },
];

/** Layouts offered in Settings; the others stay defined (for building new layouts) but are not listed. */
export const SELECTABLE_LAYOUT_IDS: readonly string[] = ['ribbon', 'bridge'];

export const ICON_SET_IDS: readonly string[] = ['original', 'material', 'atom', 'dossier'];

/** Icon sets of preview layouts: valid, but not listed in Settings unless already chosen. */
export const PREVIEW_ICON_SET_IDS: readonly string[] = ['dossier'];

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
