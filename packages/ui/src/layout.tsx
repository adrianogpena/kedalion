import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { legacyLayoutId, resolveLayout, resolveLayouts, supportsDock, type Layout, type LayoutsSetting, type LayoutStructure, type MainMenu, type ResolvedLayouts } from '@kedalion/server-core/layouts';
import { setFileIconVariants } from './file-icons';
import { iconSetById } from './icons';
import { AtlasAppFrame, BaseAppFrame, IslandsAppFrame, type AppFrameProps } from './components/AppFrame';
import { AtlasSidebar, BaseSidebar, type SidebarProps } from './components/Sidebar';
import { BaseStatusBar, IslandsStatusBar, ModelineStatusBar, type StatusBarProps } from './components/StatusBar';
import { BaseTabBar, type TabBarProps } from './components/TabWorkspace';

export interface ShellComponents {
  Frame: ComponentType<AppFrameProps>;
  Sidebar: <Id extends string>(props: SidebarProps<Id>) => ReactNode;
  TabBar: <R>(props: TabBarProps<R>) => ReactNode;
  StatusBar: ComponentType<StatusBarProps>;
}

const SHELLS: Record<string, Partial<ShellComponents>> = {};

/** Swaps shell parts for a layout id; slots left out keep the base components. */
export function registerShell(layoutId: string, parts: Partial<ShellComponents>): void {
  SHELLS[layoutId] = { ...SHELLS[layoutId], ...parts };
}

registerShell('islands', { Frame: IslandsAppFrame, StatusBar: IslandsStatusBar });
registerShell('modeline', { StatusBar: ModelineStatusBar });
registerShell('atlas', { Frame: AtlasAppFrame, Sidebar: AtlasSidebar });

export interface LayoutContext {
  layout: Layout;
  /** The effective structure of the resolved layouts setting. */
  structure: LayoutStructure;
  mainMenu: MainMenu;
  iconSet: string;
  shell: ShellComponents;
  resolved: ResolvedLayouts;
}

type Base = Pick<LayoutContext, 'layout' | 'iconSet' | 'mainMenu' | 'resolved'>;

const defaultResolved = resolveLayouts();
const Ctx = createContext<Base>({ layout: resolveLayout(legacyLayoutId(defaultResolved)), iconSet: defaultResolved.icons, mainMenu: 'labels', resolved: defaultResolved });

export function LayoutProvider({ layouts, icons, children }: { layouts?: LayoutsSetting; icons?: string; children: ReactNode }) {
  const resolved = useMemo(() => resolveLayouts(layouts, icons), [layouts, icons]);
  const iconSet = resolved.icons;
  const layout = useMemo(() => resolveLayout(legacyLayoutId(resolved)), [resolved]);
  const mainMenu: MainMenu = resolved.nav.labels ? 'labels' : 'icons';
  useLayoutEffect(() => setFileIconVariants(Object.keys(iconSetById(iconSet).fileVariants ?? {})), [iconSet]);
  const value = useMemo(() => ({ layout, iconSet, mainMenu, resolved }), [layout, iconSet, mainMenu, resolved]);
  const side = supportsDock(layout.id) ? resolved.nav.dock : 'left';
  useEffect(() => {
    document.documentElement.dataset.dock = side;
  }, [side]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLayout(): LayoutContext {
  const { layout, iconSet, mainMenu, resolved } = useContext(Ctx);
  return useMemo(() => {
    const parts = SHELLS[layout.id] ?? {};
    const shell: ShellComponents = {
      Frame: parts.Frame ?? BaseAppFrame,
      Sidebar: parts.Sidebar ?? BaseSidebar,
      TabBar: parts.TabBar ?? BaseTabBar,
      StatusBar: parts.StatusBar ?? BaseStatusBar,
    };
    return { layout, structure: resolved.structure, mainMenu, iconSet, shell, resolved };
  }, [layout, iconSet, mainMenu, resolved]);
}
