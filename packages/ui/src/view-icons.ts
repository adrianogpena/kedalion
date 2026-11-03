import { VIEW_ICON_MARKUP as M } from './view-icon-markup';

/** SVG source of each view's icon by view id (codenames in docs/ICONS.md); inline strings so the web bundle and server-side rendering such as toasts share them. */
export const VIEW_ICON_SVGS: Record<string, string> = {
  explorer: M.theseus!,
  terminal: M.charon!,
  rest: M.hermes!,
  workbench: M.sibyl!,
  git: M.moirai!,
  dashboard: M.argus!,
  browser: M.odysseus!,
  agents: M.kourai!,
  settings: M.themis!,
};
