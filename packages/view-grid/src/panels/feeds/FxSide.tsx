import { useEffect, useState } from 'react';
import type { SidePanelContent } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { currencyCode } from './fx';
import { emptyFxHistory } from './fx-history';
import { onFxHistory, readFxHistory } from './fx-history-web';
import type { FxConfig } from './ExchangeRate';
import './feeds.css';

const locale = (): string | undefined => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;
const fmt = (n: number, digits = 4) => n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

function useHistory(config: FxConfig) {
  const [history, setHistory] = useState(emptyFxHistory);
  useEffect(() => {
    let live = true;
    const load = () => void readFxHistory(config).then((h) => live && setHistory(h), () => {});
    load();
    const off = onFxHistory(config, load);
    return () => {
      live = false;
      off();
    };
  }, [config.base, config.quote, config.days, config.apiKey]);
  return history;
}

function Delta({ change, percent, title }: { change: number; percent: number; title?: string }) {
  const sign = change > 0 ? '+' : '';
  const tone = change > 0 ? 'ok' : change < 0 ? 'danger' : 'neutral';
  return (
    <span className={`fx-history-change fx-${tone}`} title={title}>
      {`${sign}${fmt(change)} (${sign}${fmt(percent, 2)}%)`}
    </span>
  );
}

function Row({ label, value, change, percent, step }: { label: string; value: number; change: number; percent: number; step?: { change: number; percent: number } | null }) {
  return (
    <li className={step === undefined ? 'fx-history-row' : 'fx-history-row fx-history-row-steps'}>
      <span className="fx-history-date">{label}</span>
      <span className="fx-history-value">{fmt(value)}</span>
      {step === undefined ? null : step ? <Delta {...step} /> : <span className="fx-history-change fx-neutral">-</span>}
      <Delta change={change} percent={percent} />
    </li>
  );
}

const dayOf = (at: string) => new Date(at).toLocaleDateString('en-CA');

/** One line per fetch, newest first: the value, its move since the previous fetch, and its change vs. the first day of the period. */
function UpdatesList({ config }: { config: FxConfig }) {
  const { updates } = useHistory(config);
  if (updates.length === 0) return <p className="kit-empty">{tKey('dash.feeds.fx.empty')}</p>;
  const when = (at: string) => new Date(at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'medium' });
  const rows = updates.map((u, i) => {
    const prev = updates[i - 1];
    return { u, step: prev ? { change: u.value - prev.value, percent: prev.value ? ((u.value - prev.value) / prev.value) * 100 : 0 } : null };
  });
  return (
    <ul className="fx-history">
      <li className="fx-history-row fx-history-row-steps fx-history-head">
        <span />
        <span />
        <span>{tKey('dash.feeds.fx.history.step')}</span>
        <span>{tKey('dash.feeds.fx.history.period', { days: config.days })}</span>
      </li>
      {rows.reverse().flatMap(({ u, step }, i, all) => {
        const row = <Row key={u.at} label={when(u.at)} value={u.value} change={u.change} percent={u.percent} step={step} />;
        const day = dayOf(u.at);
        if (i > 0 && day === dayOf(all[i - 1]!.u.at)) return [row];
        return [<li key={`day-${u.at}`} className="fx-history-day">{new Date(u.at).toLocaleDateString(locale(), { dateStyle: 'full' })}</li>, row];
      })}
    </ul>
  );
}

/** The points of the panel's graph, newest first, each with its change vs. the first day. */
function GraphList({ config }: { config: FxConfig }) {
  const { dates, values } = useHistory(config);
  if (values.length === 0) return <p className="kit-empty">{tKey('dash.feeds.fx.empty')}</p>;
  const first = values[0]!;
  return (
    <ul className="fx-history">
      {dates
        .map((date, i) => ({ date, value: values[i]!, change: values[i]! - first, percent: first ? ((values[i]! - first) / first) * 100 : 0 }))
        .reverse()
        .map((p) => (
          <Row key={p.date} label={p.date} value={p.value} change={p.change} percent={p.percent} />
        ))}
    </ul>
  );
}

/** What the Exchange rate panel opens in the Dashboard side panel: every fetch, and the numbers of the graph. */
export function fxSideContent(config: FxConfig): SidePanelContent {
  const base = currencyCode(config.base, 'EUR');
  const quote = currencyCode(config.quote, 'BRL');
  return {
    id: `exchange-rate:${base}/${quote}`,
    title: `${base}/${quote}`,
    subtitle: tKey('dash.feeds.fx.history.subtitle', { days: config.days }),
    icon: 'history',
    tabs: [
      { id: 'updates', label: tKey('dash.feeds.fx.history.updates'), render: () => <UpdatesList config={config} /> },
      { id: 'graph', label: tKey('dash.feeds.fx.history.graph'), render: () => <GraphList config={config} /> },
    ],
  };
}
