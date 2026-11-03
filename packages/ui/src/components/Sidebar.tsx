import { useEffect, type ReactNode } from 'react';
import { useLayout } from '../layout';
import { t } from '../i18n';
import { IconButton } from './Button';
import { HeaderNav } from './HeaderNav';
import { BrandMark, Icon, NavIcon, type IconName } from './ui';

export interface NavItem<Id extends string = string> {
  id: Id;
  /** Display text (already translated). */
  label: string;
  icon: IconName;
  /** Shown in the row's tooltip, e.g. the keyboard shortcut. */
  hint?: string;
}

export interface NavSection<Id extends string = string> {
  title: string;
  items: NavItem<Id>[];
}

export interface SidebarProps<Id extends string> {
  /** App name next to the brand mark. */
  name: string;
  sections: NavSection<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  /** Global controls pinned to the bottom. */
  footer?: ReactNode;
  /** Shows only the icons; the app owns the state. */
  collapsed?: boolean;
  /** With this, a toggle button sits in the footer. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Title of the toggle button (already translated, with its shortcut). */
  toggleLabel?: string;
  /** Items shown in their own pop-out window: marked, still selectable. */
  popped?: ReadonlySet<Id>;
  /** Tooltip text added to popped items (already translated). */
  poppedHint?: string;
}

export function Sidebar<Id extends string>(props: SidebarProps<Id>) {
  const { structure, navParts } = useLayout();
  if (structure.navPlacement === 'header') return <HeaderNav {...props} />;
  const Shell = navParts.Sidebar;
  return <Shell {...props} />;
}

/** Number of line colours a layout can key on (`data-line` 1..LINE_COUNT, cycling through the nav order). */
export const LINE_COUNT = 7;

/** Line of the nav item at flat position `index` (0-based). */
export const lineOf = (index: number) => (index % LINE_COUNT) + 1;

export function BaseSidebar<Id extends string>({ name, sections, current, onSelect, footer: footerProp, collapsed: collapsedProp, onCollapsedChange, toggleLabel, popped, poppedHint }: SidebarProps<Id>) {
  const { structure } = useLayout();
  const collapsed = collapsedProp ?? structure.sidebarMode === 'collapsed';
  const footer = structure.navFooter === 'none' ? undefined : footerProp;
  const ids = useScreenHooks(sections, current);
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {structure.sidebarBrand && (
        <div className="brand">
          <BrandMark />
          {!collapsed && <span>{name}</span>}
        </div>
      )}
      <div className="side-scroll">
        {sections.map((section) => (
          <div key={section.title} className="side-section">
            {!collapsed && <div className="side-title">{section.title}</div>}
            {section.items.map((item) => {
              const isPopped = popped?.has(item.id) ?? false;
              const base = item.hint ? `${item.label} (${item.hint})` : item.label;
              const title = isPopped && poppedHint ? `${base} - ${poppedHint}` : base;
              return (
                <button
                  key={item.id}
                  className={`side-item${current === item.id ? ' active' : ''}${isPopped ? ' popped' : ''}`}
                  data-line={lineOf(ids.indexOf(item.id))}
                  onClick={() => onSelect(item.id)}
                  title={title}
                  {...(collapsed ? { 'aria-label': title } : {})}
                >
                  <NavIcon viewId={item.id} name={item.icon} size={14} />
                  {!collapsed && <span className="side-label">{item.label}</span>}
                  {isPopped && (
                    <span className="popped-mark">
                      <Icon name="popout" size={collapsed ? 9 : 12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {(footer || onCollapsedChange) && (
        <div className="side-footer">
          {footer}
          {onCollapsedChange && (
            <IconButton icon="sidebar" label={toggleLabel ?? t('explorer.toggleSidebar')} className="side-toggle" pressed={collapsed} onClick={() => onCollapsedChange(!collapsed)} />
          )}
        </div>
      )}
    </nav>
  );
}

/** Screen hooks on <html> for layouts that style per screen (e.g. a per-screen accent); returns the flat nav ids. */
export function useScreenHooks<Id extends string>(sections: NavSection<Id>[], current: Id): Id[] {
  const ids = sections.flatMap((s) => s.items.map((i) => i.id));
  const currentLine = ids.indexOf(current);
  const currentLabel = sections.flatMap((s) => s.items).find((i) => i.id === current)?.label;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.screen = current;
    if (currentLine >= 0) root.dataset.line = String(lineOf(currentLine));
    else delete root.dataset.line;
    if (currentLabel) root.dataset.screenLabel = currentLabel;
    else delete root.dataset.screenLabel;
  }, [current, currentLine, currentLabel]);
  return ids;
}

/** Atlas groups the nav by what it works on; ids not listed join the last group, in their order. */
const ATLAS_GROUPS: Array<{ title: 'atlas.nav.files' | 'atlas.nav.tools'; ids: string[] }> = [
  { title: 'atlas.nav.files', ids: ['explorer', 'git'] },
  { title: 'atlas.nav.tools', ids: ['workbench', 'rest', 'terminal'] },
];

/** Atlas: the base sidebar with the app's items regrouped into labelled Files / Tools sections. */
export function AtlasSidebar<Id extends string>(props: SidebarProps<Id>) {
  const items = props.sections.flatMap((s) => s.items);
  const listed = new Set(ATLAS_GROUPS.flatMap((g) => g.ids));
  const sections = ATLAS_GROUPS.map((g, i) => ({
    title: t(g.title),
    items: [
      ...g.ids.flatMap((id) => items.filter((item) => item.id === id)),
      ...(i === ATLAS_GROUPS.length - 1 ? items.filter((item) => !listed.has(item.id)) : []),
    ],
  })).filter((s) => s.items.length > 0);
  return <BaseSidebar {...props} sections={sections} />;
}
