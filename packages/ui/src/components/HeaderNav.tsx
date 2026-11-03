import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { t } from '../i18n';
import { useLayout } from '../layout';
import { ContextMenu } from './ContextMenu';
import type { NavItem, SidebarProps } from './Sidebar';
import { BrandMark, Icon, NavIcon } from './ui';

/**
 * The main menu as a header strip of screen tabs (`navPlacement: 'header'`): brand, tabs, then the
 * global tools (the sidebar `footer`). Labels only, or icons only with `mainMenu: 'icons'`; tabs
 * that do not fit move into a More menu.
 */
export function HeaderNav<Id extends string>({ name, sections, current, onSelect, footer, popped, poppedHint }: SidebarProps<Id>) {
  const { structure, mainMenu } = useLayout();
  const iconsOnly = mainMenu === 'icons';
  const items = sections.flatMap((s) => s.items);
  const strip = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(items.length);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const host = strip.current;
    const row = probe.current;
    if (!host || !row) return;
    const update = () => {
      const els = Array.from(row.children) as HTMLElement[];
      const more = els.pop();
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const widths = els.map((el) => el.getBoundingClientRect().width);
      const avail = host.clientWidth;
      const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
      if (total <= avail) return setFit(widths.length);
      let used = more?.getBoundingClientRect().width ?? 0;
      let n = 0;
      for (const w of widths) {
        if (used + gap + w > avail) break;
        used += gap + w;
        n++;
      }
      setFit(n);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    ro.observe(row);
    return () => ro.disconnect();
  }, [items.length, iconsOnly]);

  const shown = items.slice(0, fit);
  const hidden = items.slice(fit);
  const hiddenActive = hidden.some((i) => i.id === current);

  const tab = (item: NavItem<Id>, measure: boolean) => {
    const isPopped = popped?.has(item.id) ?? false;
    const base = item.hint ? `${item.label} (${item.hint})` : item.label;
    const title = isPopped && poppedHint ? `${base} - ${poppedHint}` : base;
    const active = current === item.id;
    return (
      <button
        key={item.id}
        className={`header-tab${active ? ' active' : ''}${isPopped ? ' popped' : ''}`}
        title={title}
        {...(measure ? { tabIndex: -1 } : { onClick: () => onSelect(item.id), 'aria-current': active ? ('page' as const) : undefined })}
        {...(iconsOnly ? { 'aria-label': title } : {})}
      >
        {iconsOnly ? <NavIcon viewId={item.id} name={item.icon} size={16} /> : <span className="header-tab-label">{item.label}</span>}
        {isPopped && (
          <span className="popped-mark">
            <Icon name="popout" size={iconsOnly ? 9 : 12} />
          </span>
        )}
      </button>
    );
  };
  const moreLabel = t('nav.more');
  const moreButton = (measure: boolean) => (
    <button
      className={`header-tab header-more${hiddenActive && !measure ? ' active' : ''}`}
      title={moreLabel}
      aria-haspopup="menu"
      {...(measure
        ? { tabIndex: -1 }
        : {
            'aria-expanded': menuAt !== null,
            onClick: (e: MouseEvent<HTMLButtonElement>) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt({ x: r.left, y: r.bottom });
            },
          })}
      {...(iconsOnly ? { 'aria-label': moreLabel } : {})}
    >
      {iconsOnly ? <Icon name="more" size={16} /> : <span className="header-tab-label">{moreLabel}</span>}
    </button>
  );

  return (
    <nav className={`header-nav${iconsOnly ? ' icons-only' : ''}`}>
      {structure.sidebarBrand && (
        <div className="header-brand">
          <BrandMark size={22} />
          <span>{name}</span>
        </div>
      )}
      <div className="header-tabs" ref={strip}>
        <div className="header-tabs-row">
          {shown.map((item) => tab(item, false))}
          {hidden.length > 0 && moreButton(false)}
        </div>
        <div className="header-tabs-row header-tabs-probe" ref={probe} aria-hidden="true">
          {items.map((item) => tab(item, true))}
          {moreButton(true)}
        </div>
      </div>
      {footer && <div className="header-tools">{footer}</div>}
      {menuAt && (
        <ContextMenu
          at={menuAt}
          onClose={() => setMenuAt(null)}
          items={hidden.map((item) => ({ id: item.id, label: item.label, icon: popped?.has(item.id) ? 'popout' : item.icon, hint: popped?.has(item.id) && poppedHint ? poppedHint : item.hint, radio: true, checked: current === item.id, run: () => onSelect(item.id) }))}
        />
      )}
    </nav>
  );
}
