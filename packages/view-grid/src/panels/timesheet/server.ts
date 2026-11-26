import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { IDLE_MINUTES, localDay, splitRoots, type DayTable } from './analysis';
import { collectWeek } from './collect';
import { TIMESHEET_FIELDS } from './fields';
import { foldersSource } from './folders';
import { gitEmailSource } from './git-email';

export interface TimesheetConfig {
  roots: string;
  ticketPattern: string;
  includeCopilot: boolean;
  includeGit: boolean;
  gitEmail: string;
  idleMinutes: number;
  [key: string]: unknown;
}

export interface TimesheetResult {
  days: DayTable;
  /** Today, `YYYY-MM-DD`, local time. */
  today: string;
}

/** The week is recomputed from the sources on every load; nothing is stored. */
async function compute(config: TimesheetConfig, signal: AbortSignal): Promise<TimesheetResult> {
  const now = new Date();
  const days = await collectWeek({
    roots: splitRoots(config.roots),
    ticketPattern: config.ticketPattern,
    includeCopilot: config.includeCopilot,
    includeGit: config.includeGit,
    gitEmail: typeof config.gitEmail === 'string' ? config.gitEmail : '',
    idleMinutes: Number(config.idleMinutes) > 0 ? Number(config.idleMinutes) : IDLE_MINUTES,
    now,
    signal,
  });
  return { days, today: localDay(now) };
}

const timesheet = defineSource<TimesheetConfig>({
  id: 'timesheet',
  fields: TIMESHEET_FIELDS,
  fetch: (config, ctx) => compute(config, ctx.signal),
});

export const specs: GridPanelSpec[] = [{ kind: 'timesheet', fields: TIMESHEET_FIELDS, allowMultiple: false }];

export const sources: DataSource<any>[] = [timesheet, gitEmailSource, foldersSource];
