import { type ReactNode, useState } from 'react';
import { Button, ContextMenu, IconButton } from '@kedalion/ui';
import './panes-layout.css';

export interface PanesLayoutProps {
  /** Existing page actions (import, code, save, save as). */
  actions: ReactNode;
  banners: ReactNode;
  /** The chain strip, when a chain is open. */
  chain?: ReactNode;
  list: ReactNode;
  tabBar: ReactNode;
  request: ReactNode;
  response: ReactNode;
  history: ReactNode;
  dialogs: ReactNode;
}

type PaneId = 'collections' | 'request' | 'response';
const PANES: PaneId[] = ['collections', 'request', 'response'];

function PaneHead({ title, first, last, onClose, onMove, onCloseOthers }: { title: string; first: boolean; last: boolean; onClose: () => void; onMove: (d: -1 | 1) => void; onCloseOthers: () => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="dzr-pane-head">
      <span className="dzr-grip" aria-hidden="true">⋮⋮</span>
      <span className="mono-label">{title}</span>
      <span className="dzr-spacer" />
      <IconButton size="xs" icon="more" label="Pane menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.left, y: r.bottom + 4 }); }} />
      <IconButton size="xs" icon="close" label="Close pane" onClick={onClose} />
      {at && (
        <ContextMenu
          at={at}
          onClose={() => setAt(null)}
          items={[
            { id: 'left', label: 'Move left', disabled: first, run: () => onMove(-1) },
            { id: 'right', label: 'Move right', disabled: last, run: () => onMove(1) },
            'sep',
            { id: 'others', label: 'Close other panes', run: onCloseOthers },
            { id: 'close', label: 'Close pane', icon: 'close', run: onClose },
          ]}
        />
      )}
    </div>
  );
}

/** REST panes with grip, menu and close (the Bridge layout's pick). */
export function PanesLayout(p: PanesLayoutProps) {
  const [closed, setClosed] = useState<string[]>([]);
  const open = (id: string) => !closed.includes(id);
  const close = (id: string) => setClosed((c) => [...c, id]);
  const [order, setOrder] = useState<PaneId[]>(PANES);
  const move = (id: PaneId, d: -1 | 1) => setOrder((o) => {
    const shown = o.filter((x) => !closed.includes(x));
    const j = shown.indexOf(id) + d;
    if (j < 0 || j >= shown.length) return o;
    const other = shown[j]!;
    const n = [...o];
    const x = n.indexOf(id), y = n.indexOf(other);
    n[x] = other; n[y] = id;
    return n;
  });
  const closeOthers = (id: PaneId) => setClosed(PANES.filter((x) => x !== id));

  return (
    <div className="content screen-edges dzr-b">
      <div className="dzr-line">
        <span className="mono-label">REST</span>
        {p.actions}
        <span className="dzr-spacer" />
        {closed.length > 0 && <Button size="sm" icon="plus" onClick={() => setClosed((c) => c.slice(0, -1))} title="Add pane">+ pane</Button>}
        {closed.length === 0 && <Button size="sm" icon="plus" disabled title="Add pane">+ pane</Button>}
      </div>
      {p.banners}
      {p.chain}
      <div className="dzr-canvas">
        {order.filter(open).map((id, i, shown) => {
          const head = (title: string) => (
            <PaneHead title={title} first={i === 0} last={i === shown.length - 1} onClose={() => close(id)} onMove={(d) => move(id, d)} onCloseOthers={() => closeOthers(id)} />
          );
          if (id === 'collections') return <section key={id} className="dzr-pane dzr-pane-list">{head('Collections')}{p.list}</section>;
          if (id === 'request') return <section key={id} className="dzr-pane">{head('Request')}{p.tabBar}{p.request}</section>;
          return <section key={id} className="dzr-pane">{head('Response')}{p.response}</section>;
        })}
        {p.history}
      </div>
      {p.dialogs}
    </div>
  );
}
