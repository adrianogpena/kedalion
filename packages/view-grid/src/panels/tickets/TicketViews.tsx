import { useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ContextMenu } from '@kedalion/ui';
import { tKey } from '../../i18n';
import type { Drift } from './drift';
import { columns, type Ticket } from './model';
import { doneLabelOf, type TicketMenuItems } from './TicketCard';
import type { Stage, TicketsData } from './types';

/** What every layout gets from the panel. */
export interface TicketViewProps {
  id: string;
  tickets: Ticket[];
  statuses: string[];
  data: TicketsData;
  driftFor(t: Ticket): Drift | null;
  selected(t: Ticket): boolean;
  onDetails(t: Ticket): void;
  menuFor(t: Ticket): TicketMenuItems;
  move(id: string, status: string, index: number): void;
}

const DAY_MS = 86_400_000;
const OLD_DAYS = 7;
const STAGES = ['branch', 'pr', 'pods'] as const;

const titleOf = (t: Ticket, data: TicketsData): string => t.description || data.jira?.[t.key]?.summary || '';

/** Whole days since the ticket entered its column; null when unknown. */
const daysIn = (t: Ticket, now = Date.now()): number | null => (t.movedAt === undefined ? null : Math.max(0, Math.floor((now - t.movedAt) / DAY_MS)));

const stagesOf = (t: Ticket, data: TicketsData): Record<(typeof STAGES)[number], Stage> | null => data.links?.[t.key]?.stages ?? null;

/** 'bad' for a failing stage, 'warn' for a warning stage or Jira drift, '' otherwise. */
function troubleOf(t: Ticket, p: TicketViewProps): '' | 'warn' | 'bad' {
  const s = stagesOf(t, p.data);
  if (s && STAGES.some((k) => s[k] === 'fail')) return 'bad';
  if ((s && STAGES.some((k) => s[k] === 'warn')) || p.driftFor(t)) return 'warn';
  return '';
}

function Pipe({ t, data }: { t: Ticket; data: TicketsData }) {
  const s = stagesOf(t, data);
  const title = STAGES.map((k) => `${tKey(`dash.tickets.pipeline.${k}`)}: ${s ? s[k] : '…'}`).join('\n');
  return (
    <span className={`tickets-mpipe${s ? '' : ' tickets-pipe-loading'}`} title={title}>
      {STAGES.map((k) => <i key={k} className={s ? `tickets-mpipe-${s[k]}` : ''} />)}
    </span>
  );
}

function Age({ t }: { t: Ticket }) {
  const d = daysIn(t);
  if (d === null) return null;
  return (
    <span className={`tickets-age${d >= OLD_DAYS ? ' tickets-age-old' : ''}`} title={tKey('dash.tickets.age.title', { n: d })}>
      {d === 0 ? tKey('dash.tickets.age.today') : tKey('dash.tickets.age', { n: d })}
    </span>
  );
}

function Tags({ t, p, jira = true, pcr = true }: { t: Ticket; p: TicketViewProps; jira?: boolean; pcr?: boolean }) {
  const status = p.data.jira?.[t.key]?.status;
  const drift = p.driftFor(t);
  const done = doneLabelOf(status);
  return (
    <>
      {pcr && t.pcr && <span className="tickets-pcr">PCR#{t.pcr}</span>}
      {jira && drift && (
        <span className={`tickets-drift tickets-drift--${drift.direction}`} title={tKey('dash.tickets.drift.title', { status: status ?? '', column: t.status, expected: drift.expected })}>
          {tKey('dash.tickets.drift.chip', { status: status ?? '' })}
        </span>
      )}
      {jira && !drift && done && <span className="tickets-jira-done">{done}</span>}
    </>
  );
}

/** Click, keyboard, context menu and drag handlers shared by the rows and cards of every layout. */
function useItem(p: TicketViewProps) {
  const [menu, setMenu] = useState<{ t: Ticket; x: number; y: number } | null>(null);
  const props = (t: Ticket, draggable = true) => ({
    tabIndex: 0,
    role: 'button',
    'aria-pressed': p.selected(t),
    draggable,
    onClick: () => p.onDetails(t),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        p.onDetails(t);
      }
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ t, x: e.clientX, y: e.clientY });
    },
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', t.id);
      e.dataTransfer.effectAllowed = 'move';
    },
  });
  const node: ReactNode = menu && <ContextMenu at={menu} onClose={() => setMenu(null)} items={p.menuFor(menu.t)} />;
  return { props, menu: node };
}

/** Drop handlers for one status group; the index is found among the `itemSelector` elements under the target. */
function useDrop(p: TicketViewProps, itemSelector: string) {
  const [over, setOver] = useState<string | null>(null);
  const index = (e: DragEvent<HTMLElement>): number => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(itemSelector));
    for (let i = 0; i < items.length; i++) {
      const r = items[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return items.length;
  };
  const props = (zone: string, status: string, atEnd = false) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setOver(zone);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const at = atEnd ? Number.MAX_SAFE_INTEGER : index(e);
      setOver(null);
      if (id) p.move(id, status, at);
    },
  });
  return { over, props };
}

const selClass = (p: TicketViewProps, t: Ticket) => (p.selected(t) ? ' tickets-sel' : '');

/** One row per ticket, grouped by status; groups fold. */
export function TicketListView(p: TicketViewProps) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const item = useItem(p);
  const drop = useDrop(p, '.tickets-lrow');
  const toggle = (s: string) => setFolded((f) => {
    const n = new Set(f);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    return n;
  });
  return (
    <div className="tickets-list">
      {columns(p.tickets, p.statuses).map((col) => {
        const drifts = col.tickets.filter((t) => p.driftFor(t)).length;
        const isFolded = folded.has(col.status);
        return (
          <section key={col.status} className={`tickets-lgroup${drop.over === col.status ? ' tickets-over' : ''}`} {...drop.props(col.status, col.status, isFolded)}>
            <button type="button" className="tickets-lhead" aria-expanded={!isFolded} onClick={() => toggle(col.status)}>
              <span className="tickets-fold">{isFolded ? '▸' : '▾'}</span>
              <span>{col.status}</span>
              <span className="tickets-count">{col.tickets.length}</span>
              {drifts > 0 && <span className="tickets-drift-count" title={tKey('dash.tickets.drift.count', { n: drifts })}>{drifts}</span>}
            </button>
            {!isFolded && col.tickets.map((t) => (
              <div key={t.id} className={`tickets-lrow tickets-trouble-${troubleOf(t, p) || 'none'}${selClass(p, t)}`} {...item.props(t)}>
                <span className="tickets-mkey">{t.key}</span>
                <span className="tickets-ltitle" title={titleOf(t, p.data)}>{titleOf(t, p.data)}</span>
                <span className="tickets-ltags"><Tags t={t} p={p} /></span>
                <Pipe t={t} data={p.data} />
                <Age t={t} />
              </div>
            ))}
            {!isFolded && col.tickets.length === 0 && <p className="tickets-lempty">{tKey('dash.tickets.empty')}</p>}
          </section>
        );
      })}
      {item.menu}
    </div>
  );
}

/** One row per ticket with a step per status; clicking a step moves the ticket there. */
export function TicketProgressView(p: TicketViewProps) {
  const item = useItem(p);
  const rank = (t: Ticket) => Math.max(0, p.statuses.indexOf(t.status));
  const rows = [...p.tickets].sort((a, b) => rank(b) - rank(a) || a.order - b.order);
  const tpl = { gridTemplateColumns: `repeat(${p.statuses.length}, minmax(0, 1fr))` };
  return (
    <div className="tickets-prog">
      <div className="tickets-prow tickets-prow-head">
        <span />
        <span />
        <div className="tickets-steps" style={tpl}>
          {p.statuses.map((s) => <span key={s} title={s}>{s}</span>)}
        </div>
        <span />
        <span />
      </div>
      {rows.map((t) => {
        const at = rank(t);
        const drift = p.driftFor(t);
        const jiraAt = drift ? p.statuses.indexOf(drift.expected) : -1;
        return (
          <div key={t.id} className={`tickets-prow tickets-trouble-${troubleOf(t, p) || 'none'}${selClass(p, t)}`} {...item.props(t, false)}>
            <span className="tickets-mkey">{t.key}</span>
            <span className="tickets-ptitle" title={titleOf(t, p.data)}>
              <span className="tickets-ltitle">{titleOf(t, p.data)}</span>
              <Tags t={t} p={p} jira={false} />
            </span>
            <div className="tickets-steps" style={tpl}>
              {p.statuses.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`tickets-step${i < at ? ' tickets-step-past' : i === at ? ' tickets-step-cur' : ''}${i === jiraAt ? ' tickets-step-jira' : ''}`}
                  title={i === at ? s : i === jiraAt ? tKey('dash.tickets.drift.title', { status: p.data.jira?.[t.key]?.status ?? '', column: t.status, expected: s }) : tKey('dash.tickets.moveTo', { column: s })}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (i !== at) p.move(t.id, s, Number.MAX_SAFE_INTEGER);
                  }}
                />
              ))}
            </div>
            <Pipe t={t} data={p.data} />
            <Age t={t} />
          </div>
        );
      })}
      {rows.length === 0 && <p className="kit-empty">{tKey('dash.tickets.empty')}</p>}
      {item.menu}
    </div>
  );
}

function MiniCard({ t, p, item, pcr = true }: { t: Ticket; p: TicketViewProps; item: ReturnType<typeof useItem>; pcr?: boolean }) {
  const tags = (pcr && t.pcr) || p.driftFor(t) || doneLabelOf(p.data.jira?.[t.key]?.status);
  return (
    <div className={`tickets-mini tickets-trouble-${troubleOf(t, p) || 'none'}${selClass(p, t)}`} {...item.props(t)}>
      <div className="tickets-mini-l1">
        <span className="tickets-mkey">{t.key}</span>
        <Age t={t} />
        <Pipe t={t} data={p.data} />
      </div>
      <div className="tickets-mini-l2" title={titleOf(t, p.data)}>{titleOf(t, p.data)}</div>
      {tags && <div className="tickets-tags"><Tags t={t} p={p} pcr={pcr} /></div>}
    </div>
  );
}

/** The board with one row per PCR; dropping in a cell changes only the status. */
export function TicketLanesView(p: TicketViewProps) {
  const item = useItem(p);
  const drop = useDrop(p, '.tickets-mini');
  const pcrs = [...new Set(p.tickets.map((t) => t.pcr ?? ''))].sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || Number(a) - Number(b) || a.localeCompare(b));
  const tpl = { gridTemplateColumns: `minmax(90px, 140px) repeat(${p.statuses.length}, minmax(120px, 1fr))` };
  return (
    <div className="tickets-lanes">
      <div className="tickets-lanegrid" style={tpl}>
        <div className="tickets-lane-h" />
        {p.statuses.map((s) => <div key={s} className="tickets-lane-h" title={s}>{s}</div>)}
        {pcrs.map((pcr) => {
          const lane = p.tickets.filter((t) => (t.pcr ?? '') === pcr);
          const cols = columns(lane, p.statuses);
          return [
            <div key={`${pcr}-name`} className="tickets-lane-name">
              {pcr ? <span className="tickets-pcr">PCR#{pcr}</span> : <span>{tKey('dash.tickets.lane.noPcr')}</span>}
              <span className="tickets-lane-n">{tKey('dash.tickets.lane.count', { n: lane.length })}</span>
            </div>,
            ...cols.map((col) => {
              const zone = `${pcr}|${col.status}`;
              return (
                <div key={zone} className={`tickets-lane-cell${drop.over === zone ? ' tickets-over' : ''}`} {...drop.props(zone, col.status, true)}>
                  {col.tickets.map((t) => <MiniCard key={t.id} t={t} p={p} item={item} pcr={false} />)}
                </div>
              );
            }),
          ];
        })}
      </div>
      {pcrs.length === 0 && <p className="kit-empty">{tKey('dash.tickets.empty')}</p>}
      {item.menu}
    </div>
  );
}

const foldKey = (id: string) => `kedalion.tickets.folded.${id}`;

function readFolded(id: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(foldKey(id)) ?? 'null');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** The board with shared-width columns, two-line cards and columns that fold to a rail (the last one folded by default). */
export function TicketCompactView(p: TicketViewProps) {
  const [folded, setFolded] = useState<string[]>(() => readFolded(p.id) ?? p.statuses.slice(-1));
  const item = useItem(p);
  const drop = useDrop(p, '.tickets-mini');
  const toggle = (s: string) => {
    const next = folded.includes(s) ? folded.filter((x) => x !== s) : [...folded, s];
    setFolded(next);
    try {
      localStorage.setItem(foldKey(p.id), JSON.stringify(next));
    } catch {
      /* the fold state is a convenience */
    }
  };
  return (
    <div className="tickets-cb">
      {columns(p.tickets, p.statuses).map((col) => {
        const drifts = col.tickets.filter((t) => p.driftFor(t)).length;
        if (folded.includes(col.status)) {
          return (
            <button key={col.status} type="button" className={`tickets-cb-rail${drop.over === col.status ? ' tickets-over' : ''}`} title={tKey('dash.tickets.expand', { column: col.status })} onClick={() => toggle(col.status)} {...drop.props(col.status, col.status, true)}>
              <span>{col.status}</span>
              <span className="tickets-count">{col.tickets.length}</span>
            </button>
          );
        }
        return (
          <section key={col.status} className={`tickets-cb-col${drop.over === col.status ? ' tickets-over' : ''}`} {...drop.props(col.status, col.status)}>
            <button type="button" className="tickets-cb-head" title={tKey('dash.tickets.collapse', { column: col.status })} onClick={() => toggle(col.status)}>
              <span>{col.status}</span>
              {drifts > 0 && <span className="tickets-drift-count" title={tKey('dash.tickets.drift.count', { n: drifts })}>{drifts}</span>}
              <span className="tickets-count">{col.tickets.length}</span>
            </button>
            <div className="tickets-cb-cards">
              {col.tickets.map((t) => <MiniCard key={t.id} t={t} p={p} item={item} />)}
              {col.tickets.length === 0 && <p className="tickets-lempty">{tKey('dash.tickets.empty')}</p>}
            </div>
          </section>
        );
      })}
      {item.menu}
    </div>
  );
}
