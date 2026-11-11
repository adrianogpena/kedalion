import { useState, type ComponentProps, type CSSProperties } from 'react';
import { Button, ContextMenu, copyNotify, Icon, IconButton, type PanelConfig } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import type { PanelSide } from '../../panel';
import type { Ticket } from '../tickets/model';
import { boardTicketSide } from '../tickets/TicketSide';
import type { TicketsConfig } from '../tickets/TicketsPanel';
import type { TicketsData } from '../tickets/types';
import { NO_TICKET, parseDay, splitRoots, type DayTable } from './analysis';
import type { TimesheetResult } from './server';
import './timesheet.css';

export interface TimesheetPanelData extends TimesheetResult {
  /** The Tickets panel's config and last data, for opening a board ticket; absent without a Tickets panel. */
  board?: { config: TicketsConfig; data: TicketsData };
}

export interface TimesheetTable {
  tickets: string[];
  /** Hours per ticket and day (same order as `days`). */
  rows: { ticket: string; hours: number[]; commits: number; total: number }[];
  totals: number[];
  grand: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Rows and totals of the week, tickets sorted by total hours; "(no ticket)" last. */
export function tableOf(days: string[], table: DayTable): TimesheetTable {
  const names = new Set<string>();
  for (const day of days) for (const t of Object.keys(table[day] ?? {})) names.add(t);
  const rows = [...names].map((ticket) => {
    const hours = days.map((d) => table[d]?.[ticket]?.hours ?? 0);
    const commits = days.reduce((n, d) => n + (table[d]?.[ticket]?.commits ?? 0), 0);
    return { ticket, hours, commits, total: r2(hours.reduce((a, b) => a + b, 0)) };
  });
  rows.sort((a, b) => (a.ticket === NO_TICKET ? 1 : 0) - (b.ticket === NO_TICKET ? 1 : 0) || b.total - a.total || a.ticket.localeCompare(b.ticket));
  const totals = days.map((_, i) => r2(rows.reduce((n, r) => n + (r.hours[i] ?? 0), 0)));
  return { tickets: rows.map((r) => r.ticket), rows, totals, grand: r2(totals.reduce((a, b) => a + b, 0)) };
}

/** Hours as `h:mm`. */
export function hm(hours: number): string {
  const min = Math.round(hours * 60);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** Pill fill: a full 8-hour day is the strongest tint. */
const fill = (hours: number): CSSProperties => ({ '--fill': Math.min(hours / 8, 1).toFixed(2) }) as CSSProperties;

function Hours({ value, strong }: { value: number; strong?: boolean }) {
  if (Math.round(value * 60) === 0) return <span className="ts-zero">·</span>;
  return strong ? <span className="ts-total">{hm(value)}</span> : <span className="ts-h" style={fill(value)}>{hm(value)}</span>;
}

export function TimesheetPanel({ id, config, data, refresh, side }: { id: string; config: PanelConfig; data: TimesheetPanelData | undefined; refresh(): void; side?: PanelSide }) {
  const board = data?.board;
  const boardTicket = (key: string) => board?.data.tickets.find((t) => t.key.toUpperCase() === key);
  const toggleTicket = (ticket: Ticket) => {
    if (!side || !board) return;
    const c = boardTicketSide({ instanceId: id, ticket, data: board.data, config: board.config, side, onChanged: refresh });
    if (side.isOpen(c.id)) side.close();
    else side.open(c);
  };
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ComponentProps<typeof ContextMenu>['items'] } | null>(null);
  const days = Object.keys(data?.days ?? {}).sort();
  const table = tableOf(days, data?.days ?? {});
  const today = data?.today ?? '';
  const weekday = (d: string) => parseDay(d).toLocaleDateString(undefined, { weekday: 'short' });
  const date = (d: string) => parseDay(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const range = days.length ? `${date(days[0] as string)} – ${date(days[days.length - 1] as string)}` : '';
  const noRoots = splitRoots(typeof config.roots === 'string' ? config.roots : '').length === 0;

  return (
    <div className="ts">
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      <div className="ts-head">
        <span className="ts-range">{range}</span>
        {table.rows.length > 0 && (
          <span className="ts-week">{tKey('dash.timesheet.weekTotal')} <strong>{hm(table.grand)}</strong></span>
        )}
        <IconButton icon="refresh" size="xs" label={tKey('dash.timesheet.refresh')} onClick={refresh} />
      </div>
      {!data ? null : table.rows.length === 0 ? (
        <p className="kit-empty">{tKey(noRoots ? 'dash.timesheet.noRoots' : 'dash.timesheet.empty')}</p>
      ) : (
        <div className="ts-scroll">
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tKey('dash.timesheet.ticket')}</th>
                {days.map((d) => {
                  const name = `${weekday(d)} ${parseDay(d).getDate()}`;
                  return (
                    <th key={d} className={d === today ? 'ts-today' : undefined} title={d === today ? tKey('dash.timesheet.today') : undefined}>
                      {name}
                    </th>
                  );
                })}
                <th>{tKey('dash.timesheet.total')}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr
                  key={r.ticket}
                  onContextMenu={
                    r.ticket === NO_TICKET
                      ? undefined
                      : (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const bt = side ? boardTicket(r.ticket) : undefined;
                          setMenu({
                            at: { x: e.clientX, y: e.clientY },
                            items: [
                              ...(bt ? [{ id: 'open', label: tKey('dash.timesheet.openTicket', { key: r.ticket }), icon: 'link' as const, run: () => toggleTicket(bt) }, 'sep' as const] : []),
                              { id: 'copy-key', label: tKey('dash.timesheet.copyKey'), icon: 'copy' as const, run: () => void copyNotify(r.ticket) },
                            ],
                          });
                        }
                  }
                >
                  <td>
                    <span className={r.ticket === NO_TICKET ? 'ts-ticket ts-ticket--none' : 'ts-ticket'}>
                      {r.ticket === NO_TICKET ? (
                        tKey('dash.timesheet.noTicket')
                      ) : side && boardTicket(r.ticket) ? (
                        <Button variant="ghost" size="xs" className="ts-key" title={tKey('dash.timesheet.openTicket', { key: r.ticket })} onClick={() => toggleTicket(boardTicket(r.ticket)!)}>
                          {r.ticket}
                        </Button>
                      ) : (
                        r.ticket
                      )}
                      {r.commits > 0 && (
                        <Chip title={tKey('dash.timesheet.commits', { count: r.commits })}>
                          <Icon name="git-branch" size={10} />{r.commits}
                        </Chip>
                      )}
                    </span>
                  </td>
                  {r.hours.map((h, i) => (
                    <td key={days[i]} className={days[i] === today ? 'ts-num ts-today' : 'ts-num'}><Hours value={h} /></td>
                  ))}
                  <td className="ts-num"><Hours value={r.total} strong /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{tKey('dash.timesheet.dayTotal')}</td>
                {table.totals.map((h, i) => (
                  <td key={days[i]} className="ts-num"><Hours value={h} strong /></td>
                ))}
                <td className="ts-num"><Hours value={table.grand} strong /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
