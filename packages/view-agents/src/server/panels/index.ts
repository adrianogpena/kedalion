import type { Routes } from '@kedalion/server-core';
import type { PanelCtx, PanelRoutes } from './ctx.ts';
import { routes as changes } from './changes.ts';
import { routes as output } from './output.ts';
import { routes as review } from './review.ts';
import { routes as run } from './run.ts';
import { routes as scratchpad } from './scratchpad.ts';
import { routes as task } from './task.ts';
import { routes as usage } from './usage.ts';

export type { PanelCtx, PanelRoutes };

/** Every panel's route file, in one place; a group adds routes in its own `<kind>.ts`, never here. */
const PANELS: PanelRoutes[] = [changes, output, review, run, scratchpad, task, usage];

/** The routes of all panel modules, merged into `server.ts`'s route map (`'METHOD /api/agents/...'` keys). */
export function panelRoutes(ctx: PanelCtx): Routes {
  return Object.assign({}, ...PANELS.map((routes) => routes(ctx)));
}
