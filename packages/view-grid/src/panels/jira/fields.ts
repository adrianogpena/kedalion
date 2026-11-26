import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';


export const DEFAULT_JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';

export const ISSUE_COLUMNS = ['type', 'priority', 'status', 'assignee', 'reporter', 'updated', 'due', 'sprint'] as const;
export const SPRINT_COLUMNS = ['assignee', 'points', 'type'] as const;
export const GROUP_BY = ['none', 'status', 'assignee', 'priority'] as const;
export const VIEWS = ['list', 'board'] as const;
export const DISPLAYS = ['number', 'status', 'assignee', 'priority'] as const;
export const REFRESH_MINUTES = [1, 5, 15, 30] as const;

export const ISSUES_FIELDS: readonly PanelField[] = [
  { key: 'jql', kind: 'text', label: 'dash.jira.jql', description: 'dash.jira.jql.hint', default: DEFAULT_JQL, rows: 3, maxLength: 2000 },
  { key: 'max', kind: 'number', label: 'dash.jira.max', default: 15, min: 1, max: 50 },
  { key: 'view', kind: 'enum', label: 'dash.jira.view', description: 'dash.jira.view.hint', default: 'list', values: VIEWS, optionLabel: 'dash.jira.view' },
  { key: 'columns', kind: 'multi', label: 'dash.jira.columns', default: ['status', 'priority', 'updated'], values: ISSUE_COLUMNS, optionLabel: 'dash.jira.col' },
  { key: 'groupBy', kind: 'enum', label: 'dash.jira.groupBy', default: 'none', values: GROUP_BY, optionLabel: 'dash.jira.groupBy' },
  { key: 'refreshMin', kind: 'enum', label: 'dash.jira.refreshMin', default: 5, values: REFRESH_MINUTES, optionLabel: 'dash.jira.refreshMin' },
  notifyField(true),
];

export const COUNT_FIELDS: readonly PanelField[] = [
  { key: 'jql', kind: 'text', label: 'dash.jira.jql', description: 'dash.jira.jql.hint', default: DEFAULT_JQL, rows: 3, maxLength: 2000 },
  { key: 'label', kind: 'string', label: 'dash.jira.label', default: '', maxLength: 60 },
  { key: 'display', kind: 'enum', label: 'dash.jira.display', default: 'number', values: DISPLAYS, optionLabel: 'dash.jira.display' },
  { key: 'refreshMin', kind: 'enum', label: 'dash.jira.refreshMin', default: 5, values: REFRESH_MINUTES, optionLabel: 'dash.jira.refreshMin' },
  notifyField(false),
];

export const BOARD_FIELDS: readonly PanelField[] = [
  { key: 'boardId', kind: 'number', label: 'dash.jira.boardId', description: 'dash.jira.boardId.hint', default: 0, min: 0, max: 1_000_000 },
  { key: 'columns', kind: 'multi', label: 'dash.jira.columns', default: ['assignee', 'points'], values: SPRINT_COLUMNS, optionLabel: 'dash.jira.col' },
  { key: 'refreshMin', kind: 'enum', label: 'dash.jira.refreshMin', default: 5, values: REFRESH_MINUTES, optionLabel: 'dash.jira.refreshMin' },
  notifyField(true),
];

/** Config field lists of the jira panels (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = {
  'jira-issues': ISSUES_FIELDS,
  'jira-count': COUNT_FIELDS,
  'jira-sprint': BOARD_FIELDS,
};
