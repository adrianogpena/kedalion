import { tKey } from '../../i18n';
import { Sparkline, StatTile } from '../../kit';
import './feeds.css';
import { summarize, type FxData } from './fx';

export interface FxConfig {
  base: string;
  quote: string;
  days: number;
  apiKey?: string;
  track?: string;
  [key: string]: unknown;
}

const locale = (): string | undefined => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;

export function ExchangeRatePanel({ config, data }: { config: FxConfig; data: FxData | undefined }) {
  const summary = data ? summarize(data.values) : undefined;
  if (!data || !summary) return <p className="kit-empty">{tKey('dash.feeds.fx.empty')}</p>;
  const fmt = (n: number, digits = 4) => n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = summary.change > 0 ? '+' : '';
  const tone = summary.change > 0 ? 'ok' : summary.change < 0 ? 'danger' : 'neutral';
  return (
    <div className="fx">
      <StatTile
        value={fmt(summary.value)}
        label={`1 ${data.base} → ${data.quote}`}
        tone={tone}
        delta={`${sign}${fmt(summary.change)} (${sign}${fmt(summary.percent, 2)}%) · ${tKey('dash.feeds.fx.period', { days: config.days })}`}
      />
      {data.values.length > 1 && <Sparkline values={data.values} height={40} title={`${data.base}/${data.quote}`} />}
      <p className="fx-note">{tKey(data.live ? 'dash.feeds.fx.note.live' : 'dash.feeds.fx.note', { date: data.dates[data.dates.length - 1] ?? '' })}</p>
      <a className="fx-verify"href={`https://www.xe.com/currencyconverter/convert/?Amount=1&From=${data.base}&To=${data.quote}`} target="_blank" rel="noreferrer">
        {tKey('dash.feeds.fx.verify')}
      </a>
    </div>
  );
}
