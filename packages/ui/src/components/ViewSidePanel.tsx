import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedSave } from '../hooks';
import { t } from '../i18n';
import { clampSideWidth, defaultSideWidth, readSideWidth, writeSideWidth } from '../view-side';
import { IconButton } from './Button';
import { Tabs } from './Tabs';
import { Icon, type IconName } from './ui';

export interface SidePanelTab {
  id: string;
  label: string;
  render: () => ReactNode;
}

export interface SidePanelContent {
  id: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  tabs: SidePanelTab[];
  actions?: ReactNode;
}

export interface SideLayer {
  content: SidePanelContent;
  tab: string | null;
}

export interface ViewSidePanelState {
  scope: string;
  /** The panel on top; null when the side panel is closed. */
  content: SidePanelContent | null;
  /** The tab shown on the top panel. */
  tab: string | null;
  /** Every open panel, bottom first; empty when closed. */
  layers: SideLayer[];
  open: (content: SidePanelContent, tab?: string) => void;
  /** Opens `content` over the current panels, which stay underneath. */
  push: (content: SidePanelContent, tab?: string) => void;
  /** Closes the top panel, showing the one under it; closes the side panel when it was the last. */
  close: () => void;
  /** Closes every panel. */
  closeAll: () => void;
  /** Closes the panels above layer `index`, making it the top one. */
  popTo: (index: number) => void;
  toggle: () => void;
  isOpen: (id: string) => boolean;
  setTab: (tab: string) => void;
}

function tabFor(next: SidePanelContent, wanted: string | undefined, prev: SideLayer | undefined): string | null {
  if (wanted !== undefined) return wanted;
  const same = prev?.content.id === next.id && prev.tab && next.tabs.some((x) => x.id === prev.tab);
  return same ? prev.tab : next.tabs[0]?.id ?? null;
}

/** Side panel state per scope, kept while the view is unmounted so the panel survives a view change. */
const kept_ = new Map<string, { layers: SideLayer[]; shown: boolean; last: SideLayer[] | null }>();

/** State of one view's side panels. Opening the id already on top (no `tab`) closes it; a new id starts on its first tab. */
export function useViewSidePanel(scope: string): ViewSidePanelState {
  const kept = kept_.get(scope);
  const [layers, setLayers] = useState<SideLayer[]>(kept?.layers ?? []);
  const [shown, setShown] = useState(kept?.shown ?? false);
  const last = useRef<SideLayer[] | null>(kept?.last ?? null);
  const current = useRef({ layers, shown });
  current.current = { layers, shown };
  useEffect(() => { kept_.set(scope, { layers, shown, last: last.current }); }, [scope, layers, shown]);

  const closeAll = useCallback(() => {
    const cur = current.current;
    if (cur.layers.length) last.current = cur.layers;
    setShown(false);
  }, []);
  const open = useCallback((next: SidePanelContent, wanted?: string) => {
    const cur = current.current;
    const top = cur.layers[cur.layers.length - 1];
    if (cur.shown && top?.content.id === next.id && wanted === undefined) return closeAll();
    setLayers([{ content: next, tab: tabFor(next, wanted, top) }]);
    setShown(true);
  }, [closeAll]);
  const push = useCallback((next: SidePanelContent, wanted?: string) => {
    const cur = current.current;
    if (!cur.shown) return open(next, wanted);
    const at = cur.layers.findIndex((l) => l.content.id === next.id);
    if (at >= 0) setLayers([...cur.layers.slice(0, at), { content: next, tab: tabFor(next, wanted, cur.layers[at]) }]);
    else setLayers([...cur.layers, { content: next, tab: tabFor(next, wanted, undefined) }]);
  }, [open]);
  const popTo = useCallback((index: number) => {
    const cur = current.current;
    if (index >= 0 && index < cur.layers.length - 1) setLayers(cur.layers.slice(0, index + 1));
  }, []);
  const close = useCallback(() => {
    const cur = current.current;
    if (cur.shown && cur.layers.length > 1) setLayers(cur.layers.slice(0, -1));
    else closeAll();
  }, [closeAll]);
  const toggle = useCallback(() => {
    if (current.current.shown) return closeAll();
    const prev = last.current;
    if (!prev) return;
    setLayers(prev);
    setShown(true);
  }, [closeAll]);
  const top = layers[layers.length - 1];
  const isOpen = useCallback((id: string) => shown && top?.content.id === id, [shown, top]);
  const setTab = useCallback((tab: string) => setLayers((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, tab } : l))), []);
  return {
    scope, content: shown && top ? top.content : null, tab: top?.tab ?? null, layers: shown ? layers : [],
    open, push, close, closeAll, popTo, toggle, isOpen, setTab,
  };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const STEP = 16;
/** How much of each panel under the top one stays visible, to its left. */
const PEEK = 144;

export function ViewSidePanel({ side, children }: { side: ViewSidePanelState; children: ReactNode }) {
  const { scope, content, layers, close, closeAll, popTo, setTab } = side;
  const [width, setWidth] = useState(() => readSideWidth(scope) ?? defaultSideWidth(window.innerWidth, scope));
  const save = useDebouncedSave<number>((w) => writeSideWidth(scope, w), 300);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const resize = (w: number) => {
    const next = clampSideWidth(w);
    setWidth(next);
    save(next);
  };
  const isOpen = content !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target) || document.querySelector('.modal')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.w + (drag.current.x - e.clientX));
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') resize(width + STEP);
    else if (e.key === 'ArrowRight') resize(width - STEP);
    else return;
    e.preventDefault();
  };

  return (
    <div className="view-with-side">
      <div className="view-with-side-main">{children}</div>
      {isOpen && <div className="view-side-scrim" onClick={closeAll} />}
      {layers.map((layer, i) => {
        const c = layer.content;
        const depth = layers.length - 1 - i;
        const under = depth > 0;
        const activeTab = c.tabs.find((x) => x.id === layer.tab) ?? c.tabs[0];
        const panelId = `view-side-${scope}-${i}`;
        return (
          <aside key={c.id} className={under ? 'view-side view-side-under' : 'view-side'}
            style={{ '--view-side-w': `${width}px`, right: depth * PEEK } as CSSProperties} aria-label={c.title}
            aria-hidden={under || undefined} onClick={under ? () => popTo(i) : undefined}>
            {!under && (
              <div className="view-side-handle" role="separator" aria-orientation="vertical" tabIndex={0}
                aria-label={t('viewSide.resize')} aria-valuemin={560} aria-valuemax={980} aria-valuenow={width}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
                onDoubleClick={() => resize(defaultSideWidth(window.innerWidth, scope))} onKeyDown={onKeyDown} />
            )}
            <header className="view-side-head">
              {c.icon && <Icon name={c.icon} size={18} />}
              <div className="view-side-titles">
                <div className="view-side-title">{c.title}</div>
                {c.subtitle && <div className="view-side-subtitle">{c.subtitle}</div>}
              </div>
              {c.actions && <div className="view-side-actions">{c.actions}</div>}
              <IconButton icon="close" label={t('common.close')} onClick={close} />
            </header>
            <Tabs tabs={c.tabs} active={activeTab?.id ?? ''} onChange={setTab} idPrefix={panelId} />
            {activeTab && (
              <div className="view-side-body" role="tabpanel" id={`${panelId}-panel-${activeTab.id}`} aria-labelledby={`${panelId}-tab-${activeTab.id}`}>
                {activeTab.render()}
              </div>
            )}
          </aside>
        );
      })}
    </div>
  );
}
