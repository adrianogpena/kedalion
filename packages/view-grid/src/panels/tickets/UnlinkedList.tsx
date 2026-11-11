import { useState, type ComponentProps } from 'react';
import { Button, ContextMenu, copyNotify, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { workloadName, type Ticket } from './model';
import type { UnlinkedKey } from './types';

/** Keys carried by PRs or pods that have no card; keys only seen through review-requested PRs are left out. */
export const visibleUnlinked = (list: readonly UnlinkedKey[]): UnlinkedKey[] =>
  list.filter((u) => u.pods.length > 0 || u.prs.some((p) => p.scope !== 'review'));

interface Props {
  unlinked: readonly UnlinkedKey[];
  tickets: readonly Ticket[];
  onAdd(key: string): void;
  onLink(key: string, ticketId: string): void;
}

export function UnlinkedList({ unlinked, tickets, onAdd, onLink }: Props) {
  const [open, setOpen] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ComponentProps<typeof ContextMenu>['items'] } | null>(null);
  const list = visibleUnlinked(unlinked);
  if (!list.length) return null;
  return (
    <section className="tickets-unlinked">
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      <Button variant="ghost" size="xs" className="tickets-unlinked-head" icon={open ? 'chevron-down' : 'chevron'} aria-expanded={open} aria-label={tKey('dash.tickets.unlinked.toggle')} onClick={() => setOpen(!open)}>
        {tKey('dash.tickets.unlinked.title', { count: list.length })}
      </Button>
      {open &&
        list.map((u) => (
          <div
            key={u.key}
            className="tickets-unlinked-row"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({
                at: { x: e.clientX, y: e.clientY },
                items: [
                  { id: 'add', label: tKey('dash.tickets.unlinked.add'), icon: 'plus', run: () => onAdd(u.key) },
                  ...(tickets.length > 0 ? [{ id: 'link', label: tKey('dash.tickets.unlinked.link'), icon: 'link' as const, run: () => { setLinking(u.key); setChoice(''); } }] : []),
                  'sep' as const,
                  { id: 'copy', label: tKey('dash.tickets.copyKey'), icon: 'copy' as const, run: () => void copyNotify(u.key) },
                ],
              });
            }}
          >
            <strong>{u.key}</strong>
            <span className="tickets-unlinked-names">{[...u.prs.map((p) => p.title), ...new Set(u.pods.map((p) => workloadName(p.name)))].join(' · ')}</span>
            <Button onClick={() => onAdd(u.key)}>
              <Icon name="plus" size={12} /> {tKey('dash.tickets.unlinked.add')}
            </Button>
            {tickets.length > 0 &&
              (linking === u.key ? (
                <>
                  <select value={choice} aria-label={tKey('dash.tickets.unlinked.pick')} onChange={(e) => setChoice(e.target.value)}>
                    <option value="">{tKey('dash.tickets.unlinked.pick')}</option>
                    {tickets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.key}
                        {t.description ? ` - ${t.description.slice(0, 60)}` : ''}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!choice}
                    onClick={() => {
                      onLink(u.key, choice);
                      setLinking(null);
                      setChoice('');
                    }}
                  >
                    <Icon name="plus" size={12} /> {tKey('dash.tickets.detail.link')}
                  </Button>
                  <Button onClick={() => setLinking(null)}>{tKey('dash.tickets.unlinked.cancel')}</Button>
                </>
              ) : (
                <Button
                  onClick={() => {
                    setLinking(u.key);
                    setChoice('');
                  }}
                >
                  {tKey('dash.tickets.unlinked.link')}
                </Button>
              ))}
          </div>
        ))}
    </section>
  );
}
