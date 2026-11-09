/** Pure helpers for the panel grid (`PanelGrid`); ported from Dashboard's `PageGrid`. */
import { PATHS, type IconName } from './icons';

/** A panel's settings: field key to value (see `PanelField`, `validConfig`). */
export type PanelConfig = Record<string, unknown>;

interface PanelFieldBase {
  key: string;
  /** i18n key of the label. */
  label: string;
  /** i18n key of the description. */
  description?: string;
  /** Older keys of this setting; `validConfig` reads the first present one when `key` is absent. */
  legacyKeys?: readonly string[];
  /** Kept in the config but not shown in the form; the panel edits it itself. */
  hidden?: boolean;
}

export type PanelField =
  | (PanelFieldBase & { kind: 'boolean'; default: boolean })
  | (PanelFieldBase & { kind: 'number'; default: number; min?: number; max?: number })
  | (PanelFieldBase & { kind: 'string'; default: string; placeholder?: string; maxLength?: number; /** Masks the input like a password. */ secret?: boolean })
  | (PanelFieldBase & { kind: 'enum'; default: string | number; values: readonly (string | number)[]; /** i18n key prefix: `<prefix>.<value>` is the option text when it exists. */ optionLabel?: string })
  | (PanelFieldBase & { kind: 'multi'; default: string[]; values: readonly string[]; /** i18n key prefix: `<prefix>.<value>` is the option text when it exists. */ optionLabel?: string })
  | (PanelFieldBase & { kind: 'text'; default: string; maxLength?: number; rows?: number; placeholder?: string; /** Shows an "Import OPML" button that appends the feed URLs of a chosen file. */ importOpml?: boolean })
  | (PanelFieldBase & { kind: 'date'; default: '' })
  /** An absolute folder inside an Explorer project, chosen with a dialog that lists only the projects. */
  | (PanelFieldBase & { kind: 'folder'; default: '' })
  /** A connection id (see the Dashboard's Connections); the form shows a select of the connections of `connectionType`. */
  | (PanelFieldBase & { kind: 'connection'; connectionType: 'jira' | 'github' | 'todoist'; default: '' })
  /** GitHub labels: chips with a remove button and a + that opens a filterable checklist of the labels the connection in `connectionKey` (default `connection`) can see; a saved label not in the list is kept. A saved single string counts as one label. */
  | (PanelFieldBase & { kind: 'label'; default: string[]; connectionKey?: string });

const MAX_LABELS = 20;

/** The labels of a `label` field value: a list, or a legacy single string. */
export const labelList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x): x is string => typeof x === 'string' && x.trim() !== '' && x.length <= 100).slice(0, MAX_LABELS);

export const MAX_FIELD_TEXT = 200;
export const MAX_TEXT_FIELD = 4000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The config every field's default makes. */
export const defaultConfig = (fields: readonly PanelField[]): PanelConfig =>
  Object.fromEntries(fields.map((f) => [f.key, f.default]));

/**
 * `raw` cleaned against `fields`: unknown keys dropped, a value of the wrong type or outside the
 * enum replaced by the default, numbers clamped to min/max. Never throws; no window needed.
 */
export function validConfig(fields: readonly PanelField[], raw: unknown): PanelConfig {
  const src = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: PanelConfig = {};
  for (const f of fields) {
    const from = [f.key, ...(f.legacyKeys ?? [])].find((k) => Object.hasOwn(src, k));
    const v = from === undefined ? undefined : src[from];
    switch (f.kind) {
      case 'boolean':
        out[f.key] = typeof v === 'boolean' ? v : f.default;
        break;
      case 'number': {
        const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, v)) : f.default;
        out[f.key] = n;
        break;
      }
      case 'string':
        out[f.key] = typeof v === 'string' && v.length <= (f.maxLength ?? MAX_FIELD_TEXT) ? v : f.default;
        break;
      case 'enum':
        out[f.key] = (typeof v === 'string' || typeof v === 'number') && f.values.includes(v) ? v : f.default;
        break;
      case 'multi': {
        const picked = Array.isArray(v) ? v : f.default;
        out[f.key] = f.values.filter((x) => picked.includes(x));
        break;
      }
      case 'text':
        out[f.key] = typeof v === 'string' && v.length <= (f.maxLength ?? MAX_TEXT_FIELD) ? v : f.default;
        break;
      case 'date':
        out[f.key] = typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : f.default;
        break;
      case 'folder':
        out[f.key] = typeof v === 'string' && v.length <= 500 ? v : f.default;
        break;
      case 'label':
        out[f.key] = v === undefined ? f.default : [...new Set(labelList(v))];
        break;
      case 'connection':
        out[f.key] = typeof v === 'string' && v.length <= MAX_ID ? v : f.default;
        break;
    }
  }
  return out;
}

/** What validation needs to know of a registered panel kind. */
export interface PanelKindSpec {
  fields?: readonly PanelField[];
  /** Several instances of the kind may exist; true when omitted. */
  allowMultiple?: boolean;
}

export const MAX_ID = 64;

export interface GridItem {
  /** Unique instance id. */
  id: string;
  /** The panel kind; older saved items without it use their id. */
  kind: string;
  config?: PanelConfig;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  /** User-chosen name, 1–40 characters; the panel definition's title when absent. */
  title?: string;
  /** User-chosen icon from the built-in set; the panel definition's icon when absent. */
  icon?: IconName;
}

export interface PanelDef {
  /** The kind id. */
  id: string;
  title: string;
  icon: IconName;
  defaultSize: { w: number; h: number };
  minW: number;
  minH: number;
}

/** One entry of react-grid-layout's layout (the subset the grid uses). */
export interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  isResizable?: boolean;
}

export type Breakpoint = 'lg' | 'md' | 'sm';

export const BREAKPOINTS: Record<Breakpoint, number> = { lg: 1200, md: 768, sm: 0 };
export const COLS: Record<Breakpoint, number> = { lg: 12, md: 6, sm: 1 };
export const ROW_HEIGHT = 24;
export const COLLAPSED_H = 2;
/** Smallest size any panel can be resized to; a kind's `minW`/`minH` only guide its default size. */
export const MIN_PANEL_W = 1;
export const MIN_PANEL_H = 2;

export const MAX_GRID_ITEMS = 50;
export const MAX_GRID_Y = 1000;
export const MAX_GRID_H = 100;
export const MAX_TITLE = 40;

const ICON_NAMES: readonly string[] = Object.keys(PATHS);

const inRange = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/**
 * A saved layout (e.g. from settings) as items, or null when it isn't valid: unique ids, every kind
 * registered in `kinds` (an item without `kind` uses its id), a kind with `allowMultiple: false` at most once,
 * integer positions inside the 12 columns, sizes within the caps. Each config is cleaned with `validConfig`;
 * extra fields are dropped.
 */
export function validGridItems(raw: unknown, kinds: Readonly<Record<string, PanelKindSpec>>): GridItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_GRID_ITEMS) return null;
  const seen = new Set<string>();
  const kindCount = new Map<string, number>();
  const items: GridItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { id, kind: rawKind, config, x, y, w, h, collapsed, title, icon } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID || seen.has(id)) return null;
    const kind = rawKind === undefined ? id : rawKind;
    if (typeof kind !== 'string' || !Object.hasOwn(kinds, kind)) return null;
    const spec = kinds[kind]!;
    const count = (kindCount.get(kind) ?? 0) + 1;
    kindCount.set(kind, count);
    if (count > 1 && spec.allowMultiple === false) return null;
    if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) return null;
    if (!inRange(x, 0, COLS.lg - 1) || !inRange(w, 1, COLS.lg) || x + w > COLS.lg) return null;
    if (!inRange(y, 0, MAX_GRID_Y) || !inRange(h, 1, MAX_GRID_H)) return null;
    if (collapsed !== undefined && typeof collapsed !== 'boolean') return null;
    if (title !== undefined && typeof title !== 'string') return null;
    if (icon !== undefined && (typeof icon !== 'string' || !ICON_NAMES.includes(icon))) return null;
    seen.add(id);
    const clean: GridItem = { id, kind, x, y, w, h };
    if (spec.fields && spec.fields.length > 0) clean.config = validConfig(spec.fields, config);
    if (collapsed !== undefined) clean.collapsed = collapsed;
    const name = title?.trim();
    if (name) {
      if (name.length > MAX_TITLE) return null;
      clean.title = name;
    }
    if (icon !== undefined) clean.icon = icon as IconName;
    items.push(clean);
  }
  return items;
}

export const breakpointOf =(width: number): Breakpoint =>
  width >= BREAKPOINTS.lg ? 'lg' : width >= BREAKPOINTS.md ? 'md' : 'sm';

/** Items to the grid's layout; unknown ids are dropped, a collapsed panel gets a fixed height. */
export function toGridLayout(items: readonly GridItem[], defs: readonly PanelDef[]): GridLayoutItem[] {
  return items.flatMap((item) => {
    const def = defs.find((d) => d.id === item.kind);
    if (!def) return [];
    const { collapsed } = item;
    return [{
      i: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: collapsed ? COLLAPSED_H : item.h,
      minW: MIN_PANEL_W,
      minH: collapsed ? COLLAPSED_H : MIN_PANEL_H,
      isResizable: !collapsed,
    }];
  });
}

/** Moves the grid's positions back into the items; a collapsed panel keeps its expanded height. */
export function fromGridLayout(layout: readonly GridLayoutItem[], items: readonly GridItem[]): GridItem[] {
  return items.map((item) => {
    const l = layout.find((li) => li.i === item.id);
    if (!l) return item;
    return { ...item, x: l.x, y: l.y, w: l.w, h: item.collapsed ? item.h : l.h };
  });
}

/**
 * After panel `id` was resized sideways (`after` holds its new x and w). Panels beside the moved
 * edge follow it, back at their `before` row: when they touched the edge, also while it shrinks;
 * otherwise when it reaches them. A panel that moves pushes the ones beside it in turn. Nothing
 * ever moves down: when a follower has no room (the columns end or another panel is in the way),
 * the growth of `id` is cut back; a shrink just leaves such followers where they were.
 */
export function pushSideways(before: readonly GridItem[], after: readonly GridItem[], id: string, cols = COLS.lg): GridItem[] {
  const r0 = before.find((i) => i.id === id);
  const r1 = after.find((i) => i.id === id);
  if (!r0 || !r1) return after.map((i) => ({ ...i }));
  const edge = (b: Box, dir: 1 | -1) => (dir > 0 ? b.x + b.w : b.x);
  const sharesRows = (a: Box, b: Box) => a.y < b.y + b.h && b.y < a.y + a.h;
  const follow = (r: Box, dir: 1 | -1): { moved: Map<string, number>; ok: boolean } => {
    const moved = new Map<string, number>();
    const queue = [{ box: r0 as Box, from: edge(r0, dir), to: edge(r, dir) }];
    while (queue.length > 0) {
      const { box, from, to } = queue.shift()!;
      if (from === to) continue;
      for (const o of before) {
        if (o.id === id || moved.has(o.id)) continue;
        if (!(dir > 0 ? o.x >= from : o.x + o.w <= from)) continue;
        if (!sharesRows(o, box) && !sharesRows(o, r)) continue;
        let x: number;
        if (edge(o, -dir as 1 | -1) === from) x = o.x + (to - from);
        else if (dir > 0 ? o.x < to : o.x + o.w > to) x = dir > 0 ? to : to - o.w;
        else continue;
        moved.set(o.id, x);
        queue.push({ box: o, from: edge(o, dir), to: edge({ ...o, x }, dir) });
      }
    }
    for (const [mid, x] of moved) {
      const m = { ...before.find((i) => i.id === mid)!, x };
      const blocked = x < 0 || x + m.w > cols || before.some((o) => o.id !== id && !moved.has(o.id) && overlaps(m, o));
      if (blocked) return { moved: new Map(), ok: dir * (edge(r, dir) - edge(r0, dir)) <= 0 };
    }
    return { moved, ok: true };
  };
  let r: Box = { x: r1.x, y: r1.y, w: r1.w, h: r1.h };
  let right = follow(r, 1);
  let left = follow(r, -1);
  while (!right.ok || !left.ok) {
    r = right.ok ? { ...r, x: r.x + 1, w: r.w - 1 } : { ...r, w: r.w - 1 };
    right = follow(r, 1);
    left = follow(r, -1);
  }
  return before.map((i) => {
    if (i.id === id) return { ...r1, x: r.x, w: r.w };
    const x = right.moved.get(i.id) ?? left.moved.get(i.id);
    return x === undefined ? { ...i } : { ...i, x };
  });
}

export const sameGeometry =(a: readonly GridItem[], b: readonly GridItem[]): boolean =>
  a.length === b.length && a.every((x, i) => {
    const y = b[i];
    return !!y && x.id === y.id && x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
  });

const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));

export const sameConfig = (a: PanelConfig | undefined, b: PanelConfig | undefined): boolean => {
  const x = a ?? {};
  const y = b ?? {};
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => Object.hasOwn(y, k) && sameValue(x[k], y[k]));
};

/** Geometry plus the kind, config, collapsed flag, title and icon: what the Save button compares. */
export const sameItems = (a: readonly GridItem[], b: readonly GridItem[]): boolean =>
  sameGeometry(a, b) && a.every((x, i) => {
    const y = b[i]!;
    return x.kind === y.kind && sameConfig(x.config, y.config) && !!x.collapsed === !!y.collapsed && x.title === y.title && x.icon === y.icon;
  });

type Box = Pick<GridItem, 'x' | 'y' | 'w' | 'h'>;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first free spot (top to bottom, left to right) where a `w`×`h` panel fits. */
export function findFreeSpot(items: readonly Box[], w: number, h: number, cols = COLS.lg): { x: number; y: number } {
  const width = Math.min(w, cols);
  const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + width <= cols; x++) {
      if (!items.some((i) => overlaps({ x, y, w: width, h }, i))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** An instance id for `kind` not used by `items`: the kind itself, then `kind-2`, `kind-3`… */
export function newItemId(items: readonly GridItem[], kind: string): string {
  const used = new Set(items.map((i) => i.id));
  if (!used.has(kind)) return kind;
  for (let n = 2; ; n++) if (!used.has(`${kind}-${n}`)) return `${kind}-${n}`;
}

/** Appends a new instance of the kind at its default size on the first free spot. */
export function addItem(items: readonly GridItem[], def: PanelDef, config?: PanelConfig): GridItem[] {
  const { w, h } = def.defaultSize;
  const item: GridItem = { id: newItemId(items, def.id), kind: def.id, ...findFreeSpot(items, w, h), w, h, collapsed: false };
  if (config) item.config = config;
  return [...items, item];
}
