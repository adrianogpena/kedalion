import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { t, type BaseKey } from '../i18n';
import { effectiveKeys, type CommandDef } from '../keybindings';
import {
  MAX_PANES,
  activate,
  activeTab,
  addTab,
  closeTab,
  closeTabs,
  cycleTab,
  distinguishingFolders,
  findTab,
  goBack,
  goForward,
  moveTab,
  navigate,
  newTab,
  pinTab,
  selectIndex,
  setDirty,
  tabsToClose,
  layoutTree,
  resizeSplit,
  splitPane,
  type CloseMode,
  type Layout,
  type Pane,
  type SplitNode,
  type Tab,
} from '../tabs';
import { useLayout } from '../layout';
import { IconButton } from './Button';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { useCommand, useKeybindings, withChord } from './Keybindings';
import { SplitView } from './SplitView';
import { Icon, type IconName, type Tone, useDialogs } from './ui';

const DRAG_TYPE = 'application/x-kedalion-tab';

export interface TabTitle {
  title: string;
  tooltip?: string;
  icon?: IconName;
  tone?: Tone;
  /** The folder of the tab's item, `/`-separated: shown dimmed after the title when another tab of the pane has the same title. */
  location?: string;
}

/**
 * An action of a tab's content, shown in its pane's tab bar while the tab is the active one:
 * `primary` ones as icon buttons right of the tabs, `menu` ones in the "…" menu.
 */
export interface TabAction {
  id: string;
  label: string;
  group: 'primary' | 'menu';
  icon?: IconName;
  /** The shortcut, shown in the tooltip or the menu. */
  hint?: string;
  /** A toggle (radio with `radio`): pressed icon, or check/dot in the menu. */
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  /** Menu actions of different sections are separated by a line. */
  section?: string;
  /** A `primary` action with options is a compact dropdown with `value` selected; `run` gets the chosen value. */
  options?: Array<{ value: string; label: string }>;
  value?: string;
  run(value?: string): void;
}

const actionKey = (list: TabAction[]) =>
  list
    .map((a) => [a.id, a.label, a.group, a.icon, a.hint, a.checked, a.radio, a.disabled, a.section, a.value, a.options?.map((o) => `${o.value}=${o.label}`).join('\u0003')].join('\u0001'))
    .join('\u0002');

const withHint = withChord;

export interface TabBarProps<R> {
  pane: Pane<R>;
  focused: boolean;
  canSplit: boolean;
  canClosePane: boolean;
  titleOf: (route: R) => TabTitle;
  menuOf?: (route: R, tab: Tab<R>) => Array<ContextMenuItem | 'sep'>;
  /** Items of the chevron menu beside "+" (also on right-click of "+"); no chevron when unset. */
  newMenu?: (paneId: string) => Array<ContextMenuItem | 'sep'>;
  /** Called first on a tab double-click; returning true skips the default pin/maximize. */
  onTabDoubleClick?: (tab: Tab<R>) => boolean;
  /** Each new value opens the `newMenu` at this pane's "+" button (a shortcut). */
  newMenuRequest?: number;
  /** Actions of the active tab. */
  actions: TabAction[];
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseMode: (tabId: string, mode: CloseMode) => void;
  onPin: (tabId: string) => void;
  onNew: () => void;
  onSplit: (side: 'right' | 'down') => void;
  onClosePane: () => void;
  /** Whether this pane is maximized (the tree and the other panes hidden). */
  maximized: boolean;
  onToggleMaximize: () => void;
  /** Effective key of the maximize command, for the menu. */
  maximizeHint?: string;
  onBack: () => void;
  onForward: () => void;
  onDropTab: (tabId: string, index: number) => void;
}

export function BaseTabBar<R>(props: TabBarProps<R>) {
  const { pane, focused, titleOf } = props;
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'> } | null>(null);
  const active = pane.tabs.find((x) => x.id === pane.active) ?? pane.tabs[0];
  const titles = pane.tabs.map((tab) => titleOf(tab.route));
  const folders = distinguishingFolders(titles);
  const newButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = newButton.current;
    if (!props.newMenuRequest || !props.newMenu || !el) return;
    const r = el.getBoundingClientRect();
    setMenu({ at: { x: r.left, y: r.bottom }, items: props.newMenu(pane.id) });
  }, [props.newMenuRequest]);

  const menuItems = (tab: Tab<R>, i: number): Array<ContextMenuItem | 'sep'> => {
    const closing: ContextMenuItem[] = [
      { id: 'close', label: t('tabs.menu.close'), run: () => props.onClose(tab.id) },
      { id: 'closeOthers', label: t('tabs.menu.closeOthers'), disabled: pane.tabs.length < 2, run: () => props.onCloseMode(tab.id, 'others') },
      { id: 'closeRight', label: t('tabs.menu.closeRight'), disabled: i === pane.tabs.length - 1, run: () => props.onCloseMode(tab.id, 'right') },
      { id: 'closeSaved', label: t('tabs.menu.closeSaved'), disabled: pane.tabs.every((x) => x.dirty), run: () => props.onCloseMode(tab.id, 'saved') },
      { id: 'closeAll', label: t('tabs.menu.closeAll'), run: () => props.onCloseMode(tab.id, 'all') },
    ];
    const extra = props.menuOf?.(tab.route, tab) ?? [];
    return extra.length ? [...closing, 'sep', ...extra] : closing;
  };

  /** The "…" menu: the active tab's menu actions, then the pane's own. */
  const moreItems = (): Array<ContextMenuItem | 'sep'> => {
    const items: Array<ContextMenuItem | 'sep'> = [];
    let section: string | undefined;
    for (const a of props.actions.filter((x) => x.group === 'menu')) {
      if (items.length && a.section !== section) items.push('sep');
      section = a.section;
      items.push({ id: a.id, label: a.label, icon: a.icon, hint: a.hint, checked: a.checked, radio: a.radio, disabled: a.disabled, run: () => a.run() });
    }
    if (items.length) items.push('sep');
    items.push(
      { id: 'splitRight', label: t('tabs.splitRight'), icon: 'split', disabled: !props.canSplit, run: () => props.onSplit('right') },
      { id: 'splitDown', label: t('tabs.splitDown'), icon: 'split-down', disabled: !props.canSplit, run: () => props.onSplit('down') },
    );
    items.push({ id: 'maximize', label: t('tabs.maximize'), hint: props.maximizeHint, checked: props.maximized, run: props.onToggleMaximize });
    if (props.canClosePane) items.push({ id: 'closePane', label: t('tabs.closePane'), run: props.onClosePane });
    return items;
  };
  const hasHistory = Boolean(active?.back.length || active?.forward.length);

  const onDragOver = (e: DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt(index);
  };

  const onDrop = (e: DragEvent, index: number) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    setDropAt(null);
    if (id) {
      e.preventDefault();
      props.onDropTab(id, index);
    }
  };

  return (
    <div
      className={`tabbar${focused ? ' focused' : ''}`}
      onDragOver={(e) => onDragOver(e, pane.tabs.length)}
      onDragLeave={() => setDropAt(null)}
      onDrop={(e) => onDrop(e, pane.tabs.length)}
    >
      {hasHistory && (
        <div className="tabbar-tools">
          <IconButton icon="back" label={t('tabs.back')} onClick={props.onBack} disabled={!active?.back.length} />
          <IconButton icon="forward" label={t('tabs.forward')} onClick={props.onForward} disabled={!active?.forward.length} />
        </div>
      )}
      <div className="tabs-strip" role="tablist">
        {pane.tabs.map((tab, i) => {
          const { title, tooltip, icon, tone } = titles[i];
          const folder = folders[i];
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === pane.active}
              className={`tab-chip${tab.id === pane.active ? ' active' : ''}${tab.preview ? ' preview' : ''}${tab.dirty ? ' dirty' : ''}${dropAt === i ? ' drop-before' : ''}`}
              title={tooltip ?? title}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.stopPropagation();
                onDragOver(e, i);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, i);
              }}
              onClick={() => props.onActivate(tab.id)}
              onDoubleClick={() => {
                if (props.onTabDoubleClick?.(tab)) return;
                if (tab.preview) props.onPin(tab.id);
                else props.onToggleMaximize();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, items: menuItems(tab, i) });
              }}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && props.onClose(tab.id)}
            >
              {icon && (
                  <span className={`tab-icon${tone ? ` tone-${tone}` : ''}`}>
                    <Icon name={icon} size={13} />
                  </span>
                )}
                <span className="tab-title">
                  {title}
                  {folder && <span className="tab-dir">{folder}</span>}
                </span>
              <button
                className="tab-close"
                title={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                {tab.dirty && <span className="tab-dot" title={t('tabs.unsaved')} aria-label={t('tabs.unsaved')}>●</span>}
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
        <IconButton
          ref={newButton}
          icon="plus"
          label={t('tabs.new')}
          className="tab-new"
          onClick={props.onNew}
          onContextMenu={(e) => {
            if (!props.newMenu) return;
            e.preventDefault();
            setMenu({ at: { x: e.clientX, y: e.clientY }, items: props.newMenu(pane.id) });
          }}
        />
        {props.newMenu && (
          <IconButton
            icon="chevron-down"
            label={t('tabs.newMenu')}
            className="tab-new-menu"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ at: { x: r.left, y: r.bottom }, items: props.newMenu!(pane.id) });
            }}
          />
        )}
      </div>
      <div className="tabbar-tools">
        {props.actions.filter((a) => a.group === 'primary').map((a) => a.options ? (
          <select
            key={a.id}
            className="tabbar-select"
            value={a.value ?? ''}
            onChange={(e) => a.run(e.target.value)}
            disabled={a.disabled}
            title={withHint(a.label, a.hint)}
            aria-label={a.label}
          >
            {a.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <IconButton
            key={a.id}
            icon={a.icon ?? 'more'}
            label={a.label}
            title={withHint(a.label, a.hint)}
            pressed={a.checked}
            onClick={() => a.run()}
            disabled={a.disabled}
          />
        ))}
        {props.actions.some((a) => a.group === 'primary') && <span className="tabbar-sep" />}
        <IconButton
          icon="split"
          label={t('tabs.splitRight')}
          title={t('tabs.split')}
          onClick={(e) => props.onSplit(e.altKey ? 'down' : 'right')}
          disabled={!props.canSplit}
          data-split-right
        />
        <IconButton
          icon="more"
          label={t('tabs.more')}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ at: { x: r.right, y: r.bottom + 2 }, items: moreItems() });
          }}
        />
      </div>
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Commands of a tab workspace shown in view `scope`: Alt+1..9 select a tab of the focused pane;
 * Ctrl+T, Ctrl+W and Ctrl+Tab / Ctrl+Shift+Tab only in the native window (Edge and Chrome keep
 * them in browser and app mode). Ctrl+K S saves every tab with unsaved changes, Ctrl+K Ctrl+M
 * maximizes the focused pane.
 */
export function tabCommands(scope: string): CommandDef[] {
  const desktop = (name: string, key: string): CommandDef => ({ id: `${scope}.tab.${name}`, scope, label: t(`keys.tab.${name}` as BaseKey), keys: [key], desktopOnly: true });
  return [
    desktop('new', 'Ctrl+T'),
    desktop('close', 'Ctrl+W'),
    desktop('next', 'Ctrl+Tab'),
    desktop('prev', 'Ctrl+Shift+Tab'),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `${scope}.tab.select${i + 1}`, scope, label: t('keys.tab.select', { n: i + 1 }), keys: [`Alt+${i + 1}`] })),
    { id: `${scope}.tab.saveAll`, scope, label: t('keys.tab.saveAll'), keys: ['Ctrl+K S'] },
    { id: `${scope}.pane.maximize`, scope, label: t('keys.pane.maximize'), keys: ['Ctrl+K Ctrl+M'] },
  ];
}

/**
 * Binds `tabCommands(scope)` to the layout. `TabWorkspace` installs these itself; call this only
 * for a layout shown another way. `onClose` replaces the plain close of Ctrl+W (to ask about unsaved
 * changes first); Save All is bound by `TabWorkspace` only.
 */
export function useTabKeys<R>(layout: Layout<R>, onChange: (next: Layout<R>) => void, newRoute: () => R, scope: string, onClose?: (tabId: string) => void) {
  const [add, close, next, prev, ...rest] = tabCommands(scope);
  const select = rest.slice(0, 9);
  useCommand(add, () => onChange(addTab(layout, newTab(newRoute()))));
  useCommand(close, () => (onClose ? onClose(activeTab(layout).id) : onChange(closeTab(layout, activeTab(layout).id, () => newTab(newRoute())))));
  useCommand(next, () => onChange(cycleTab(layout, 1)));
  useCommand(prev, () => onChange(cycleTab(layout, -1)));
  // Always nine, so the hook order is fixed.
  for (let i = 0; i < select.length; i++) useCommand(select[i], () => onChange(selectIndex(layout, i)));
}

export interface TabContext<R> {
  /** The tab is the selected one of its pane. */
  visible: boolean;
  /** The tab is selected and its pane has the focus. */
  focused: boolean;
  /** Shows another route in this tab; the previous one stays reachable with Back. */
  navigate: (route: R) => void;
  /** Reports whether the tab has unsaved changes; closing it then asks Save / Don't Save / Cancel. */
  setDirty: (dirty: boolean) => void;
  /** Registers what saves the tab (resolves true when it is saved or had nothing to save); Save All and the close dialog call it. */
  setSaver: (save: (() => Promise<boolean>) | undefined) => void;
  /** Sets the tab's actions in the tab bar (see `TabAction`); cheap to call on every render. */
  setActions: (actions: TabAction[]) => void;
}

interface TabWorkspaceProps<R> {
  layout: Layout<R>;
  onChange: (next: Layout<R>) => void;
  /** Every tab of every pane stays mounted; hidden ones keep their state. */
  renderTab: (tab: Tab<R>, ctx: TabContext<R>) => ReactNode;
  titleOf: (route: R) => TabTitle;
  /** Context menu of a tab; none when it returns no items. */
  menuOf?: (route: R, tab: Tab<R>) => Array<ContextMenuItem | 'sep'>;
  /** Items of the chevron menu beside each pane's "+" button (also on right-click of "+"). */
  newMenu?: (paneId: string) => Array<ContextMenuItem | 'sep'>;
  /** Called first on a tab double-click; returning true skips the default pin/maximize. */
  onTabDoubleClick?: (tab: Tab<R>) => boolean;
  /** Each new `n` opens the `newMenu` at pane `pane`'s "+" button (e.g. from a shortcut). */
  newMenuRequest?: { pane: string; n: number };
  /** The route of a tab opened with the "+" button or Ctrl+T, and of the tab that replaces the last one closed. */
  newRoute: () => R;
  /** The view id the tab shortcuts belong to (see `tabCommands`). */
  scope: string;
  /** Told when a pane is maximized or restored, so the app can hide its own side views too. */
  onMaximizedChange?: (maximized: boolean) => void;
  /** Ask before closing tabs with unsaved changes (default); when false they are saved first and kept open if a save fails. */
  confirmCloseDirty?: boolean;
  /** Asked before closing tabs, before the unsaved-changes dialog; false keeps them all open. */
  confirmClose?: (tabs: Tab<R>[]) => Promise<boolean>;
}

export function TabWorkspace<R>({ layout, onChange, renderTab, titleOf, menuOf, newMenu, onTabDoubleClick, newMenuRequest, newRoute, scope, onMaximizedChange, confirmCloseDirty = true, confirmClose }: TabWorkspaceProps<R>) {
  const { choose, element } = useDialogs();
  const savers = useRef(new Map<string, () => Promise<boolean>>());
  // The latest list per tab (fresh `run`s); the bar re-renders only when what it shows changes.
  const actions = useRef(new Map<string, { list: TabAction[]; key: string }>());
  const [, setActionsVersion] = useState(0);
  const setActions = (tabId: string, list: TabAction[]) => {
    const key = actionKey(list);
    const changed = (actions.current.get(tabId)?.key ?? '') !== key;
    if (list.length) actions.current.set(tabId, { list, key });
    else actions.current.delete(tabId);
    if (changed) setActionsVersion((n) => n + 1);
  };

  // Handlers read the layout of the latest change, so two changes in one tick don't overwrite each other.
  const latest = useRef(layout);
  latest.current = layout;
  const update = (fn: (l: Layout<R>) => Layout<R>) => {
    const next = fn(latest.current);
    latest.current = next;
    onChange(next);
  };
  const fresh = () => newTab(newRoute());

  /** Saves the tabs one after another; false as soon as one fails (its own banner says why). */
  const saveTabs = async (tabIds: string[]) => {
    for (const id of tabIds) {
      if (!(await savers.current.get(id)?.())) return false;
    }
    return true;
  };
  const saveAll = () => void saveTabs(latest.current.panes.flatMap((p) => p.tabs.filter((x) => x.dirty).map((x) => x.id)));

  /** Closes the tabs, first asking once about the ones with unsaved changes; Cancel or a failed save keeps them all open. */
  const closeMany = async (tabIds: string[]) => {
    if (confirmClose) {
      const tabs = tabIds.flatMap((id) => findTab(latest.current, id) ?? []);
      if (tabs.length && !(await confirmClose(tabs))) return;
    }
    const dirty = tabIds.flatMap((id) => {
      const tab = findTab(latest.current, id);
      return tab?.dirty ? [tab] : [];
    });
    if (dirty.length && !confirmCloseDirty) {
      if (!(await saveTabs(dirty.map((x) => x.id)))) return;
    } else if (dirty.length) {
      const choice = await choose({
        title: t('tabs.unsavedTitle'),
        body: dirty.length === 1 ? t('tabs.unsavedOne', { name: titleOf(dirty[0].route).title }) : t('tabs.unsavedMany', { count: dirty.length }),
        choices: [
          { id: 'save', label: t('tabs.save') },
          { id: 'discard', label: t('tabs.dontSave'), danger: true },
        ],
      });
      if (!choice) return;
      if (choice === 'save' && !(await saveTabs(dirty.map((x) => x.id)))) return;
    }
    update((l) => closeTabs(l, tabIds.filter((id) => findTab(l, id)), fresh));
  };
  const closeById = (tabId: string) => void closeMany([tabId]);
  const closeMode = (tabId: string, mode: CloseMode) => void closeMany(tabsToClose(latest.current, tabId, mode).map((x) => x.id));

  // Maximize pane, like VS Code's maximize editor group: the other panes stay mounted, only hidden.
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const maximized = maximizedId && layout.panes.some((p) => p.id === maximizedId) ? maximizedId : null;
  const toggleMaximize = (paneId: string) => setMaximizedId(maximized ? null : paneId);
  const onMaximized = useRef(onMaximizedChange);
  onMaximized.current = onMaximizedChange;
  useEffect(() => onMaximized.current?.(maximized !== null), [maximized]);
  useEffect(() => () => onMaximized.current?.(false), []);

  const commands = tabCommands(scope);
  const command = (name: string) => commands.find((d) => d.id === `${scope}.${name}`)!;
  const keys = useKeybindings();
  const { navParts, structure } = useLayout();
  const TabBar = navParts.TabBar;
  const barBottom = structure.tabBarPosition === 'bottom';
  const maximizeHint = keys ? effectiveKeys(keys.defs, keys.keymap).get(`${scope}.pane.maximize`)?.[0] : undefined;
  useTabKeys(layout, onChange, newRoute, scope, closeById);
  useCommand(command('tab.saveAll'), saveAll);
  useCommand(command('pane.maximize'), () => toggleMaximize(layout.focused));

  const renderPane = (pane: Pane<R>) => {
    const paneFocused = pane.id === layout.focused;
    const activeId = pane.tabs.some((x) => x.id === pane.active) ? pane.active : pane.tabs[0]?.id;
    const bar = (
        <TabBar
          pane={pane}
          focused={paneFocused}
          canSplit={layout.panes.length < MAX_PANES}
          canClosePane={layout.panes.length > 1}
          titleOf={titleOf}
          menuOf={menuOf}
          newMenu={newMenu}
          onTabDoubleClick={onTabDoubleClick}
          newMenuRequest={newMenuRequest?.pane === pane.id ? newMenuRequest.n : undefined}
          actions={(activeId && actions.current.get(activeId)?.list) || []}
          onActivate={(tabId) => update((l) => activate(l, pane.id, tabId))}
          onClose={closeById}
          onCloseMode={closeMode}
          onPin={(tabId) => update((l) => pinTab(l, tabId))}
          onNew={() => update((l) => addTab(l, fresh(), pane.id))}
          onSplit={(side) => update((l) => splitPane(l, activeId, side))}
          onClosePane={() => void closeMany(pane.tabs.map((x) => x.id))}
          maximized={pane.id === maximized}
          onToggleMaximize={() => toggleMaximize(pane.id)}
          maximizeHint={maximizeHint}
          onBack={() => update((l) => goBack(l, activeId))}
          onForward={() => update((l) => goForward(l, activeId))}
          onDropTab={(tabId, index) =>
            update((l) => {
              // Dropping later in the same pane: the index counts the tab being moved.
              const from = pane.tabs.findIndex((x) => x.id === tabId);
              return moveTab(l, tabId, pane.id, from >= 0 && from < index ? index - 1 : index);
            })
          }
        />
    );
    return (
      <section
        key={pane.id}
        className={`pane${paneFocused && layout.panes.length > 1 && !maximized ? ' focused' : ''}${pane.id === maximized ? ' maximized' : ''}${barBottom ? ' tabbar-bottom' : ''}`}
        onMouseDownCapture={() => !paneFocused && update((l) => ({ ...l, focused: pane.id }))}
      >
        {!barBottom && bar}
        <div className="pane-body">
          {pane.tabs.map((tab) => {
            const visible = tab.id === activeId;
            return (
              <div key={tab.id} className={`tab-view${visible ? '' : ' hidden'}`} role="tabpanel">
                {renderTab(tab, {
                  visible,
                  focused: visible && paneFocused,
                  navigate: (route) => update((l) => (findTab(l, tab.id) ? navigate(l, tab.id, route) : l)),
                  setDirty: (dirty) => Boolean(findTab(latest.current, tab.id)?.dirty) !== dirty && update((l) => setDirty(l, tab.id, dirty)),
                  setSaver: (save) => {
                    if (save) savers.current.set(tab.id, save);
                    else savers.current.delete(tab.id);
                  },
                  setActions: (list) => setActions(tab.id, list),
                })}
              </div>
            );
          })}
        </div>
        {barBottom && bar}
      </section>
    );
  };

  const paneById = new Map(layout.panes.map((p) => [p.id, p]));
  const renderNode = (node: SplitNode, path: number[]): ReactNode => {
    if ('pane' in node) {
      const pane = paneById.get(node.pane);
      return pane ? renderPane(pane) : null;
    }
    return (
      <SplitView
        key={path.length ? `split:${firstPane(node)}` : 'root'}
        direction={node.dir}
        sizes={node.sizes}
        min={node.children.map(() => PANE_MIN_PX)}
        onResize={(sizes) => update((l) => resizeSplit(l, path, sizes))}
      >
        {node.children.map((child, i) => renderNode(child, [...path, i]))}
      </SplitView>
    );
  };

  // A single pane still sits in the root SplitView, so splitting it keeps it mounted.
  const tree = layoutTree(layout);
  return (
    <div className={`panes${maximized ? ' has-maximized' : ''}`}>
      {element}
      {'pane' in tree ? (
        <SplitView key="root" direction="row" sizes={[1]} onResize={() => {}}>
          {renderNode(tree, [])}
        </SplitView>
      ) : (
        renderNode(tree, [])
      )}
    </div>
  );
}

const PANE_MIN_PX = 160;

const firstPane = (node: SplitNode): string => ('pane' in node ? node.pane : firstPane(node.children[0]));
