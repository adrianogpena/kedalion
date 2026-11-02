/// <reference path="./svg.d.ts" />
import argus from './assets/views/argus.svg' with { type: 'text' };
import charon from './assets/views/charon.svg' with { type: 'text' };
import hermes from './assets/views/hermes.svg' with { type: 'text' };
import kourai from './assets/views/kourai.svg' with { type: 'text' };
import moirai from './assets/views/moirai.svg' with { type: 'text' };
import odysseus from './assets/views/odysseus.svg' with { type: 'text' };
import sibyl from './assets/views/sibyl.svg' with { type: 'text' };
import themis from './assets/views/themis.svg' with { type: 'text' };
import theseus from './assets/views/theseus.svg' with { type: 'text' };

/** SVG source of each view's icon by view id (codenames in docs/ICONS.md); for server-side rendering such as toasts. */
export const VIEW_ICON_SVGS: Record<string, string> = {
  explorer: theseus,
  terminal: charon,
  rest: hermes,
  workbench: sibyl,
  git: moirai,
  dashboard: argus,
  browser: odysseus,
  agents: kourai,
  settings: themis,
};
