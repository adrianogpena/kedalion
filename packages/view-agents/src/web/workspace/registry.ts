import type { PanelKind, PanelModule } from './types';
import { panel as agent } from '../panels/agent';
import { panel as changes } from '../panels/changes';
import { panel as diff } from '../panels/diff';
import { panel as review } from '../panels/review';
import { panel as usage } from '../panels/usage';
import { panel as run } from '../panels/run';
import { panel as scratchpad } from '../panels/scratchpad';
import { panel as code } from '../panels/code';
import { panel as task } from '../panels/task';
import { panel as notes } from '../panels/notes';
import { panel as trajectory } from '../panels/trajectory';
import { panel as output } from '../panels/output';
import { panel as activity } from '../panels/activity';

/** Every panel module (static imports: a new kind is one folder under `panels/` plus one line here). */
export const PANELS: readonly PanelModule[] = [agent, changes, diff, review, usage, run, scratchpad, code, task, notes, trajectory, output, activity];

const byKind = new Map<string, PanelModule>(PANELS.map((p) => [p.kind, p]));

/** The module of a kind; undefined for a kind this build does not know (the workspace shows a "missing panel" card). */
export const panelOf = (kind: string): PanelModule | undefined => byKind.get(kind);

/** A known kind that can live in a sidebar (not center-only). */
export const isDockableKind = (kind: string): boolean => {
  const m = byKind.get(kind);
  return !!m && m.placement !== 'center';
};

export const isPanelKind =(kind: string): kind is PanelKind => byKind.has(kind);

