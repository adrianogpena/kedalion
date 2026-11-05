import type { PanelConfig } from '@kedalion/ui/grid';
import { notifyChanges, notifyScope } from '../../notify-changes';
import type { DataSource, GridPanelSpec, NotificationLogEntry } from '../../server';
import { fields } from './fields';
import { checkUrl, fetchJson, type HealthResult } from './health';
import { asNumber, lookupPath } from './jsonpath';
import { parseLines } from './lines';
import { MAX_URLS } from './fields';
import { systemStats, type SystemStats } from './system';

export const specs: GridPanelSpec[] = [
  { kind: 'links', fields: fields.links, allowMultiple: true },
  { kind: 'notes', fields: fields.notes, allowMultiple: true },
  { kind: 'url-health', fields: fields['url-health'], allowMultiple: true },
  { kind: 'json-metric', fields: fields['json-metric'], allowMultiple: true },
  { kind: 'system', fields: fields.system, allowMultiple: false },
  { kind: 'notification-log', fields: fields['notification-log'], allowMultiple: false },
];

export interface JsonMetricData {
  /** Undefined when the path is missing or not a number. */
  value: number | undefined;
  /** The raw value, shown when it is not numeric. */
  raw?: string;
}

const urlHealth: DataSource<PanelConfig> = {
  id: 'url-health',
  fields: fields['url-health']!,
  async fetch(config, ctx): Promise<HealthResult[]> {
    const items = parseLines(String(config.urls ?? ''), MAX_URLS);
    const results = await Promise.all(items.map((i) => checkUrl(i.label, i.url, Number(config.timeoutMs), ctx.signal)));
    if (config.notify !== false) {
      notifyChanges(ctx, notifyScope('url-health', { urls: config.urls, timeoutMs: config.timeoutMs }), results, {
        key: (r) => r.url,
        sig: (r) => (r.ok ? 'up' : 'down'),
        title: 'URL health',
        line: (r) => `${r.label || r.url} ${r.ok ? 'recovered' : 'is down'}`,
      });
    }
    return results;
  },
};

const jsonMetric: DataSource<PanelConfig> = {
  id: 'json-metric',
  fields: fields['json-metric']!,
  async fetch(config, ctx): Promise<JsonMetricData> {
    const found = lookupPath(await fetchJson(String(config.url ?? ''), 10_000, ctx.signal), String(config.path ?? ''));
    const value = asNumber(found);
    const raw = value === undefined && found !== undefined ? (typeof found === 'object' ? JSON.stringify(found) : String(found)).slice(0, 200) : undefined;
    const data: JsonMetricData = { value, ...(raw !== undefined && { raw }) };
    if (config.notify === true) {
      const name = String(config.label || config.path || config.url);
      notifyChanges(ctx, notifyScope('json-metric', { url: config.url, path: config.path }), [data], {
        key: () => 'value',
        sig: (d) => String(d.value ?? d.raw ?? ''),
        title: 'Metric changed',
        line: (d) => `${name}: ${d.value ?? d.raw ?? 'no value'}${config.unit ? ` ${config.unit}` : ''}`,
      });
    }
    return data;
  },
};

const system: DataSource<PanelConfig> = {
  id: 'system',
  fields: fields.system!,
  fetch: (_config, ctx): Promise<SystemStats> => systemStats(ctx.dataDir),
};

const notificationLog: DataSource<PanelConfig> = {
  id: 'notification-log',
  fields: fields['notification-log']!,
  fetch: (config, ctx): NotificationLogEntry[] => (ctx.notificationLog?.() ?? []).slice(0, Number(config.max) || 50),
};

/** Server data sources of the misc panels (no React). */
export const sources: DataSource<any>[] = [urlHealth, jsonMetric, system, notificationLog];
