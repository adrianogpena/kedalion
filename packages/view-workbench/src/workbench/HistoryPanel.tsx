import { useEffect, useState } from 'react';
import { Button, ContextMenu, copyNotify, errorMessage, errorOf, IconButton, Spinner, useToast } from '@kedalion/ui';
import type { SqlHistoryEntry } from '@kedalion/server-core/protocol';
import type { WorkbenchClient } from '../client';
import { t } from '../i18n';

const SEARCH_DELAY = 250;

export interface HistoryPanelProps {
  client: WorkbenchClient;
  /** Only this connection's entries; all when omitted. */
  connection?: string;
  /** Changes after each run, to reload the list. */
  refresh: number;
  connectionName: (id: string) => string;
  /** Click: insert at the cursor. */
  onInsert: (sql: string) => void;
  /** Alt+click: replace the document. */
  onOpen: (sql: string) => void;
  confirm: (options: { title: string; body: string; okLabel: string; danger?: boolean }) => Promise<boolean>;
}

const firstLine = (sql: string) => sql.trim().split('\n')[0] ?? '';

/** Past SQL runs, newest first, filtered by a search box. */
export function HistoryPanel({ client, connection, refresh, connectionName, onInsert, onOpen, confirm }: HistoryPanelProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<SqlHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entry: SqlHistoryEntry } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    client.listHistory({ q: q || undefined, connection }).then(
      (list) => {
        if (live) setEntries([...list].sort((a, b) => b.at - a.at));
      },
      (err) => {
        if (live) toast({ message: errorMessage(errorOf(err)), kind: 'error' });
      },
    ).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
    // Deps are deliberately partial.
  }, [q, connection, refresh, reloads]);

  const remove = async (id: string) => {
    try {
      await client.deleteHistory([id]);
      setEntries((list) => list.filter((e) => e.id !== id));
    } catch (err) {
      toast({ message: errorMessage(errorOf(err)), kind: 'error' });
    }
  };

  const clear = async () => {
    if (!(await confirm({ title: t('workbench.history.clear'), body: t('workbench.history.clearConfirm'), okLabel: t('workbench.history.clear'), danger: true }))) return;
    try {
      await client.clearHistory();
      setReloads((n) => n + 1);
    } catch (err) {
      toast({ message: errorMessage(errorOf(err)), kind: 'error' });
    }
  };

  return (
    <aside className="wb-history">
      <div className="wb-schema-head">
        <span className="mono-label">{t('workbench.history')}</span>
        {loading && <Spinner small />}
        <Button size="sm" variant="ghost" icon="trash" onClick={clear} disabled={entries.length === 0} title={t('workbench.history.clear')}>{t('workbench.history.clear')}</Button>
      </div>
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('workbench.history.search')} aria-label={t('workbench.history.search')} />
      <ul className="wb-history-list">
        {entries.map((e) => (
          <li
            key={e.id}
            className="wb-history-entry"
            onContextMenu={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              setMenu({ at: { x: ev.clientX, y: ev.clientY }, entry: e });
            }}
          >
            <button
              className="wb-history-pick"
              onClick={(ev) => (ev.altKey ? onOpen(e.sql) : onInsert(e.sql))}
              title={`${e.sql}\n\n${t('workbench.history.pick')}`}
            >
              <span className="wb-history-meta muted">
                <span>{new Date(e.at).toLocaleString()}</span>
                <span className="wb-schema-name">{connectionName(e.connectionId)}</span>
              </span>
              <span className="wb-history-sql">{firstLine(e.sql)}</span>
              {e.error ? (
                <span className="wb-history-error">{e.error}</span>
              ) : (
                <span className="muted">{t('workbench.history.result', { rows: e.rows ?? '-', ms: e.ms })}</span>
              )}
            </button>
            <IconButton size="xs" icon="trash" onClick={() => remove(e.id)} label={t('workbench.history.delete')} />
          </li>
        ))}
      </ul>
      {!loading && entries.length === 0 && <span className="muted wb-schema-more">{t('workbench.history.none')}</span>}
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            { id: 'insert', label: t('workbench.history.menu.insert'), icon: 'plus', run: () => onInsert(menu.entry.sql) },
            { id: 'open', label: t('workbench.history.menu.open'), icon: 'file-text', run: () => onOpen(menu.entry.sql) },
            { id: 'copy', label: t('workbench.history.menu.copy'), icon: 'copy', run: () => void copyNotify(menu.entry.sql) },
            'sep',
            { id: 'delete', label: t('workbench.history.delete'), icon: 'trash', danger: true, run: () => void remove(menu.entry.id) },
          ]}
        />
      )}
    </aside>
  );
}
