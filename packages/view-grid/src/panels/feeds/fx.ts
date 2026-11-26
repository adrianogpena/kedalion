export interface FxData {
  base: string;
  quote: string;
  /** `YYYY-MM-DD` per value. */
  dates: string[];
  /** The quote per base unit, oldest first. */
  values: number[];
  /** Set when the series comes from the live provider (Twelve Data) instead of the daily ECB reference. */
  live?: boolean;
}

export interface FxSummary {
  value: number;
  /** Change vs. the first day, in the quote currency. */
  change: number;
  /** Change vs. the first day, in percent. */
  percent: number;
}

/** The `YYYY-MM-DD` of `days` days before `now`, in UTC. */
export const startDate = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

export const currencyCode = (value: string, fallback: string): string => {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
};

/** The `BASE>QUOTE` pairs of a list like `USD>EUR, GBP>BRL` (also `/` or `-`), without invalid or repeated ones and without `skip`. */
export function parseTrack(value: string | undefined, skip: string): { base: string; quote: string }[] {
  const seen = new Set([skip]);
  const out: { base: string; quote: string }[] = [];
  for (const part of (value ?? '').split(/[,;\s]+/)) {
    const m = /^([A-Za-z]{3})[>/-]([A-Za-z]{3})$/.exec(part);
    if (!m) continue;
    const base = m[1]!.toUpperCase();
    const quote = m[2]!.toUpperCase();
    const key = `${base}>${quote}`;
    if (base === quote || seen.has(key)) continue;
    seen.add(key);
    out.push({ base, quote });
  }
  return out;
}

/** The rates of a Frankfurter time series (`{ rates: { date: { QUOTE: n } } }`), oldest first. */
export function mapSeries(raw: any, base: string, quote: string): FxData {
  const rates: Record<string, Record<string, unknown>> = raw?.rates && typeof raw.rates === 'object' ? raw.rates : {};
  const dates: string[] = [];
  const values: number[] = [];
  for (const date of Object.keys(rates).sort()) {
    const v = rates[date]?.[quote];
    if (typeof v === 'number' && Number.isFinite(v)) {
      dates.push(date);
      values.push(v);
    }
  }
  return { base, quote, dates, values };
}

/** The rates of a Twelve Data `time_series` response (`{ values: [{ datetime, close }] }`, newest first), oldest first. */
export function mapTwelveData(raw: any, base: string, quote: string): FxData {
  const rows: any[] = Array.isArray(raw?.values) ? raw.values : [];
  const points: { date: string; value: number }[] = [];
  for (const row of rows) {
    const value = Number(row?.close);
    if (typeof row?.datetime === 'string' && Number.isFinite(value)) points.push({ date: row.datetime.slice(0, 10), value });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { base, quote, dates: points.map((p) => p.date), values: points.map((p) => p.value), live: true };
}

/** Latest value and the change vs. the first day; undefined without data. */
export function summarize(values: readonly number[]): FxSummary | undefined {
  if (values.length === 0) return undefined;
  const value = values[values.length - 1]!;
  const firstValue = values[0]!;
  const change = value - firstValue;
  return { value, change, percent: firstValue ? (change / firstValue) * 100 : 0 };
}
