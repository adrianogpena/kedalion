import * as agent from './agent/i18n';
import * as changes from './changes/i18n';
import * as diff from './diff/i18n';
import * as review from './review/i18n';
import * as usage from './usage/i18n';
import * as run from './run/i18n';
import * as scratchpad from './scratchpad/i18n';
import * as code from './code/i18n';
import * as task from './task/i18n';
import * as notes from './notes/i18n';
import * as trajectory from './trajectory/i18n';
import * as output from './output/i18n';
import * as activity from './activity/i18n';

/** Every panel's messages, spread into `src/i18n.ts`. A panel adds keys to its own `<kind>/i18n.ts`, never here. */
export const panelsEn = {
  ...agent.en,
  ...changes.en,
  ...diff.en,
  ...review.en,
  ...usage.en,
  ...run.en,
  ...scratchpad.en,
  ...code.en,
  ...task.en,
  ...notes.en,
  ...trajectory.en,
  ...output.en,
  ...activity.en,
};

export const panelsPtBR = {
  ...agent.ptBR,
  ...changes.ptBR,
  ...diff.ptBR,
  ...review.ptBR,
  ...usage.ptBR,
  ...run.ptBR,
  ...scratchpad.ptBR,
  ...code.ptBR,
  ...task.ptBR,
  ...notes.ptBR,
  ...trajectory.ptBR,
  ...output.ptBR,
  ...activity.ptBR,
};
