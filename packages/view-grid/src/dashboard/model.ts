import { addItem, sameItems, MAX_ID, MIN_PANEL_H, MIN_PANEL_W, validGridItems, type GridItem, type PanelConfig, type PanelDef, type PanelKindSpec } from '@kedalion/ui/grid';

type IconName = NonNullable<GridItem['icon']>;

export const MAX_LAYOUTS = 20;
export const MAX_PRESETS = 50;
export const MAX_NAME = 40;

export interface DashboardLayout {
  id: string;
  name: string;
  items: GridItem[];
}

export interface DashboardLayouts {
  /** Id of the layout shown. */
  active: string;
  layouts: DashboardLayout[];
}

/** A saved starting point for a panel: the kind with a config, title, icon and size. */
export interface DashboardPreset {
  id: string;
  name: string;
  kind: string;
  config?: PanelConfig;
  title?: string;
  icon?: IconName;
  w: number;
  h: number;
}

type Specs = Readonly<Record<string, PanelKindSpec>>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const validName = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= MAX_NAME;
const validId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= MAX_ID;

/** `raw` as layouts, or null when invalid: 1-20 layouts with unique ids, names of 1-40 characters, an `active` that names one, items valid for `kinds`. */
export function validDashboardLayouts(raw: unknown, kinds: Specs): DashboardLayouts | null {
  if (!isRecord(raw) || !Array.isArray(raw.layouts)) return null;
  if (raw.layouts.length < 1 || raw.layouts.length > MAX_LAYOUTS) return null;
  const seen = new Set<string>();
  const layouts: DashboardLayout[] = [];
  for (const entry of raw.layouts) {
    if (!isRecord(entry) || !validId(entry.id) || seen.has(entry.id) || !validName(entry.name)) return null;
    const items = validGridItems(entry.items, kinds);
    if (!items) return null;
    seen.add(entry.id);
    layouts.push({ id: entry.id, name: entry.name.trim(), items });
  }
  if (typeof raw.active !== 'string' || !seen.has(raw.active)) return null;
  return { active: raw.active, layouts };
}

/** The presets of `raw` that are valid; a preset of an unknown kind or with bad fields is dropped, null when `raw` is not a list or is too long. */
export function validDashboardPresets(raw: unknown, kinds: Specs): DashboardPreset[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PRESETS) return null;
  const seen = new Set<string>();
  const out: DashboardPreset[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !validId(entry.id) || seen.has(entry.id) || !validName(entry.name)) continue;
    const { kind, config, title, icon, w, h } = entry;
    if (typeof kind !== 'string') continue;
    const probe = validGridItems([{ id: 'p', kind, config, x: 0, y: 0, w, h, title, icon }], kinds);
    const item = probe?.[0];
    if (!item) continue;
    seen.add(entry.id);
    const preset: DashboardPreset = { id: entry.id, name: entry.name.trim(), kind: item.kind, w: item.w, h: item.h };
    if (item.config) preset.config = item.config;
    if (item.title) preset.title = item.title;
    if (item.icon) preset.icon = item.icon;
    out.push(preset);
  }
  return out;
}

/** An id not in `layouts`. */
export function newLayoutId(layouts: readonly DashboardLayout[]): string {
  const used = new Set(layouts.map((l) => l.id));
  for (let n = layouts.length + 1; ; n++) if (!used.has(`layout-${n}`)) return `layout-${n}`;
}

/** The default state: one empty layout. */
export const defaultLayouts = (name: string): DashboardLayouts => ({ active: 'default', layouts: [{ id: 'default', name, items: [] }] });

/** `raw` as layouts, or the default one when missing or invalid. */
export const layoutsOrDefault = (raw: unknown, kinds: Specs, name: string): DashboardLayouts => validDashboardLayouts(raw, kinds) ?? defaultLayouts(name);

/** The active layout (the first when `active` names none). */
export const activeLayout = (state: DashboardLayouts): DashboardLayout => state.layouts.find((l) => l.id === state.active) ?? state.layouts[0]!;

/** The preset made from a grid item: its kind, config, title, icon and size. */
export function presetFromItem(item: GridItem, id: string, name: string): DashboardPreset {
  const preset: DashboardPreset = { id, name: name.trim(), kind: item.kind, w: item.w, h: item.h };
  if (item.config) preset.config = item.config;
  if (item.title) preset.title = item.title;
  if (item.icon) preset.icon = item.icon;
  return preset;
}

/** An id not in `presets`. */
export function newPresetId(presets: readonly DashboardPreset[]): string {
  const used = new Set(presets.map((p) => p.id));
  for (let n = presets.length + 1; ; n++) if (!used.has(`preset-${n}`)) return `preset-${n}`;
}

/** `items` plus a new item for `preset` at the preset size (at least the grid minimum), with the preset's title, icon and config. */
export function itemFromPreset(items: readonly GridItem[], preset: DashboardPreset, def: PanelDef): GridItem[] {
  const sized: PanelDef = { ...def, defaultSize: { w: Math.max(preset.w, MIN_PANEL_W), h: Math.max(preset.h, MIN_PANEL_H) } };
  const next = addItem(items, sized, preset.config);
  const added = next[next.length - 1]!;
  const extra: Partial<GridItem> = {};
  if (preset.title) extra.title = preset.title;
  if (preset.icon) extra.icon = preset.icon;
  return [...next.slice(0, -1), { ...added, ...extra }];
}

const withoutViewState = (list: readonly GridItem[]): GridItem[] => list.map(({ config: _config, collapsed: _collapsed, ...rest }) => rest);

/** Whether two item lists have the same panels, sizes, positions, titles and icons; panel config and collapsed state are not compared. */
export const sameLayout = (a: readonly GridItem[], b: readonly GridItem[]): boolean => sameItems(withoutViewState(a), withoutViewState(b));

/** The `saved` items with the config and collapsed state of the matching `live` items (by id), so a reset keeps what is not layout. */
export function keepViewState(saved: readonly GridItem[], live: readonly GridItem[]): GridItem[] {
  return saved.map((i) => {
    const l = live.find((x) => x.id === i.id);
    return l ? { ...i, config: l.config, collapsed: l.collapsed } : i;
  });
}
