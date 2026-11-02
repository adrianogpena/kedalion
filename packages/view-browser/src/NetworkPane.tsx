import { useMemo, useState } from 'react';
import type { NetworkEntry } from '@kedalion/cdp';
import { Button, IconButton } from '@kedalion/ui';
import type { BrowserLogs } from './ConsolePane';
import { t } from './i18n';
import { NetworkDetail } from './NetworkDetail';

type TypeFilter = 'all' | 'xhr' | 'doc' | 'js' | 'css' | 'img' | 'other';
const FILTERS: TypeFilter[] = ['all', 'xhr', 'doc', 'js', 'css', 'img', 'other'];

function kindOf(type: string | undefined): Exclude<TypeFilter, 'all'> {
  switch (type) {
    case 'xhr':
    case 'fetch':
      return 'xhr';
    case 'document':
      return 'doc';
    case 'script':
      return 'js';
    case 'stylesheet':
      return 'css';
    case 'image':
      return 'img';
    default:
      return 'other';
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const nameOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname.split('/').filter(Boolean).pop() || u.host;
  } catch {
    return url;
  }
};

export interface NetworkPaneProps {
  tab: string;
  logs: BrowserLogs;
}

export function NetworkPane({ tab, logs }: NetworkPaneProps) {
  const [type, setType] = useState<TypeFilter>('all');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return logs.networkEntries.filter((e) => (type === 'all' || kindOf(e.type) === type) && (!needle || e.url.toLowerCase().includes(needle)));
  }, [logs.networkEntries, type, filter]);
  const entry = selected === null ? undefined : logs.networkEntries.find((e) => e.id === selected);

  const row = (e: NetworkEntry) => {
    const failed = !!e.failed || (e.status !== undefined && e.status >= 400);
    const select = () => setSelected(e.id);
    return (
      <tr
        key={e.id}
        tabIndex={0}
        aria-selected={e.id === selected}
        className={`net-row${failed ? ' failed' : ''}${e.id === selected ? ' selected' : ''}`}
        onClick={select}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            select();
          }
        }}
      >
        <td className="net-name" title={e.url}>{nameOf(e.url)}</td>
        <td>{e.method}</td>
        <td>{e.failed ? t('browser.network.failed') : (e.status ?? '')}</td>
        <td>{e.type ?? ''}</td>
        <td>{e.done ? formatSize(e.size) : ''}</td>
        <td>{e.timing === undefined ? '' : `${Math.round(e.timing)} ms`}</td>
      </tr>
    );
  };

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <IconButton icon="trash" size="sm" label={t('browser.logs.clear')} onClick={() => {
          logs.clear('network');
          setSelected(null);
        }} />
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.logs.filter')} placeholder={t('browser.logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="browser-chips" role="group" aria-label={t('browser.network.types')}>
          {FILTERS.map((f) => (
            <Button key={f} size="xs" pressed={type === f} onClick={() => setType(f)}>{t(`browser.network.type.${f}` as const)}</Button>
          ))}
        </div>
        <Button size="sm" pressed={logs.preserve.network} onClick={() => logs.setPreserve('network', !logs.preserve.network)}>{t('browser.logs.preserve')}</Button>
      </div>
      <div className="browser-net">
        <div className="net-table-wrap">
          {rows.length === 0 ? (
            <div className="browser-pane-empty">{t('browser.network.empty')}</div>
          ) : (
            <table className="net-table">
              <thead>
                <tr>
                  <th>{t('browser.network.col.name')}</th>
                  <th>{t('browser.network.col.method')}</th>
                  <th>{t('browser.network.col.status')}</th>
                  <th>{t('browser.network.col.type')}</th>
                  <th>{t('browser.network.col.size')}</th>
                  <th>{t('browser.network.col.time')}</th>
                </tr>
              </thead>
              <tbody>{rows.map(row)}</tbody>
            </table>
          )}
        </div>
        {entry && <NetworkDetail tab={tab} entry={entry} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
