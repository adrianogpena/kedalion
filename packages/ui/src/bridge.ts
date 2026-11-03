import { resolveLayouts, type LayoutsSetting } from '@kedalion/server-core/layouts';
import { useLayout } from './layout';

/** Layout id of the Bridge layout (shown as "Bridge"). It carries the shell command bar + activity strip, the Workbench one-surface view and the REST panes view. */
export const BRIDGE_LAYOUT = 'bridge';

/** True when navigation is the command bar (`header-command`); `layouts` overrides the context (App, outside the provider). */
export function useBridge(layouts?: LayoutsSetting): boolean {
  const ctx = useLayout().resolved.navigation;
  return (layouts ? resolveLayouts(layouts).navigation : ctx) === 'header-command';
}

/** The layout id chosen for a view (`workbench`, `rest`, ...); 'base' when none. */
export function useViewLayout(view: string): string {
  return useLayout().resolved.views[view] ?? 'base';
}
