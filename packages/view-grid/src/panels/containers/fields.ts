import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';

export const CONTAINERS_FIELDS: readonly PanelField[] = [
  { key: 'engine', kind: 'enum', label: 'dash.containers.engine', default: 'podman', values: ['podman', 'docker'] },
  { key: 'pinned', kind: 'text', label: 'dash.containers.pinned', default: '', rows: 4, maxLength: 2000, hidden: true },
  { key: 'showStopped', kind: 'boolean', label: 'dash.containers.showStopped', default: true },
  { key: 'logFiles', kind: 'text', label: 'dash.containers.logFiles', default: '', maxLength: 4000, hidden: true },
  notifyField(true),
];

export const fields: Record<string, readonly PanelField[]> = { containers: CONTAINERS_FIELDS };
