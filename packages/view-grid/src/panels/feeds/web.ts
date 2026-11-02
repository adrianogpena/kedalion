import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { ExchangeRatePanel, type FxConfig } from './ExchangeRate';
import { RssPanel, type RssConfig } from './RssPanel';
import { WeatherPanel, type WeatherConfig } from './WeatherPanel';
import { FX_FIELDS, RSS_FIELDS, WEATHER_FIELDS } from './fields';
import type { FxData } from './fx';
import { FxActions } from './FxActions';
import { announceFx, importOldFxHistory } from './fx-history-web';
import type { FeedItem } from './rss';
import type { WeatherData } from './weather';

const MIN = 60_000;

const weatherPanel = definePanel<WeatherConfig, WeatherData | undefined>({
  kind: 'weather',
  title: 'dash.feeds.panel.weather',
  description: 'dash.feeds.panel.weather.description',
  icon: 'sun',
  category: 'dash.category.feeds',
  size: { w: 5, h: 12, minW: 3, minH: 5 },
  config: { fields: WEATHER_FIELDS },
  load: async (config, ctx) =>
    config.location.trim() ? fetchSource<WeatherData>('feeds-weather', { location: config.location, units: config.units, days: config.days }, ctx.signal) : undefined,
  refreshMs: 30 * MIN,
  render: ({ config, data, configure }) => createElement(WeatherPanel, { config, data, configure }),
});

const rssPanel = definePanel<RssConfig, FeedItem[] | undefined>({
  kind: 'rss',
  title: 'dash.feeds.panel.rss',
  description: 'dash.feeds.panel.rss.description',
  icon: 'follow',
  category: 'dash.category.feeds',
  size: { w: 6, h: 14, minW: 3, minH: 5 },
  config: { fields: RSS_FIELDS },
  load: async (config, ctx) => (config.urls.trim() ? fetchSource<FeedItem[]>('feeds-rss', { urls: config.urls, max: config.max }, ctx.signal) : undefined),
  refreshMs: 15 * MIN,
  render: ({ config, data, configure }) => createElement(RssPanel, { config, items: data, configure }),
});

const exchangeRatePanel = definePanel<FxConfig, FxData>({
  kind: 'exchange-rate',
  title: 'dash.feeds.panel.fx',
  description: 'dash.feeds.panel.fx.description',
  icon: 'database',
  category: 'dash.category.feeds',
  size: { w: 4, h: 8, minW: 3, minH: 5 },
  config: { fields: FX_FIELDS },
  load: async (config, ctx) => {
    const data = await fetchSource<FxData>('feeds-fx', { base: config.base, quote: config.quote, days: config.days, apiKey: config.apiKey }, ctx.signal);
    void importOldFxHistory(config).finally(() => announceFx(config));
    return data;
  },
  refreshMs: (config) => (config.apiKey?.trim() ? 5 * MIN : 60 * MIN),
  headerActions: FxActions,
  render: ({ config, data }) => createElement(ExchangeRatePanel, { config, data }),
});

/** The feeds panel kinds. */
export const panels: AnyPanelKind[] = [weatherPanel, rssPanel, exchangeRatePanel];
