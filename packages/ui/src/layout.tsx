import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { legacyLayoutId, resolveLayout, resolveLayouts, supportsDock, type Layout, type LayoutsSetting, type LayoutStructure, type MainMenu, type NavigationId, type ResolvedLayouts, type SkinId } from '@kedalion/server-core/layouts';
import { setFileIconVariants } from './file-icons';
import { iconSetById } from './icons';
import { AtlasAppFrame, BaseAppFrame, IslandsAppFrame, type AppFrameProps } from './components/AppFrame';
import { AtlasSidebar, BaseSidebar, type SidebarProps } from './components/Sidebar';
import { BaseStatusBar, IslandsStatusBar, ModelineStatusBar, type StatusBarProps } from './components/StatusBar';
import { BaseTabBar, type TabBarProps } from './components/TabWorkspace';

export interface NavigationComponents {
  Frame: ComponentType<AppFrameProps>;
  Sidebar: <Id extends string>(props: SidebarProps<Id>) => ReactNode;
  TabBar: <R>(props: TabBarProps<R>) => ReactNode;
  StatusBar: ComponentType<StatusBarProps>;
}

const NAV_PARTS: Record<string, Partial<NavigationComponents>> = {};

/** Swaps navigation parts for a key, `nav:<NavigationId>` or `skin:<SkinId>`; slots left out keep the base components. */
export function registerNavigation(key: string, parts: Partial<NavigationComponents>): void {
  NAV_PARTS[key] = { ...NAV_PARTS[key], ...parts };
}

registerNavigation('skin:islands', { Frame: IslandsAppFrame, StatusBar: IslandsStatusBar });
registerNavigation('skin:modeline', { StatusBar: ModelineStatusBar });
registerNavigation('nav:atlas', { Frame: AtlasAppFrame, Sidebar: AtlasSidebar });

/** Base parts, then the navigation's, then the skin's. */
export function resolveNavigation(navigation: NavigationId, skin: SkinId): NavigationComponents {
  const nav = NAV_PARTS[`nav:${navigation}`] ?? {};
  const sk = NAV_PARTS[`skin:${skin}`] ?? {};
  return {
    Frame: BaseAppFrame,
    Sidebar: BaseSidebar,
    TabBar: BaseTabBar,
    StatusBar: BaseStatusBar,
    ...nav,
    ...sk,
  };
}

export interface LayoutContext {
  layout: Layout;
  /** The effective structure of the resolved layouts setting. */
  structure: LayoutStructure;
  mainMenu: MainMenu;
  iconSet: string;
  navParts: NavigationComponents;
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
    const navParts = resolveNavigation(resolved.navigation, resolved.skin);
    return { layout, structure: resolved.structure, mainMenu, iconSet, navParts, resolved };
  }, [layout, iconSet, mainMenu, resolved]);
}
