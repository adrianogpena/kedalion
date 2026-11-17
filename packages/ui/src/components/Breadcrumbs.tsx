import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage, errorOf } from '../api-core';
import { fileIconOf, folderIconOf, useFileIconVersion } from '../file-icons';
import { t } from '../i18n';
import { Icon } from './ui';

const EDGE = 4;
/** Deeper paths show the root, an ellipsis and the last segments. */
const MAX_SEGMENTS = 5;
const TAIL = 3;

export interface BreadcrumbEntry {
  name: string;
  kind: 'dir' | 'file';
  /** Relative to the root, '/'-separated. */
  path: string;
}

export interface BreadcrumbsProps {
  /** Shown as the first segment; it lists the root folder (''). */
  root: string;
  /** Relative, '/'-separated; the last segment is the file. */
  path: string;
  /** Icon of the file segment; default: by its name. */
  icon?: ReactNode;
  /** The entries of a folder ('' = the root). */
  list(dir: string): Promise<BreadcrumbEntry[]>;
  /** A file was picked from a segment's list. */
  onPick(entry: BreadcrumbEntry): void;
  /** Focuses the first segment whenever it changes. */
  focusSignal?: number;
  title?: string;
}

interface Segment {
  label: string;
  /** The folder its list shows: its own, or the parent of the file. */
  dir: string;
  file: boolean;
  /** The ellipsis: the folders it stands for, listed by its menu. */
  hidden?: Segment[];
}

/** The path as a toolbar of segments; a segment lists its folder's entries to pick a file from. */
export function Breadcrumbs({ root, path, icon, list, onPick, focusSignal, title }: BreadcrumbsProps) {
  const parts = path.split('/').filter(Boolean);
  const segments: Segment[] = [
    { label: root, dir: '', file: false },
    ...parts.map((name, i) => {
      const file = i === parts.length - 1;
      return { label: name, dir: parts.slice(0, file ? i : i + 1).join('/'), file };
    }),
  ];
  const shown: Segment[] =
    segments.length > MAX_SEGMENTS
      ? [segments[0]!, { label: '…', dir: '', file: false, hidden: segments.slice(1, -TAIL) }, ...segments.slice(-TAIL)]
      : segments;
  const bar = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [open, setOpen] = useState<number>();
  const roving = Math.min(focusIdx, shown.length - 1);
  useFileIconVersion();

  const buttons = () => Array.from(bar.current?.querySelectorAll<HTMLButtonElement>('.breadcrumbs-seg') ?? []);

  const seen = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === seen.current) return;
    seen.current = focusSignal;
    buttons()[0]?.focus();
  }, [focusSignal]);

  useEffect(() => setOpen(undefined), [path]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons();
    const idx = all.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    let next: number;
    if (e.key === 'ArrowRight') next = Math.min(idx + 1, all.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(idx);
      return;
    } else return;
    e.preventDefault();
    setOpen(undefined);
    all[next]?.focus();
  };

  const fileIcon = icon ?? (() => {
    const { icon: name, tone } = fileIconOf(parts[parts.length - 1] ?? '');
    return <span className={tone ? `tone-${tone}` : undefined}><Icon name={name} size={14} /></span>;
  })();
  const anchor = open !== undefined ? buttons()[open] : undefined;

  return (
    <>
      <div ref={bar} className="breadcrumbs" role="toolbar" aria-label={t('breadcrumbs.label')} title={title} onKeyDown={onKeyDown}>
        {shown.map((s, i) => (
          <Fragment key={s.hidden ? 'more' : `${s.dir}/${s.label}`}>
            {i > 0 && <span className="breadcrumbs-sep" aria-hidden="true"><Icon name="chevron" size={12} /></span>}
            <button title={s.hidden ? s.hidden.map((h) => h.label).join('/') : s.label}
              type="button"
              className={`breadcrumbs-seg${s.file ? ' file' : ''}${open === i ? ' open' : ''}`}
              tabIndex={i === roving ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={open === i}
              onFocus={() => setFocusIdx(i)}
              onClick={() => setOpen((o) => (o === i ? undefined : i))}
            >
              {s.file && <span className="breadcrumbs-icon">{fileIcon}</span>}
              <span className="breadcrumbs-label">{s.label}</span>
            </button>
          </Fragment>
        ))}
      </div>
      {open !== undefined && anchor && shown[open] && (
        <Picker
          key={open}
          anchor={anchor}
          bar={bar.current}
          start={shown[open].dir}
          ancestors={shown[open].hidden}
          current={path}
          list={list}
          onPick={onPick}
          onClose={(refocus) => {
            setOpen(undefined);
            if (refocus) anchor.focus();
          }}
        />
      )}
    </>
  );
}

type Listing = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; entries: BreadcrumbEntry[] };

const byKindAndName = (a: BreadcrumbEntry, b: BreadcrumbEntry) =>
  (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * A folder's entries below a segment, in the context menu's look; a folder opens in place, a file is picked.
 * With `ancestors` (the ellipsis) it first lists those folders instead.
 */
function Picker({ anchor, bar, start, ancestors, current, list, onPick, onClose }: {
  anchor: HTMLElement;
  bar: HTMLElement | null;
  start: string;
  ancestors?: Segment[];
  current: string;
  list(dir: string): Promise<BreadcrumbEntry[]>;
  onPick(entry: BreadcrumbEntry): void;
  onClose(refocus: boolean): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  // null: the ellipsis' list of hidden folders.
  const [dir, setDir] = useState<string | null>(ancestors ? null : start);
  const [listing, setListing] = useState<Listing>(() =>
    ancestors ? { status: 'ready', entries: ancestors.map((a) => ({ name: a.label, kind: 'dir' as const, path: a.dir })) } : { status: 'loading' },
  );
  useFileIconVersion();
  const [pos, setPos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 2 };
  });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    if (dir === null) return;
    let live = true;
    setListing({ status: 'loading' });
    listRef.current(dir).then(
      (entries) => live && setListing({ status: 'ready', entries: [...entries].sort(byKindAndName) }),
      (err) => live && setListing({ status: 'error', message: errorMessage(errorOf(err)) }),
    );
    return () => {
      live = false;
    };
  }, [dir]);

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const { width } = el.getBoundingClientRect();
    setPos((p) => ({ ...p, x: Math.max(EDGE, Math.min(p.x, window.innerWidth - width - EDGE)) }));
    if (listing.status === 'loading') return;
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)'));
    (items.find((b) => b.classList.contains('current')) ?? items[0] ?? el).focus();
  }, [listing]);

  useEffect(() => {
    const inside = (target: EventTarget | null) => menu.current?.contains(target as Node) ?? false;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current(true);
    };
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target) && !bar?.contains(e.target as Node)) closeRef.current(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) closeRef.current(false);
    };
    const close = () => closeRef.current(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [bar]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') next = Math.max(idx, 0);
    else return;
    e.preventDefault();
    items[next]?.focus();
  };

  const parent = dir === null ? null : dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';

  return createPortal(
    <div ref={menu} className="context-menu breadcrumbs-menu" role="menu" tabIndex={-1} style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {parent !== null && dir !== start && (
        <button className="menu-item" role="menuitem" title={t('breadcrumbs.up')} onClick={() => setDir(parent)}>
          <span className="menu-icon"><Icon name="chevron-up" size={15} /></span>
          <span className="menu-label">..</span>
        </button>
      )}
      {listing.status === 'loading' && (
        <button title={t('common.loading')} className="menu-item" role="menuitem" disabled><span className="menu-icon" /><span className="menu-label">{t('common.loading')}</span></button>
      )}
      {listing.status === 'error' && (
        <button title={listing.message} className="menu-item danger" role="menuitem" disabled><span className="menu-icon"><Icon name="alert" size={15} /></span><span className="menu-label">{listing.message}</span></button>
      )}
      {listing.status === 'ready' && listing.entries.length === 0 && (
        <button title={t('breadcrumbs.empty')} className="menu-item" role="menuitem" disabled><span className="menu-icon" /><span className="menu-label">{t('breadcrumbs.empty')}</span></button>
      )}
      {listing.status === 'ready' && listing.entries.map((entry) => {
        const on = entry.path === current || current.startsWith(`${entry.path}/`);
        const { icon, tone } = entry.kind === 'dir' ? { icon: folderIconOf(entry.name), tone: undefined } : fileIconOf(entry.name);
        return (
          <button
            key={entry.path}
            className={`menu-item${on ? ' current' : ''}`}
            role="menuitem"
            aria-current={on ? 'true' : undefined}
            title={entry.path}
            onClick={() => {
              if (entry.kind === 'dir') {
                setDir(entry.path);
                return;
              }
              onClose(false);
              onPick(entry);
            }}
          >
            <span className={`menu-icon${tone ? ` tone-${tone}` : ''}`}><Icon name={icon} size={15} /></span>
            <span className="menu-label">{entry.name}</span>
            {entry.kind === 'dir' && <span className="menu-hint"><Icon name="chevron" size={12} /></span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
