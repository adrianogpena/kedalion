import { summarize, type FxData } from './fx';

/** One fetch: what the panel showed right after it. */
export interface FxUpdate {
  /** ISO time of the fetch. */
  at: string;
  value: number;
  /** Change vs. the first day of the period. */
  change: number;
  percent: number;
  live?: boolean;
}

export interface FxHistory {
  /** Every fetch, oldest first. */
  updates: FxUpdate[];
  /** The series the panel's graph shows from the last fetch, oldest first. */
  dates: string[];
  values: number[];
}

/** The saved histories, by `BASE/QUOTE`. */
export type FxHistories = Record<string, FxHistory>;

const MAX_UPDATES = 10_000;

export const pairKey = (base: string, quote: string) => `${base}/${quote}`;

export const emptyFxHistory = (): FxHistory => ({ updates: [], dates: [], values: [] });

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const validUpdate = (u: any): u is FxUpdate =>
  !!u && typeof u.at === 'string' && Number.isFinite(Date.parse(u.at)) && num(u.value) && num(u.change) && num(u.percent);

/** Checks and cleans one saved history (from disk or from the browser's old storage). */
export function parseFxHistory(raw: unknown): FxHistory {
  const hit = (raw ?? {}) as Record<string, unknown>;
  const dates = Array.isArray(hit.dates) ? hit.dates : [];
  const values = Array.isArray(hit.values) ? hit.values : [];
  const sameSeries = dates.length === values.length && dates.every((d) => typeof d === 'string') && values.every(num);
  return {
    updates: (Array.isArray(hit.updates) ? hit.updates : []).filter(validUpdate).map((u) => ({ at: u.at, value: u.value, change: u.change, percent: u.percent, ...(u.live ? { live: true } : {}) })),
    dates: sameSeries ? (dates as string[]) : [],
    values: sameSeries ? (values as number[]) : [],
  };
}

export function parseFxHistories(raw: unknown): FxHistories {
  const out: FxHistories = {};
  if (raw && typeof raw === 'object') for (const [key, value] of Object.entries(raw)) out[key] = parseFxHistory(value);
  return out;
}

/** Adds one fetch to the history and keeps the updates of the last `days` days. */
export function addFxUpdate(prev: FxHistory, data: FxData, days: number, now: Date): FxHistory {
  const summary = summarize(data.values);
  if (!summary) return prev;
  const cutoff = now.getTime() - days * 86_400_000;
  const updates = [...prev.updates, { at: now.toISOString(), value: summary.value, change: summary.change, percent: summary.percent, live: data.live }]
    .filter((u) => Date.parse(u.at) >= cutoff)
    .slice(-MAX_UPDATES);
  return { updates, dates: data.dates, values: data.values };
}

/** Joins the updates of `extra` (e.g. a browser's old storage) into `prev`: one per fetch time, oldest first; the graph series stays `prev`'s unless it is empty. */
export function mergeFxHistory(prev: FxHistory, extra: FxHistory): FxHistory {
  const byTime = new Map<string, FxUpdate>();
  for (const u of [...extra.updates, ...prev.updates]) byTime.set(u.at, u);
  const updates = [...byTime.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-MAX_UPDATES);
  const useExtraSeries = prev.values.length === 0;
  return { updates, dates: useExtraSeries ? extra.dates : prev.dates, values: useExtraSeries ? extra.values : prev.values };
}
