import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { applyDockSide, applyMainMenu, resolveIconSetId, resolveLayout, supportsDock, type Layout, type LayoutStructure, type MainMenu } from '@kedalion/server-core/layouts';
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
  /** The effective structure: the layout's own with `mainMenu` applied. */
  structure: LayoutStructure;
  mainMenu: MainMenu;
  iconSet: string;
  shell: ShellComponents;
}

type Base = Pick<LayoutContext, 'layout' | 'iconSet' | 'mainMenu'> & { dock?: 'left' | 'right' };

const original = resolveLayout();
const Ctx = createContext<Base>({ layout: original, iconSet: resolveIconSetId(original), mainMenu: 'labels' });

export function LayoutProvider({ layout, icons, mainMenu = 'labels', dock, children }: { layout?: string; icons?: string; mainMenu?: MainMenu; dock?: 'left' | 'right'; children: ReactNode }) {
  const resolved = resolveLayout(layout);
  const iconSet = resolveIconSetId(resolved, icons);
  useLayoutEffect(() => setFileIconVariants(Object.keys(iconSetById(iconSet).fileVariants ?? {})), [iconSet]);
  const value = useMemo(() => ({ layout: resolved, iconSet, mainMenu, dock }), [resolved, iconSet, mainMenu, dock]);
  const side = supportsDock(resolved.id) ? applyDockSide(resolved.structure, dock).sidebarSide : 'left';
  useEffect(() => {
    document.documentElement.dataset.dock = side;
  }, [side]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLayout(): LayoutContext {
  const { layout, iconSet, mainMenu, dock } = useContext(Ctx);
  return useMemo(() => {
    const parts = SHELLS[layout.id] ?? {};
    const shell: ShellComponents = {
      Frame: parts.Frame ?? BaseAppFrame,
      Sidebar: parts.Sidebar ?? BaseSidebar,
      TabBar: parts.TabBar ?? BaseTabBar,
      StatusBar: parts.StatusBar ?? BaseStatusBar,
    };
    return { layout, structure: applyMainMenu(supportsDock(layout.id) ? applyDockSide(layout.structure, dock) : layout.structure, mainMenu), mainMenu, iconSet, shell };
  }, [layout, iconSet, mainMenu, dock]);
}
