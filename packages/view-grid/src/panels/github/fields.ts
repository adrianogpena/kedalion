import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';
import { DEFAULT_TICKET_PATTERN, ISSUE_MODES, PR_MODES } from './map';
import { NOTIFICATION_COLUMNS, OVERVIEW_STATS, RUN_COLUMNS } from './more';

export const PR_COLUMNS = ['repo', 'author', 'review', 'checks', 'labels', 'branch', 'ticket', 'size', 'created', 'updated'] as const;
export const ISSUE_COLUMNS = ['repo', 'author', 'labels', 'assignees', 'comments', 'milestone', 'updated'] as const;

const connection: PanelField = { key: 'connection', kind: 'connection', connectionType: 'github', label: 'dash.github.connection', default: '' };
const repo: PanelField = { key: 'repo', kind: 'string', label: 'dash.github.repo', description: 'dash.github.repo.hint', placeholder: 'dash.github.repo.placeholder', default: '', maxLength: 100 };
const query: PanelField = { key: 'query', kind: 'string', label: 'dash.github.query', description: 'dash.github.query.hint', default: '', maxLength: 300 };
const max: PanelField = { key: 'max', kind: 'number', label: 'dash.github.max', default: 15, min: 1, max: 50 };
const density: PanelField = { key: 'density', kind: 'enum', label: 'dash.github.density', default: 'detailed', values: ['detailed', 'compact'], optionLabel: 'dash.github.density' };

export const PULL_REQUESTS_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'mode', kind: 'enum', label: 'dash.github.mode', default: 'mine', values: PR_MODES, optionLabel: 'dash.github.prMode' },
  repo,
  query,
  max,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['repo', 'review', 'checks', 'updated'], values: PR_COLUMNS, optionLabel: 'dash.github.col' },
  density,
  { key: 'ticketPattern', kind: 'string', label: 'dash.github.ticketPattern', description: 'dash.github.ticketPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 100 },
  { key: 'rcLabel', kind: 'label', label: 'dash.github.rcLabel', description: 'dash.github.rcLabel.hint', default: ['RC branch'] },
  notifyField(true),
];

export const PR_QUERY_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'query', kind: 'string', label: 'dash.github.prq.query', description: 'dash.github.prq.query.hint', default: 'is:open review-requested:@me', maxLength: 300 },
  max,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['repo', 'review', 'checks', 'updated'], values: PR_COLUMNS, optionLabel: 'dash.github.col' },
  density,
  { key: 'ticketPattern', kind: 'string', label: 'dash.github.ticketPattern', description: 'dash.github.ticketPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 100 },
  { key: 'rcLabel', kind: 'label', label: 'dash.github.rcLabel', description: 'dash.github.rcLabel.hint', default: ['RC branch'] },
  notifyField(true),
];

export const ISSUES_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'mode', kind: 'enum', label: 'dash.github.mode', default: 'assigned', values: ISSUE_MODES, optionLabel: 'dash.github.issueMode' },
  repo,
  query,
  max,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['repo', 'labels', 'updated'], values: ISSUE_COLUMNS, optionLabel: 'dash.github.col' },
  density,
  notifyField(false),
];

/** What a panel sends to the github search sources. */
export const PR_SOURCE_FIELDS: readonly PanelField[] = PULL_REQUESTS_FIELDS.filter((f) => f.key !== 'columns' && f.key !== 'density');
export const PR_QUERY_SOURCE_FIELDS: readonly PanelField[] = PR_QUERY_FIELDS.filter((f) => f.key !== 'columns' && f.key !== 'density');
export const ISSUE_SOURCE_FIELDS: readonly PanelField[] = ISSUES_FIELDS.filter((f) => f.key !== 'columns' && f.key !== 'density');

const maxRows: PanelField = { key: 'max', kind: 'number', label: 'dash.github.max', default: 10, min: 1, max: 50 };

export const ACTIONS_FIELDS: readonly PanelField[] = [
  connection,
  repo,
  { key: 'branch', kind: 'string', label: 'dash.github.branch', default: '', maxLength: 100 },
  { key: 'workflow', kind: 'string', label: 'dash.github.workflow', description: 'dash.github.workflow.hint', placeholder: 'dash.github.workflow.placeholder', default: '', maxLength: 100 },
  maxRows,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['branch', 'duration', 'updated'], values: RUN_COLUMNS, optionLabel: 'dash.github.col' },
  notifyField(true),
];

export const NOTIFICATIONS_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'participatingOnly', kind: 'boolean', label: 'dash.github.participatingOnly', default: false },
  maxRows,
  { key: 'columns', kind: 'multi', label: 'dash.github.columns', default: ['repo', 'reason', 'updated'], values: NOTIFICATION_COLUMNS, optionLabel: 'dash.github.col' },
  notifyField(false),
];

export const RELEASES_FIELDS: readonly PanelField[] = [
  connection,
  repo,
  maxRows,
  { key: 'includePrereleases', kind: 'boolean', label: 'dash.github.includePrereleases', default: false },
  notifyField(true),
];

export const OVERVIEW_FIELDS: readonly PanelField[] = [
  connection,
  repo,
  { key: 'show', kind: 'multi', label: 'dash.github.show', default: ['stars', 'forks', 'issues', 'prs'], values: OVERVIEW_STATS, optionLabel: 'dash.github.stat' },
];

export const TRACKED_FIELDS: readonly PanelField[] = [
  connection,
  { key: 'readyLabel', kind: 'label', label: 'dash.github.tracked.readyLabel', default: ['ready to merge'] },
  { key: 'rcLabel', kind: 'label', label: 'dash.github.tracked.rcLabel', default: ['rc'] },
  notifyField(false),
];
export const TRACKED_SOURCE_FIELDS: readonly PanelField[] = TRACKED_FIELDS;
export const LABELS_SOURCE_FIELDS: readonly PanelField[] = [connection];

/** Fields the sources of the more panels receive. */
export const ACTIONS_SOURCE_FIELDS: readonly PanelField[] = ACTIONS_FIELDS.filter((f) => f.key !== 'columns');
export const NOTIFICATIONS_SOURCE_FIELDS: readonly PanelField[] = NOTIFICATIONS_FIELDS.filter((f) => f.key !== 'columns');
export const OVERVIEW_SOURCE_FIELDS: readonly PanelField[] = OVERVIEW_FIELDS.filter((f) => f.key !== 'show');

/** Config field lists of the github panels (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = {
  'github-prs': PULL_REQUESTS_FIELDS,
  'github-pr-query': PR_QUERY_FIELDS,
  'github-issues': ISSUES_FIELDS,
  'github-actions': ACTIONS_FIELDS,
  'github-notifications': NOTIFICATIONS_FIELDS,
  'github-releases': RELEASES_FIELDS,
  'github-overview': OVERVIEW_FIELDS,
  'github-tracked': TRACKED_FIELDS,
};

