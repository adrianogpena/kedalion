import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';

export const PODS_FIELDS: readonly PanelField[] = [
  { key: 'clusters', kind: 'text', label: 'dash.pods.clusters', description: 'dash.pods.clusters.hint', placeholder: 'dash.pods.clusters.placeholder', default: '', rows: 4, maxLength: 2000, list: 'columns', columns: [{ label: 'dash.pods.col.context', suggest: { source: 'kube-contexts' } }, { label: 'dash.pods.col.namespace' }, { label: 'dash.pods.col.pod' }] },
  { key: 'refreshSec', kind: 'number', label: 'dash.pods.refreshSec', default: 30, min: 5, max: 3600 },
  { key: 'showHealthy', kind: 'boolean', label: 'dash.pods.showHealthy', default: true },
  notifyField(true, ['notifyHealth']),
];

export const fields: Record<string, readonly PanelField[]> = { pods: PODS_FIELDS };
