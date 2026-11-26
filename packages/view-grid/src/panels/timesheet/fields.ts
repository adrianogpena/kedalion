import type { PanelField } from '@kedalion/ui/grid';
import { DEFAULT_TICKET_PATTERN } from '../github/map';
import { TICKET_PATTERN_SUGGEST } from '../github/pattern-suggest';
import { IDLE_MINUTES } from './analysis';

export const TIMESHEET_FIELDS: readonly PanelField[] = [
  { key: 'roots', kind: 'text', label: 'dash.timesheet.roots', description: 'dash.timesheet.roots.hint', default: '', rows: 4, list: 'folder', anyFolder: true },
  { key: 'ticketPattern', kind: 'string', label: 'dash.timesheet.ticketPattern', description: 'dash.timesheet.ticketPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 100, suggest: TICKET_PATTERN_SUGGEST },
  { key: 'includeCopilot', kind: 'boolean', label: 'dash.timesheet.includeCopilot', default: true },
  { key: 'includeGit', kind: 'boolean', label: 'dash.timesheet.includeGit', default: true },
  { key: 'gitEmail', kind: 'string', label: 'dash.timesheet.gitEmail', description: 'dash.timesheet.gitEmail.hint', default: '', placeholder: 'you@company.com', maxLength: 200, suggest: { source: 'git-email' } },
  { key: 'idleMinutes', kind: 'number', label: 'dash.timesheet.idleMinutes', description: 'dash.timesheet.idleMinutes.hint', default: IDLE_MINUTES, min: 1, max: 240 },
];

export const fields: Record<string, readonly PanelField[]> = {
  timesheet: TIMESHEET_FIELDS,
};
