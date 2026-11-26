import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';
import { CURRENCY_SUGGEST } from './currencies';

export const WEATHER_FIELDS: readonly PanelField[] = [
  { key: 'location', kind: 'string', label: 'dash.feeds.weather.location', description: 'dash.feeds.weather.location.hint', placeholder: 'dash.feeds.weather.location.placeholder', default: '', maxLength: 80, suggest: { source: 'weather-places', params: ['location'] } },
  { key: 'units', kind: 'enum', label: 'dash.feeds.weather.units', default: 'metric', values: ['metric', 'imperial'], optionLabel: 'dash.feeds.weather.units' },
  { key: 'show', kind: 'multi', label: 'dash.feeds.weather.show', default: ['now', 'daily'], values: ['now', 'hourly', 'daily'], optionLabel: 'dash.feeds.weather.show' },
  { key: 'days', kind: 'number', label: 'dash.feeds.weather.days', default: 5, min: 1, max: 7 },
  { key: 'layout', kind: 'enum', label: 'dash.feeds.weather.layout', default: 'full', values: ['full', 'current', 'forecastRow', 'forecastColumn'], optionLabel: 'dash.feeds.weather.layout' },
];

/** What a Weather panel sends to the `feeds-weather` source. */
export const WEATHER_SOURCE_FIELDS: readonly PanelField[] = [
  WEATHER_FIELDS[0]!,
  WEATHER_FIELDS[1]!,
  WEATHER_FIELDS[3]!,
];

export const RSS_FIELDS: readonly PanelField[] = [
  { key: 'urls', kind: 'text', label: 'dash.feeds.rss.urls', description: 'dash.feeds.rss.urls.hint', placeholder: 'dash.feeds.rss.urls.placeholder', default: '', rows: 5, importOpml: true, list: 'url' },
  { key: 'max', kind: 'number', label: 'dash.feeds.rss.max', default: 20, min: 1, max: 50 },
  { key: 'showSummary', kind: 'boolean', label: 'dash.feeds.rss.showSummary', default: false },
  { key: 'showSource', kind: 'boolean', label: 'dash.feeds.rss.showSource', default: true },
  notifyField(true),
];

/** What an RSS panel sends to the `feeds-rss` source. */
export const RSS_SOURCE_FIELDS: readonly PanelField[] = [RSS_FIELDS[0]!, RSS_FIELDS[1]!, RSS_FIELDS[4]!];

export const FX_FIELDS: readonly PanelField[] = [
  { key: 'base', kind: 'string', label: 'dash.feeds.fx.base', description: 'dash.feeds.fx.code.hint', default: 'EUR', maxLength: 3, suggest: CURRENCY_SUGGEST },
  { key: 'quote', kind: 'string', label: 'dash.feeds.fx.quote', description: 'dash.feeds.fx.code.hint', default: 'BRL', maxLength: 3, suggest: CURRENCY_SUGGEST },
  { key: 'track', kind: 'string', label: 'dash.feeds.fx.track', description: 'dash.feeds.fx.track.hint', placeholder: 'dash.feeds.fx.track.placeholder', default: '', maxLength: 120 },
  { key: 'days', kind: 'enum', label: 'dash.feeds.fx.days', default: 30, values: [7, 30, 90], optionLabel: 'dash.feeds.fx.days' },
  { key: 'apiKey', kind: 'string', label: 'dash.feeds.fx.apiKey', description: 'dash.feeds.fx.apiKey.hint', default: '', maxLength: 64, secret: true },
];

/** Config field lists of the feeds panels (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = {
  weather: WEATHER_FIELDS,
  rss: RSS_FIELDS,
  'exchange-rate': FX_FIELDS,
};
