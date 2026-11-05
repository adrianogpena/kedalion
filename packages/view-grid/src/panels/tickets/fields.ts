import type { PanelField } from '@kedalion/ui/grid';
import { DEFAULT_TICKET_PATTERN } from '../github/map';
import { notifyField } from '../../notify-field';
import { DEFAULT_STATUSES } from './model';

export const TICKETS_FIELDS: readonly PanelField[] = [
  { key: 'connection', kind: 'connection', connectionType: 'github', label: 'dash.tickets.connection', description: 'dash.tickets.connection.hint', default: '' },
  { key: 'jiraConnection', kind: 'connection', connectionType: 'jira', label: 'dash.tickets.jiraConnection', description: 'dash.tickets.jiraConnection.hint', default: '' },
  { key: 'statuses', kind: 'text', label: 'dash.tickets.statuses', description: 'dash.tickets.statuses.hint', default: DEFAULT_STATUSES.join('\n'), rows: 6, maxLength: 1000 },
  { key: 'jiraMap', kind: 'text', label: 'dash.tickets.jiraMap', description: 'dash.tickets.jiraMap.hint', default: '', rows: 6, maxLength: 2000 },
  { key: 'keyPattern', kind: 'string', label: 'dash.tickets.keyPattern', description: 'dash.tickets.keyPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 200 },
  { key: 'autoMove', kind: 'boolean', label: 'dash.tickets.autoMove', description: 'dash.tickets.autoMove.hint', default: true },
  { key: 'readyLabel', kind: 'string', label: 'dash.tickets.readyLabel', description: 'dash.tickets.readyLabel.hint', default: 'ready to merge', maxLength: 100 },
  { key: 'jiraBaseUrl', kind: 'string', label: 'dash.tickets.jiraBaseUrl', description: 'dash.tickets.jiraBaseUrl.hint', placeholder: 'dash.tickets.jiraBaseUrl.placeholder', default: '', maxLength: 300 },
  { key: 'notesFolder', kind: 'folder', label: 'dash.tickets.notesFolder', description: 'dash.tickets.notesFolder.hint', default: '' },
  notifyField(true),
];

export const fields: Record<string, readonly PanelField[]> = { tickets: TICKETS_FIELDS };
