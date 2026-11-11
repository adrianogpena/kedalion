import { useMemo, useState, type ComponentProps } from 'react';
import { ContextMenu, copyNotify } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import './calendar.css';
import { addDays, dayKey } from './dates';
import { dayTitle, timeOf, useToday } from './format';
import { eventDays, type IcsEvent } from './ics';

export interface AgendaConfig {
  icsUrl: string;
  days: number;
  showLocation: boolean;
  layout: 'list' | 'compact';
  [key: string]: unknown;
}

interface Entry {
  event: IcsEvent;
  /** Time text; empty for all-day. */
  time: string;
}

/** Events grouped by day for the `days` days from `today`: all-day first, then by start. */
export function groupByDay(events: readonly IcsEvent[], today: string, days: number): { day: string; entries: Entry[] }[] {
  const last = addDays(today, days - 1);
  const groups = new Map<string, Entry[]>();
  for (const event of events) {
    const startDay = event.allDay ? event.start : dayKey(new Date(event.start));
    for (const day of eventDays(event)) {
      if (day < today || day > last) continue;
      const time = event.allDay ? '' : day === startDay ? `${timeOf(event.start)} – ${timeOf(event.end)}` : `… – ${timeOf(event.end)}`;
      groups.set(day, [...(groups.get(day) ?? []), { event, time }]);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, entries]) => ({
      day,
      entries: entries.sort((a, b) => Number(!!a.time) - Number(!!b.time) || (a.event.start < b.event.start ? -1 : a.event.start > b.event.start ? 1 : 0)),
    }));
}

export function AgendaPanel({ config, events }: { config: AgendaConfig; events: readonly IcsEvent[] }) {
  const today = useToday();
  const groups = useMemo(() => groupByDay(events, today, config.days), [events, today, config.days]);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ComponentProps<typeof ContextMenu>['items'] } | null>(null);
  if (!config.icsUrl.trim()) return <p className="kit-empty">{tKey('dash.calendar.icsMissing')}</p>;
  if (groups.length === 0) return <p className="kit-empty">{tKey('dash.calendar.agendaEmpty')}</p>;
  return (
    <div className={config.layout === 'compact' ? 'agenda agenda-compact' : 'agenda'}>
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      {groups.map(({ day, entries }) => (
        <section key={day} className="agenda-day">
          <h4 className="agenda-day-title">
            {dayTitle(day)}
            {day === today && <Chip tone="info">{tKey('dash.calendar.todayLabel')}</Chip>}
          </h4>
          <ul className="agenda-list">
            {entries.map(({ event, time }, i) => (
              <li
                key={`${i}-${event.start}`}
                className="agenda-item"
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const link = event.url && /^https?:\/\//i.test(event.url) ? event.url : '';
                  setMenu({
                    at: { x: e.clientX, y: e.clientY },
                    items: [
                      ...(link ? [{ id: 'open', label: tKey('dash.calendar.openLink'), icon: 'link' as const, run: () => window.open(link, '_blank', 'noreferrer') }, 'sep' as const] : []),
                      { id: 'copy-title', label: tKey('dash.calendar.copyTitle'), icon: 'copy' as const, run: () => void copyNotify(event.summary) },
                      ...(event.location ? [{ id: 'copy-loc', label: tKey('dash.calendar.copyLocation'), icon: 'copy' as const, run: () => void copyNotify(event.location!) }] : []),
                    ],
                  });
                }}
              >
                <span className="agenda-time mono">{time || tKey('dash.calendar.allDay')}</span>
                <span className="agenda-main">
                  {event.url && /^https?:\/\//i.test(event.url) ? (
                    <a href={event.url} target="_blank" rel="noreferrer" title={event.summary}>{event.summary}</a>
                  ) : (
                    <span title={event.summary}>{event.summary}</span>
                  )}
                  {config.showLocation && config.layout !== 'compact' && event.location && <span className="agenda-loc">{event.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
