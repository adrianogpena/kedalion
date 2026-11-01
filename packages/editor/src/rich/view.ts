import type { EditorView } from '@milkdown/prose/view';
import { createElement, lazy, Suspense } from 'react';
import type { ReadingWidth, RichApi, RichFeature } from './commands';

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;

/** Clamps to 50-200 and snaps to the 10% step. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom / ZOOM_STEP) * ZOOM_STEP));
}

/** One step up or down from `zoom`. */
export const stepZoom = (zoom: number, dir: 1 | -1): number => clampZoom(clampZoom(zoom) + dir * ZOOM_STEP);

/** CSS `max-width` for the document column. */
export function readingWidthCss(width: ReadingWidth): string {
  if (width === 'full') return 'none';
  if (typeof width === 'string' && /^\d+(\.\d+)?%$/.test(width)) {
    const pct = Math.min(100, Math.max(50, Math.round(parseFloat(width))));
    return `max(min(72ch, 100%), ${pct}%)`;
  }
  if (typeof width === 'number' && Number.isFinite(width)) return `${Math.min(120, Math.max(40, Math.round(width)))}ch`;
  return '72ch';
}

type Listener = () => void;
interface ZoomStore {
  zoom: number;
  /** Max view: the column fills the pane at 100%; `restoreZoom` is the zoom to return to. */
  wide: boolean;
  restoreZoom: number;
  listeners: Set<Listener>;
}
const stores = new WeakMap<EditorView, ZoomStore>();

const WIDE_KEY = 'kedalion.md.maxView';

/** The max view choice outlives the editor view (switching views recreates it) and reloads. */
function loadWide(): { wide: boolean; restoreZoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(WIDE_KEY) ?? 'null');
    if (v && v.wide === true) return { wide: true, restoreZoom: clampZoom(Number(v.restoreZoom)) };
  } catch {
    // storage unavailable or malformed: start without max view
  }
  return { wide: false, restoreZoom: 100 };
}

function saveWide(s: ZoomStore): void {
  try {
    localStorage.setItem(WIDE_KEY, JSON.stringify({ wide: s.wide, restoreZoom: s.restoreZoom }));
  } catch {
    // ignore
  }
}

export function zoomStore(api: RichApi): ZoomStore {
  let s = stores.get(api.view);
  if (!s) {
    const w = loadWide();
    s = { zoom: w.wide ? 100 : clampZoom(api.host.settings.zoom), wide: w.wide, restoreZoom: w.restoreZoom, listeners: new Set() };
    stores.set(api.view, s);
  }
  return s;
}

/** Applies the zoom and reading width as CSS variables on the pane; no ProseMirror transaction. */
export function applyView(api: RichApi): void {
  const pane = api.view.dom.closest<HTMLElement>('.md-rich');
  if (!pane) return;
  pane.style.setProperty('--md-zoom', String(zoomStore(api).zoom / 100));
  pane.style.setProperty('--md-reading-width', readingWidthCss(zoomStore(api).wide ? 'full' : api.host.settings.readingWidth));
}

export function setZoom(api: RichApi, zoom: number): void {
  const s = zoomStore(api);
  s.zoom = clampZoom(zoom);
  applyView(api);
  s.listeners.forEach((fn) => fn());
}

/** Toggles between the centered column and the max view (full width, no zoom). */
export function toggleWide(api: RichApi): void {
  const s = zoomStore(api);
  if (s.wide) {
    s.wide = false;
    saveWide(s);
    setZoom(api, s.restoreZoom);
  } else {
    s.restoreZoom = s.zoom;
    s.wide = true;
    saveWide(s);
    setZoom(api, 100);
  }
}

const LazyZoom = lazy(() => import('./ZoomControl').then((m) => ({ default: m.ZoomControl })));
const ZoomOverlay = ({ api }: { api: RichApi }) => createElement(Suspense, { fallback: null }, createElement(LazyZoom, { api }));

export const viewFeature: RichFeature = {
  Overlay: ZoomOverlay,
  handlers: {
    zoomIn: (api) => (setZoom(api, stepZoom(zoomStore(api).zoom, 1)), true),
    zoomOut: (api) => (setZoom(api, stepZoom(zoomStore(api).zoom, -1)), true),
    zoomReset: (api) => (setZoom(api, 100), true),
    zoomFit: (api) => (toggleWide(api), true),
  },
};
