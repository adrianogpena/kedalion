import { useEffect, useState } from 'react';
import type { RestHistoryEntry } from '@kedalion/server-core/protocol';
import { type ApiError, Button, ContextMenu, copyNotify, ErrorBanner, errorOf, IconButton, useAsync, type useDialogs } from '@kedalion/ui';
import { restApi as api } from '../client';
import { t } from '../i18n';
import { openRestTab } from './tabs-store';

const timeOf = (at: number) => new Date(at).toLocaleString();

/** Sent REST requests, newest first: search by method and URL, click to open the draft in a new tab, clear with a confirm. */
export function HistoryPanel({ refresh, confirm, onClose }: { refresh: number; confirm: ReturnType<typeof useDialogs>['confirm']; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [actionError, setActionError] = useState<ApiError>();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entry: RestHistoryEntry } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const history = useAsync(() => api.restHistory(debounced), [debounced, refresh]);

  const open = (entry: RestHistoryEntry) => {
    setActionError(undefined);
    if (openRestTab(entry.draft) === null) setActionError({ message: t('rest.tab.full') } as ApiError);
  };

  const clear = async () => {
    if (!(await confirm({ title: t('rest.history.clearTitle'), okLabel: t('rest.history.clear'), danger: true }))) return;
    setActionError(undefined);
    try {
      await api.clearRestHistory();
    } catch (err) {
      setActionError(errorOf(err));
    } finally {
      history.reload();
    }
  };

  return (
    <aside className="rest-history">
      <div className="rest-history-head">
        <span className="mono-label">{t('rest.history.title')}</span>
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon="trash" onClick={() => void clear()} disabled={!history.data?.length} title={t('rest.history.clear')}>{t('rest.history.clear')}</Button>
        <IconButton icon="close" onClick={onClose} label={t('rest.history.close')} />
      </div>
      <input
        className="rest-history-search"
        type="search"
        value={query}
        placeholder={t('rest.history.search')}
        aria-label={t('rest.history.search')}
        onChange={(e) => setQuery(e.target.value)}
      />
      {actionError && <ErrorBanner error={actionError} compact />}
      {history.error && <ErrorBanner error={history.error} onRetry={history.reload} compact />}
      {history.data?.length === 0 && <p className="muted">{t('rest.history.empty')}</p>}
      <div className="rest-history-list">
        {history.data?.map((entry) => (
          <button
            key={entry.id}
            className="rest-history-item"
            onClick={() => open(entry)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ at: { x: e.clientX, y: e.clientY }, entry });
            }}
            title={entry.url}
          >
            <span className="rest-method">{entry.method}</span>
            <span className="rest-history-url">{entry.url}</span>
            <span className={`rest-history-status${entry.error || entry.status >= 400 ? ' err' : ''}`}>{entry.error ?? entry.status}</span>
            <span className="rest-history-meta">{entry.ms} ms · {timeOf(entry.at)}</span>
          </button>
        ))}
      </div>
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            { id: 'open', label: t('rest.menu.open'), icon: 'send', run: () => open(menu.entry) },
            { id: 'copy', label: t('rest.menu.copyUrl'), icon: 'copy', run: () => void copyNotify(menu.entry.url) },
          ]}
        />
      )}
    </aside>
  );
}
