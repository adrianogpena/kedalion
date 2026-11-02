import { readLimited, sourceFetch } from '../../connections/errors';
import { notifyChanges, notifyScope } from '../../notify-changes';
import { createJsonStore } from '../../json-store';
import { defineSource,type DataSource, type GridPanelSpec } from '../../server';
import { fields, FX_FIELDS, RSS_SOURCE_FIELDS, WEATHER_SOURCE_FIELDS } from './fields';
import { currencyCode, mapSeries, mapTwelveData, startDate, type FxData } from './fx';
import { addFxUpdate, emptyFxHistory, mergeFxHistory, pairKey, parseFxHistories, type FxHistories } from './fx-history';
import { feedUrls, mergeFeeds, parseFeed, type Feed, type FeedItem } from './rss';
import { emptyWeather, forecastParams, mapForecast, placeName, type WeatherData, type WeatherUnits } from './weather';

const MAX_FEED_BYTES = 5_000_000;
const headers = { 'user-agent': 'Kedalion', accept: 'application/json' };

interface Place {
  lat: number;
  lon: number;
  name: string;
}
const places = new Map<string, Place>();

async function geocode(location: string, signal: AbortSignal): Promise<Place | undefined> {
  const key = location.trim().toLowerCase();
  const hit = places.get(key);
  if (hit) return hit;
  const res = await sourceFetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.trim())}&count=1`, { headers }, { signal });
  const found = ((await res.json()) as any)?.results?.[0];
  if (typeof found?.latitude !== 'number' || typeof found?.longitude !== 'number') return undefined;
  const place = { lat: found.latitude, lon: found.longitude, name: placeName(found) };
  places.set(key, place);
  return place;
}

export const weatherSource = defineSource<{ location: string; units: WeatherUnits; days: number }>({
  id: 'feeds-weather',
  fields: WEATHER_SOURCE_FIELDS,
  async fetch({ location, units, days }, { signal }): Promise<WeatherData> {
    if (!location.trim()) return emptyWeather(units);
    const place = await geocode(location, signal);
    if (!place) return emptyWeather(units);
    const res = await sourceFetch(`https://api.open-meteo.com/v1/forecast?${forecastParams(place.lat, place.lon, units, days)}`, { headers }, { signal });
    return mapForecast(await res.json(), place.name, units, days);
  },
});

async function loadFeed(url: string, signal: AbortSignal): Promise<Feed> {
  const res = await sourceFetch(url, { headers: { ...headers, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } }, { signal });
  const { text } = await readLimited(res, MAX_FEED_BYTES);
  return parseFeed(text, new URL(url).hostname);
}

export const rssSource = defineSource<{ urls: string; max: number; notify: boolean }>({
  id: 'feeds-rss',
  fields: RSS_SOURCE_FIELDS,
  async fetch({ urls, max, notify }, ctx): Promise<FeedItem[]> {
    const list = feedUrls(urls);
    if (list.length === 0) return [];
    const results = await Promise.allSettled(list.map((url) => loadFeed(url, ctx.signal)));
    const feeds = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (feeds.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    const items = mergeFeeds(feeds, max);
    if (notify !== false) {
      notifyChanges(ctx, notifyScope('feeds-rss', { urls, max }), items, {
        key: (i) => i.link || i.title,
        sig: () => '',
        title: feeds.length === 1 ? `New in ${feeds[0]!.title}` : 'New feed items',
        line: (i) => (feeds.length === 1 ? i.title : `${i.source}: ${i.title}`),
      });
    }
    return items;
  },
});

/** Live series from Twelve Data (1 credit); the last daily bar tracks the current rate. Undefined on any failure, so the caller falls back. */
async function fetchLiveFx(base: string, quote: string, days: number, apiKey: string, signal: AbortSignal): Promise<FxData | undefined> {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${base}/${quote}&interval=1day&outputsize=${days + 1}`;
    const res = await sourceFetch(url, { headers: { ...headers, authorization: `apikey ${apiKey}` } }, { signal });
    const raw: any = await res.json();
    if (raw?.status === 'error') return undefined;
    const data = mapTwelveData(raw, base, quote);
    return data.values.length > 0 ? data : undefined;
  } catch {
    return undefined;
  }
}

const fxStores = new Map<string, ReturnType<typeof createJsonStore<FxHistories>>>();

const fxStoreOf = (dataDir: string) => {
  let s = fxStores.get(dataDir);
  if (!s) {
    s = createJsonStore<FxHistories>({ dataDir, name: 'fx-history', parse: parseFxHistories, empty: () => ({}) });
    fxStores.set(dataDir, s);
  }
  return s;
};

async function loadFx(config: { base: string; quote: string; days: number; apiKey?: string }, signal: AbortSignal): Promise<FxData> {
  const base = currencyCode(config.base, 'EUR');
  const quote = currencyCode(config.quote, 'BRL');
  if (base === quote) return { base, quote, dates: [], values: [] };
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    const live = await fetchLiveFx(base, quote, config.days, apiKey, signal);
    if (live) return live;
  }
  const res = await sourceFetch(`https://api.frankfurter.app/${startDate(new Date(), config.days)}..?from=${base}&to=${quote}`, { headers }, { signal });
  return mapSeries(await res.json(), base, quote);
}

export const fxSource = defineSource<{ base: string; quote: string; days: number; apiKey?: string }>({
  id: 'feeds-fx',
  fields: FX_FIELDS,
  async fetch(config, { signal, dataDir }): Promise<FxData> {
    const data = await loadFx(config, signal);
    if (data.values.length > 0) {
      const key = pairKey(data.base, data.quote);
      await fxStoreOf(dataDir).update((all) => ({ ...all, [key]: addFxUpdate(all[key] ?? emptyFxHistory(), data, config.days, new Date()) }));
    }
    return data;
  },
  actions: {
    /** The saved history of the config's pair. */
    history: async (_payload, config, { dataDir }) => (await fxStoreOf(dataDir).read())[pairKey(currencyCode(config.base, 'EUR'), currencyCode(config.quote, 'BRL'))] ?? emptyFxHistory(),
    /** Joins histories a browser profile saved before this store existed. */
    import: async (payload, _config, { dataDir }) => {
      const old = parseFxHistories(payload);
      await fxStoreOf(dataDir).update((all) => {
        const next = { ...all };
        for (const [key, h] of Object.entries(old)) next[key] = mergeFxHistory(next[key] ?? emptyFxHistory(), h);
        return next;
      });
      return true;
    },
  },
});

export const specs: GridPanelSpec[] = [
  { kind: 'weather', fields: fields.weather, allowMultiple: true },
  { kind: 'rss', fields: fields.rss, allowMultiple: true },
  { kind: 'exchange-rate', fields: fields['exchange-rate'], allowMultiple: true },
];
export const sources: DataSource<any>[] = [weatherSource, rssSource, fxSource];
