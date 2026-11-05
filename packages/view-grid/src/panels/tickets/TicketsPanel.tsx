import { useEffect, useState, type DragEvent } from 'react';
import { tKey } from '../../i18n';
import { type PanelSide } from '../../panel';
import { runAction } from '../../source';
import { driftOf, parseJiraMap } from './drift';
import { columns, type Ticket } from './model';
import { TicketCard } from './TicketCard';
import { boardTicketSide } from './TicketSide';
import { UnlinkedList } from './UnlinkedList';
import type { TicketsData } from './types';
import './tickets.css';

export interface TicketsConfig {
  statuses: string;
  keyPattern: string;
  jiraMap?: string;
  jiraBaseUrl: string;
  [key: string]: unknown;
}

interface Props {
  id: string;
  side?: PanelSide;
  config: TicketsConfig;
  data: TicketsData | undefined;
  refresh(): void;
}

const TICKETS_LOCAL_EVENT = 'tickets:local';

/** Shows `tickets` on the board now, until the next load replaces them. */
export const showTicketsNow = (tickets: Ticket[]) => window.dispatchEvent(new CustomEvent(TICKETS_LOCAL_EVENT, { detail: tickets }));

export function TicketsPanel({ id, side, config, data, refresh }: Props) {
  const [error, setError] = useState('');
  const [over, setOver] = useState<{ status: string; index: number } | null>(null);
  const [local, setLocal] = useState<Ticket[] | null>(null);

  useEffect(() => setLocal(null), [data]);

  useEffect(() => {
    const handler = (e: Event) => setLocal((e as CustomEvent<Ticket[]>).detail);
    window.addEventListener(TICKETS_LOCAL_EVENT, handler);
    return () => window.removeEventListener(TICKETS_LOCAL_EVENT, handler);
  }, []);

  if (!data) return null;

  const act = async (name: string, payload: unknown) => {
    try {
      setLocal(await runAction<Ticket[]>('tickets', name, config, payload));
      setError('');
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
    refresh();
  };

  const dropIndex = (e: DragEvent<HTMLElement>, count: number): number => {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.tickets-card'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return count;
  };

  const tickets = local ?? data.tickets;
  const cols = columns(tickets, data.statuses);
  const jiraMap = parseJiraMap(config.jiraMap ?? '');
  const driftFor = (t: Ticket) => driftOf(t, data.jira?.[t.key]?.status, data.statuses, jiraMap);
  const content = (t: Ticket) => boardTicketSide({ instanceId: id, ticket: t, data, config, side, onChanged: refresh });
  const toggle = (t: Ticket) => {
    if (!side) return;
    const c = content(t);
    if (side.isOpen(c.id)) side.close();
    else side.open(c);
  };

  return (
    <div className="tickets">
      {error && <div className="tickets-error" role="alert">{error}</div>}
      <div className="tickets-board">
        {cols.map((col) => (
          <section
            key={col.status}
            className={`tickets-col${over?.status === col.status ? ' tickets-col-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver({ status: col.status, index: dropIndex(e, col.tickets.length) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const index = dropIndex(e, col.tickets.length);
              setOver(null);
              if (id) void act('move', { id, status: col.status, index });
            }}
          >
            <h4 className="tickets-col-head">
              <span>{col.status}</span>
              <span className="tickets-count">{col.tickets.length}</span>
              {col.tickets.filter((t) => driftFor(t)).length > 0 && (
                <span className="tickets-drift-count" title={tKey('dash.tickets.drift.count', { n: col.tickets.filter((t) => driftFor(t)).length })}>
                  {col.tickets.filter((t) => driftFor(t)).length}
                </span>
              )}
            </h4>
            <div className="tickets-cards">
              {col.tickets.length === 0 && <p className="kit-empty">{tKey('dash.tickets.empty')}</p>}
              {col.tickets.map((t) => {
                const drift = driftFor(t);
                return (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  jiraStatus={data.jira?.[t.key]?.status}
                  drift={drift}
                  onMoveToExpected={() => drift && void act('move', { id: t.id, status: drift.expected, index: Number.MAX_SAFE_INTEGER })}
                  onMuteDrift={() => void act('set-jira-muted', { id: t.id, value: data.jira?.[t.key]?.status ?? '' })}
                  selected={!!side && side.isOpen(content(t).id)}
                  jiraBaseUrl={config.jiraBaseUrl}
                  onDelete={() => void act('remove', { id: t.id })}
                  autoMoveDefault={config.autoMove !== false}
                  onAutoMove={(value) => void act('set-auto-move', { id: t.id, value })}
                  onDetails={() => toggle(t)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {data.unlinked && (
        <UnlinkedList
          unlinked={data.unlinked}
          tickets={tickets}
          onAdd={(k) => void act('add', { key: k })}
          onLink={(k, ticketId) => void act('link-key', { id: ticketId, key: k })}
        />
      )}
    </div>
  );
}
