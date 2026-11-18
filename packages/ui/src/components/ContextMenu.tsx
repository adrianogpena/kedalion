import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { IconName } from '../icons';
import { Icon } from './ui';

const EDGE = 4;

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Makes the item a check item (or a radio item with `radio`): a check or dot shows when true. */
  checked?: boolean;
  radio?: boolean;
  run(): void;
  /** Makes the item open a submenu (on hover, focus or ArrowRight) instead of running; `run` is not called. */
  submenu?: ContextMenuItem[];
}

/**
 * Menu at a point (usually the mouse position of a contextmenu event), kept inside the viewport.
 * Escape, a mousedown outside, scrolling or the window losing focus close it.
 */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'>; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Read on the first render, before the first item takes the focus.
  const previous = useRef(document.activeElement);

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE)),
    });
    el.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const close = () => closeRef.current();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      // Unless an item moved the focus elsewhere (the removed menu leaves it on body).
      const prev = previous.current;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement as HTMLButtonElement | null;
    const box = active?.closest('.context-menu') ?? menu.current;
    const buttons = Array.from(box?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []).filter((b) => b.closest('.context-menu') === box);
    if (!buttons.length) return;
    const idx = buttons.indexOf(active as HTMLButtonElement);
    let next: number;
    if (e.key === 'ArrowRight' && active?.dataset.submenu) {
      e.preventDefault();
      setOpenSub(active.dataset.submenu);
      requestAnimationFrame(() => active.parentElement?.querySelector<HTMLButtonElement>('.menu-submenu .menu-item:not(:disabled)')?.focus());
      return;
    }
    if (e.key === 'ArrowLeft' && box !== menu.current) {
      e.preventDefault();
      const owner = box?.parentElement?.querySelector<HTMLButtonElement>(':scope > .menu-item');
      setOpenSub(null);
      owner?.focus();
      return;
    }
    if (e.key === 'ArrowDown') next = (idx + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Tab') next = idx;
    else return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return createPortal(
    <div ref={menu} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={`sep-${i}`} className="menu-sep" role="separator" />
        ) : item.submenu ? (
          <div key={item.id} className="menu-sub-wrap" onMouseEnter={() => !item.disabled && setOpenSub(item.id)} onMouseLeave={() => setOpenSub((o) => (o === item.id ? null : o))}>
            <button
              title={item.label}
              className="menu-item"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSub === item.id}
              data-submenu={item.id}
              disabled={item.disabled}
              onFocus={() => setOpenSub(item.id)}
              onClick={() => setOpenSub(item.id)}
            >
              <span className="menu-icon">{item.icon && <Icon name={item.icon} size={15} />}</span>
              <span className="menu-label">{item.label}</span>
              <span className="menu-more" aria-hidden="true">›</span>
            </button>
            {openSub === item.id && <SubMenu items={item.submenu} onPick={(sub) => { onClose(); sub.run(); }} />}
          </div>
        ) : (
          <button title={item.label}
            key={item.id}
            className={`menu-item${item.danger ? ' danger' : ''}`}
            role={item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            disabled={item.disabled}
            onFocus={() => setOpenSub(null)}
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="menu-icon">
              {item.checked ? (item.radio ? <span className="menu-radio" /> : <Icon name="check" size={14} />) : item.icon && <Icon name={item.icon} size={15} />}
            </span>
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Menu to the right of its parent item (to the left when it does not fit). */
function SubMenu({ items, onPick }: { items: ContextMenuItem[]; onPick: (item: ContextMenuItem) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - EDGE) el.classList.add('flip');
    if (r.bottom > window.innerHeight - EDGE) el.style.top = `${window.innerHeight - EDGE - r.bottom - 4}px`;
  }, []);
  return (
    <div ref={box} className="context-menu menu-submenu" role="menu">
      {items.map((item) => (
        <button key={item.id} title={item.label} className="menu-item" role="menuitem" disabled={item.disabled} onClick={() => onPick(item)}>
          <span className="menu-icon">{item.icon && <Icon name={item.icon} size={15} />}</span>
          <span className="menu-label">{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
