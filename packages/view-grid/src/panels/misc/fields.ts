import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';

export const MAX_URLS = 20;
export const SYSTEM_COLUMNS = ['cpu', 'memory', 'disk', 'uptime'] as const;

const linesField = (key: string, label: string): PanelField => ({
  key,
  kind: 'text',
  label,
  description: 'dash.misc.lines.hint',
  default: '',
  maxLength: 2000,
  rows: 6,
  placeholder: 'dash.misc.lines.placeholder',
});

/** Config field lists of the misc panels (no React). */
export const fields: Record<string, readonly PanelField[]> = {
  links: [
    linesField('items', 'dash.misc.links.items'),
    { key: 'layout', kind: 'enum', label: 'dash.misc.links.layout', default: 'list', values: ['list', 'tiles'], optionLabel: 'dash.misc.links.layout' },
  ],
  notes: [{ key: 'text', kind: 'text', label: 'dash.misc.notes.text', default: '', maxLength: 4000, rows: 10 }],
  'url-health': [
    linesField('urls', 'dash.misc.health.urls'),
    { key: 'layout', kind: 'enum', label: 'dash.misc.health.layout', default: 'list', values: ['list', 'dots'], optionLabel: 'dash.misc.health.layout' },
    { key: 'timeoutMs', kind: 'number', label: 'dash.misc.health.timeoutMs', default: 5000, min: 1000, max: 30000 },
    { key: 'refreshMin', kind: 'enum', label: 'dash.misc.refreshMin', default: 5, values: [1, 5, 15] },
    notifyField(true),
  ],
  'json-metric': [
    { key: 'url', kind: 'string', label: 'dash.misc.json.url', default: '', maxLength: 200, placeholder: 'https://' },
    { key: 'path', kind: 'string', label: 'dash.misc.json.path', description: 'dash.misc.json.path.hint', default: '', maxLength: 200, placeholder: 'data.items.0.count' },
    { key: 'label', kind: 'string', label: 'dash.misc.json.label', default: '', maxLength: 60 },
    { key: 'unit', kind: 'string', label: 'dash.misc.json.unit', default: '', maxLength: 20 },
    { key: 'refreshMin', kind: 'enum', label: 'dash.misc.refreshMin', default: 5, values: [1, 5, 15] },
    notifyField(false),
  ],
  'notification-log': [{ key: 'max', kind: 'enum', label: 'dash.misc.notifLog.max', default: 50, values: [20, 50, 100, 200] }],
  system: [
    { key: 'layout', kind: 'enum', label: 'dash.misc.system.layout', default: 'tiles', values: ['tiles', 'bars'], optionLabel: 'dash.misc.system.layout' },
    { key: 'show', kind: 'multi', label: 'dash.misc.system.show', default: ['cpu', 'memory', 'disk', 'uptime'], values: SYSTEM_COLUMNS, optionLabel: 'dash.misc.system.show' },
  ],
};
