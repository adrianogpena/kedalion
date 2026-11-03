import { useLayout } from './layout';

/** Layout id of the Bridge layout (shown as "Bridge"). It carries the shell command bar + activity strip, the Workbench one-surface view and the REST panes view. */
export const BRIDGE_LAYOUT = 'bridge';

/** True when the Bridge layout is active; `layoutId` overrides the layout from context (App, outside the provider). */
export function useBridge(layoutId?: string): boolean {
  const ctx = useLayout().layout.id;
  return (layoutId ?? ctx) === BRIDGE_LAYOUT;
}
