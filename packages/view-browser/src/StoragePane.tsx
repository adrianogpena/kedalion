import { useCallback, useEffect, useState } from 'react';
import { Button, ContextMenu, copyNotify, IconButton } from '@kedalion/ui';
import { browserApi, type StorageSnapshot, type StoreKind } from './client';
import { t } from './i18n';

const KINDS: StoreKind[] = ['local', 'session', 'indexeddb'];

export interface StoragePaneProps {
  tab: string;
  /** The page URL; the lists reload when it changes. */
  url: string | undefined;
}

/** localStorage, sessionStorage and IndexedDB of the page origin, with edit, delete and clear; plus "clear site data". */
export function StoragePane({ tab, url }: StoragePaneProps) {
  const [kind, setKind] = useState<StoreKind>('local');
  const [snap, setSnap] = useState<StorageSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [cache, setCache] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; key: string; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setSnap(await browserApi.storage(tab));
    } catch {
      setSnap(null);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load, url]);

  const items = !snap ? [] : kind === 'indexeddb' ? snap.indexedDb.map((key) => ({ key, value: '' })) : snap[kind];
  const needle = filter.trim().toLowerCase();
  const rows = items.filter((i) => !needle || i.key.toLowerCase().includes(needle));
  const current = selected === null ? undefined : items.find((i) => i.key === selected);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      // The request layer reports the failure.
    }
    await load();
  };
  const pick = (key: string, v: string) => {
    setSelected(key);
    setValue(v);
    setAdding(false);
  };
  const edit = kind === 'indexeddb' ? null : kind;

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <IconButton icon="refresh" size="sm" label={t('browser.storage.refresh')} onClick={() => void load()} />
        {edit && (
          <IconButton
            icon="plus"
            size="sm"
            label={t('browser.storage.add')}
            onClick={() => {
              setAdding(true);
              setSelected(null);
              setNewKey('');
              setValue('');
            }}
          />
        )}
        <IconButton
          icon="trash"
          size="sm"
          label={t('browser.storage.clearKind')}
          disabled={items.length === 0}
          onClick={() => {
            setSelected(null);
            void run(() => browserApi.clearStorage(tab, kind));
          }}
        />
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.logs.filter')} placeholder={t('browser.logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="browser-chips" role="group" aria-label={t('browser.storage')}>
          {KINDS.map((k) => (
            <Button key={k} size="xs" pressed={kind === k} onClick={() => { setKind(k); setSelected(null); setAdding(false); }}>{t(`browser.storage.kind.${k}` as const)}</Button>
          ))}
        </div>
        <Button size="sm" pressed={cache} onClick={() => setCache((v) => !v)}>{t('browser.storage.withCache')}</Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!snap}
          onClick={() => {
            setSelected(null);
            void run(() => browserApi.clearSiteData(tab, cache));
          }}
        >
          {t('browser.storage.clearSite')}
        </Button>
      </div>
      <div className="browser-net">
        <div className="net-table-wrap">
          {!snap ? (
            <div className="browser-pane-empty">{t('browser.storage.unavailable')}</div>
          ) : (
            <>
              <div className="browser-pane-empty" title={snap.origin}>{snap.origin}</div>
              {rows.length === 0 ? (
                <div className="browser-pane-empty">{t('browser.storage.empty')}</div>
              ) : (
                <table className="net-table">
                  <thead>
                    <tr>
                      <th>{t('browser.storage.col.key')}</th>
                      {edit && <th>{t('browser.storage.col.value')}</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr
                        key={i.key}
                        tabIndex={0}
                        aria-selected={i.key === selected}
                        className={`net-row${i.key === selected ? ' selected' : ''}`}
                        onClick={() => edit && pick(i.key, i.value)}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          setMenu({ at: { x: ev.clientX, y: ev.clientY }, key: i.key, value: i.value });
                        }}
                        onKeyDown={(ev) => {
                          if (edit && (ev.key === 'Enter' || ev.key === ' ')) {
                            ev.preventDefault();
                            pick(i.key, i.value);
                          }
                        }}
                      >
                        <td className="net-name" title={i.key}>{i.key}</td>
                        {edit && <td className="cookie-value" title={i.value}>{i.value}</td>}
                        <td>
                          <IconButton
                            icon="trash"
                            size="xs"
                            label={t('browser.storage.delete')}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (i.key === selected) setSelected(null);
                              void run(() => browserApi.removeStorageItem(tab, kind, i.key));
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {menu && (
                <ContextMenu
                  at={menu.at}
                  onClose={() => setMenu(null)}
                  items={[
                    ...(edit ? [{ id: 'select', label: t('browser.row.select'), icon: 'file-text' as const, run: () => pick(menu.key, menu.value) }] : []),
                    { id: 'copy-key', label: t('browser.row.copyKey'), icon: 'copy' as const, run: () => void copyNotify(menu.key) },
                    ...(edit ? [{ id: 'copy-value', label: t('browser.row.copyValue'), icon: 'copy' as const, run: () => void copyNotify(menu.value) }] : []),
                    'sep',
                    {
                      id: 'delete',
                      label: t('browser.storage.delete'),
                      icon: 'trash',
                      danger: true,
                      run: () => {
                        if (menu.key === selected) setSelected(null);
                        void run(() => browserApi.removeStorageItem(tab, kind, menu.key));
                      },
                    },
                  ]}
                />
              )}
            </>
          )}
        </div>
        {edit && (current || adding) && (
          <div className="cookie-detail">
            <div className="cookie-detail-bar">
              {adding ? (
                <input type="text" className="browser-filter" spellCheck={false} placeholder={t('browser.storage.col.key')} aria-label={t('browser.storage.col.key')} value={newKey} onChange={(e) => setNewKey(e.target.value)} />
              ) : (
                <strong>{current!.key}</strong>
              )}
              <span className="cookie-detail-actions">
                <IconButton icon="copy" size="xs" label={t('browser.cookies.copyValue')} onClick={() => void copyNotify(value)} />
                <IconButton icon="close" size="xs" label={t('browser.cookies.closeDetail')} onClick={() => { setSelected(null); setAdding(false); }} />
              </span>
            </div>
            <div className="cookie-form">
              <textarea spellCheck={false} rows={8} aria-label={t('browser.storage.col.value')} value={value} onChange={(e) => setValue(e.target.value)} />
              <Button
                size="sm"
                variant="primary"
                disabled={adding && !newKey.trim()}
                onClick={() => {
                  const key = adding ? newKey.trim() : current!.key;
                  void run(() => browserApi.setStorageItem(tab, edit, key, value)).then(() => {
                    setAdding(false);
                    setSelected(key);
                  });
                }}
              >
                {t('browser.save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
