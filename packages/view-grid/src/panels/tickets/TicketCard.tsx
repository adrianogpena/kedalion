import { useState, type ComponentProps, type DragEvent, type MouseEvent } from 'react';
import { ContextMenu, copyNotify, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { AUTO_BADGE_MS } from './auto-move';
import type { Drift } from './drift';
import type { Ticket } from './model';

interface Props {
  ticket: Ticket;
  selected?: boolean;
  jiraBaseUrl: string;
  jiraStatus?: string;
  drift?: Drift | null;
  onMoveToExpected?(): void;
  onMuteDrift?(): void;
  onDelete(): void;
  /** The panel's auto-move setting: what a ticket stored before it had its own value follows. */
  autoMoveDefault: boolean;
  onAutoMove(value: boolean): void;
  onDetails(): void;
  onDragStart(e: DragEvent): void;
}

export const jiraUrl = (base: string, key: string): string => (base.trim() ? `${base.trim().replace(/\/+$/, '')}/browse/${key}` : '');

export function TicketCard({ ticket, selected, jiraBaseUrl, jiraStatus, drift, onMoveToExpected, onMuteDrift, onDelete, autoMoveDefault, onAutoMove, onDetails, onDragStart }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const url = jiraUrl(jiraBaseUrl, ticket.key);
  const driftItems: ComponentProps<typeof ContextMenu>['items'] = drift
    ? [
        'sep',
        { id: 'drift-move', label: tKey('dash.tickets.drift.move', { column: drift.expected }), icon: drift.direction === 'ahead' ? 'chevron' : 'back', run: () => onMoveToExpected?.() },
        { id: 'drift-mute', label: tKey('dash.tickets.drift.ignore'), icon: 'close', run: () => onMuteDrift?.() },
      ]
    : [];

  const open = (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className={`tickets-card${selected ? ' tickets-card--selected' : ''}`}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      draggable
      onDragStart={onDragStart}
      onContextMenu={open}
      onClick={onDetails}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onDetails();
        }
      }}
    >
      <div className="tickets-card-head">
        {url ? (
          <a className="tickets-key" href={url} target="_blank" rel="noreferrer" title={url} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noreferrer'); }}>
            {ticket.key}
          </a>
        ) : (
          <span className="tickets-key">{ticket.key}</span>
        )}
        <Icon name="grip" size={12} />
        {ticket.autoMovedAt !== undefined && Date.now() - ticket.autoMovedAt < AUTO_BADGE_MS && (
          <span className="tickets-auto" title={tKey('dash.tickets.autoMove.badgeTitle')}>
            {tKey('dash.tickets.autoMove.badge')}
          </span>
        )}
      </div>
      {(ticket.pcr || drift) && (
        <div className="tickets-tags">
        {ticket.pcr && (
          <span className="tickets-pcr" title={tKey('dash.tickets.detail.pcr')}>
            PCR#{ticket.pcr}
          </span>
        )}
        {drift && (
          <span role="button" tabIndex={0}
            className={`tickets-drift tickets-drift--${drift.direction}`}
            title={tKey('dash.tickets.drift.title', { status: jiraStatus ?? '', column: ticket.status, expected: drift.expected })}
            onClick={(e) => {
              e.stopPropagation();
              onMoveToExpected?.();
            }}
          >
            <Icon name={drift.direction === 'ahead' ? 'chevron' : 'back'} size={10} />
            {tKey('dash.tickets.drift.chip', { status: jiraStatus ?? '' })}
          </span>
        )}
        </div>
      )}
      {ticket.description && <div className="tickets-desc">{ticket.description}</div>}
      {menu && (
        <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { id: 'details', label: tKey('dash.tickets.details'), icon: 'file-text', run: onDetails },
            ...driftItems,
            'sep',
            { id: 'am-on', label: tKey('dash.tickets.autoMove.on'), radio: true, checked: (ticket.autoMove ?? autoMoveDefault) === true, run: () => onAutoMove(true) },
            { id: 'am-off', label: tKey('dash.tickets.autoMove.off'), radio: true, checked: (ticket.autoMove ?? autoMoveDefault) === false, run: () => onAutoMove(false) },
            'sep',
            { id: 'copy', label: tKey('dash.tickets.copyKey'), icon: 'copy', run: () => void copyNotify(ticket.key) },
            { id: 'open', label: tKey('dash.tickets.openJira'), icon: 'link', disabled: !url, run: () => window.open(url, '_blank', 'noreferrer') },
            'sep',
            { id: 'delete', label: tKey('dash.tickets.delete'), icon: 'trash', danger: true, run: onDelete },
          ]}
        />
        </span>
      )}
    </div>
  );
}
