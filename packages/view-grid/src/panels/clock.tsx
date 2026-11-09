import { useEffect, useState } from 'react';
import { CLOCK_FIELDS } from '../clock-fields';
import { definePanel } from '../panel';
import { tKey } from '../i18n';

export interface ClockConfig {
  timeZone: string;
  hour12: boolean;
  showSeconds: boolean;
  showDate: boolean;
  layout: string;
  [key: string]: unknown;
}

/** The time and date formatted for `config`; an unknown time zone falls back to the local one (`valid: false`). */
export function formatClock(now: Date, config: ClockConfig): { time: string; date: string; valid: boolean } {
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', ...(config.showSeconds && { second: '2-digit' }), hour12: config.hour12 };
  const date: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  const zone = config.timeZone.trim();
  try {
    return {
      time: now.toLocaleTimeString(undefined, { ...time, ...(zone && { timeZone: zone }) }),
      date: now.toLocaleDateString(undefined, { ...date, ...(zone && { timeZone: zone }) }),
      valid: true,
    };
  } catch {
    return { time: now.toLocaleTimeString(undefined, time), date: now.toLocaleDateString(undefined, date), valid: false };
  }
}

function zoneParts(now: Date, timeZone: string): { h: number; m: number; s: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', ...(timeZone && { timeZone }) }).formatToParts(now);
  } catch {
    return { h: now.getHours(), m: now.getMinutes(), s: now.getSeconds() };
  }
  const num = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: num('hour'), m: num('minute'), s: num('second') };
}

function AnalogFace({ now, config }: { now: Date; config: ClockConfig }) {
  const { h, m, s } = zoneParts(now, config.timeZone.trim());
  const hand = (deg: number, length: number, width: number, stroke: string) => (
    <line x1="50" y1="50" x2="50" y2={50 - length} stroke={stroke} strokeWidth={width} strokeLinecap="round" transform={`rotate(${deg} 50 50)`} />
  );
  return (
    <svg className="grid-clock-face" viewBox="0 0 100 100" role="img" aria-label={formatClock(now, config).time}>
      <circle cx="50" cy="50" r="47" fill="none" stroke="var(--text-3)" strokeWidth="1.5" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="6" x2="50" y2={i % 3 === 0 ? 12 : 9} stroke="var(--text-3)" strokeWidth={i % 3 === 0 ? 2 : 1} transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {hand(((h % 12) + m / 60) * 30, 24, 3, 'var(--text)')}
      {hand((m + s / 60) * 6, 36, 2, 'var(--text)')}
      {config.showSeconds && hand(s * 6, 40, 1, 'var(--accent)')}
      <circle cx="50" cy="50" r="2.5" fill="var(--accent)" />
    </svg>
  );
}

function Clock({ config }: { config: ClockConfig }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), config.showSeconds ? 1000 : 10_000);
    return () => window.clearInterval(timer);
  }, [config.showSeconds]);
  const { time, date, valid } = formatClock(now, config);
  return (
    <div>
      {config.layout === 'analog' ? <AnalogFace now={now} config={config} /> : <div className="mono grid-clock-time">{time}</div>}
      {config.showDate && <div className="muted">{date}</div>}
      {!valid && <div className="muted">{tKey('grid.clock.invalidZone')}</div>}
    </div>
  );
}

/** Built-in kind `clock`: the time (and date) in a chosen time zone. */
export const clockPanel = definePanel<ClockConfig>({
  kind: 'clock',
  title: 'grid.panel.clock',
  description: 'grid.panel.clock.description',
  icon: 'refresh',
  category: 'dash.category.calendar',
  size: { w: 6, h: 8, minW: 3, minH: 4 },
  config: { fields: CLOCK_FIELDS },
  allowMultiple: true,
  render: ({ config }) => <Clock config={config} />,
});
