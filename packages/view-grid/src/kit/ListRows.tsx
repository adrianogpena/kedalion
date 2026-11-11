import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { ContextMenu } from '@kedalion/ui';
import './kit.css';

type MenuItems = ComponentProps<typeof ContextMenu>['items'];

export interface ListRow {
  id: string;
  title: string;
  href?: string;
  /** Leading chip, e.g. a `Chip`. */
  chip?: ReactNode;
  /** Small parts after the title, joined by a separator. */
  meta?: readonly string[];
  /** Status chips between the title block and `trailing`. */
  status?: ReactNode;
  trailing?: string;
  selected?: boolean;
  onClick?(): void;
  /** Right-click menu items; without them a row with an http `href` gets the app's link menu. */
  menu?(): MenuItems;
}

/** Compact rows that scroll inside the panel; `empty` shows when there are none. */
export function ListRows({ rows, empty }: { rows: readonly ListRow[]; empty: string }) {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItems } | null>(null);
  if (rows.length === 0) return <p className="kit-empty">{empty}</p>;
  return (
    <ul className="kit-rows">
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      {rows.map((r) => (
        <li
          key={r.id}
          className={`kit-row${r.onClick ? ' kit-row--click' : ''}${r.selected ? ' kit-row--selected' : ''}`}
          data-context-link={!r.menu && r.href && /^https?:/i.test(r.href) ? r.href : undefined}
          onContextMenu={
            r.menu &&
            ((e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ at: { x: e.clientX, y: e.clientY }, items: r.menu!() });
            })
          }
          {...(r.onClick
            ? {
                tabIndex: 0,
                role: 'button',
                'aria-pressed': !!r.selected,
                onClick: r.onClick,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    r.onClick?.();
                  }
                },
              }
            : {})}
        >
          {r.chip}
          <span className="kit-row-main">
            {r.href && /^https?:/i.test(r.href) ? (
              <a className="kit-row-title" href={r.href} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a>
            ) : (
              <span className="kit-row-title" title={r.title}>{r.title}</span>
            )}
            {r.meta && r.meta.length > 0 && <span className="kit-row-meta">{r.meta.join(' · ')}</span>}
          </span>
          {r.status}
          {r.trailing &&<span className="kit-row-trailing">{r.trailing}</span>}
        </li>
      ))}
    </ul>
  );
}
