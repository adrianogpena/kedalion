import type { PanelField } from '@kedalion/ui/grid';
import { DEFAULT_TICKET_PATTERN } from '../github/map';
import { notifyField } from '../../notify-field';
import { TICKET_LAYOUTS } from './model';

export const TICKETS_FIELDS: readonly PanelField[] = [
  { key: 'layout', kind: 'enum', label: 'dash.tickets.layout', description: 'dash.tickets.layout.hint', default: 'board', values: TICKET_LAYOUTS, optionLabel: 'dash.tickets.layout' },
  { key: 'keyPattern', kind: 'string', label: 'dash.tickets.keyPattern', description: 'dash.tickets.keyPattern.hint', default: DEFAULT_TICKET_PATTERN, maxLength: 200 },
  { key: 'autoMove', kind: 'boolean', label: 'dash.tickets.autoMove', description: 'dash.tickets.autoMove.hint', default: true },
  { key: 'readyLabel', kind: 'string', label: 'dash.tickets.readyLabel', description: 'dash.tickets.readyLabel.hint', default: 'ready to merge', maxLength: 100 },
  { key: 'jiraBaseUrl', kind: 'string', label: 'dash.tickets.jiraBaseUrl', description: 'dash.tickets.jiraBaseUrl.hint', placeholder: 'dash.tickets.jiraBaseUrl.placeholder', default: '', maxLength: 300 },
  { key: 'notesFolder', kind: 'folder', label: 'dash.tickets.notesFolder', description: 'dash.tickets.notesFolder.hint', default: '' },
  notifyField(true),
];

export const fields: Record<string, readonly PanelField[]> = { tickets: TICKETS_FIELDS };
