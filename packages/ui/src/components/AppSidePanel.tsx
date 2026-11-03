import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useDebouncedSave } from '../hooks';
import { t } from '../i18n';
import { ViewCompactProvider } from '../view-compact';
import { clampSideWidth, defaultSideWidth, readSideWidth, writeSideWidth } from '../view-side';
import { IconButton } from './Button';
import { Icon, type IconName } from './ui';

const SCOPE = 'app';
const STEP = 16;

export interface AppSidePanelView {
  id: string;
  title: string;
  icon?: IconName;
  render: () => ReactNode;
}

/**
 * The side panel for views placed "in the side panel": `open` is the shown view (null = closed). A view stays mounted once opened,
 * hidden while closed, so reopening shows what was there.
 */
export function AppSidePanel({ open, views, onClose, children }: { open: string | null; views: readonly AppSidePanelView[]; onClose: () => void; children: ReactNode }) {
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => { if (open && !visited.includes(open)) setVisited((v) => [...v, open]); }, [open, visited]);
  const [width, setWidth] = useState(() => readSideWidth(SCOPE) ?? defaultSideWidth(window.innerWidth, SCOPE));
  const save = useDebouncedSave<number>((w) => writeSideWidth(SCOPE, w), 300);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const resize = (w: number) => {
    const next = clampSideWidth(w);
    setWidth(next);
    save(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (e.key !== 'Escape' || e.defaultPrevented || typing || document.querySelector('.modal')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') resize(width + STEP);
    else if (e.key === 'ArrowRight') resize(width - STEP);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.w + (drag.current.x - e.clientX));
  };

  return (
    <div className="view-with-side app-side">
      <div className="view-with-side-main">{children}</div>
      {open && <div className="view-side-scrim" onClick={onClose} />}
      {views.filter((v) => visited.includes(v.id) || v.id === open).map((v) => (
        <aside key={v.id} className="view-side" hidden={v.id !== open} style={{ '--view-side-w': `${width}px` } as CSSProperties} aria-label={v.title}>
          <div className="view-side-handle" role="separator" aria-orientation="vertical" tabIndex={0}
            aria-label={t('viewSide.resize')} aria-valuemin={560} aria-valuemax={980} aria-valuenow={width}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onDoubleClick={() => resize(defaultSideWidth(window.innerWidth, SCOPE))} onKeyDown={onKeyDown} />
          <header className="view-side-head">
            {v.icon && <Icon name={v.icon} size={18} />}
            <div className="view-side-titles"><div className="view-side-title">{v.title}</div></div>
            <IconButton icon="close" label={t('common.close')} onClick={onClose} />
          </header>
          <div className="view-side-body app-side-body">
            <ViewCompactProvider value>{v.render()}</ViewCompactProvider>
          </div>
        </aside>
      ))}
    </div>
  );
}
