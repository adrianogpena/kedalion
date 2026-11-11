import { useEffect, useMemo, useState } from 'react';
import type { NetworkEntry } from '@kedalion/cdp';
import { Button, ContextMenu, copyNotify, IconButton, request, useToast } from '@kedalion/ui';
import { countSinceMark, DEFAULT_PENDING_SECS, filterRows, isStuck, pendingAge } from './netview';
import { browserApi } from './client';
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
  const [bodyText, setBodyText] = useState('');
  const [sinceMark, setSinceMark] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [pendingSecs, setPendingSecs] = useState(DEFAULT_PENDING_SECS);
  const [now, setNow] = useState(() => Date.now());
  const [ops, setOps] = useState<Record<number, string>>({});
  const [bodyIds, setBodyIds] = useState<ReadonlySet<number> | null>(null);
  const toast = useToast();

  const entries = logs.networkEntries;
  const anyPending = entries.some((e) => !e.done && e.startedAt !== undefined);
  const doneCount = entries.reduce((n, e) => n + (e.done ? 1 : 0), 0);

  useEffect(() => {
    if (!anyPending) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyPending]);

  const needle = bodyText.trim();
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      request<{ ops: Record<number, string>; matches: number[] | null }>('GET', '/api/browser/network/ops', { tab, text: needle })
        .then((r) => {
          if (stale) return;
          setOps(r.ops);
          setBodyIds(r.matches ? new Set(r.matches) : null);
        })
        .catch(() => {});
    }, needle ? 250 : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [tab, needle, doneCount]);

  const rows = useMemo(
    () => filterRows(entries, { text: filter, matchType: (e) => type === 'all' || kindOf(e.type) === type, bodyIds, mark: logs.mark, sinceMark, pendingOnly, now, pendingSecs }),
    [entries, type, filter, bodyIds, logs.mark, sinceMark, pendingOnly, now, pendingSecs],
  );
  const afterMark = countSinceMark(entries, logs.mark);
  const entry = selected === null ? undefined : entries.find((e) => e.id === selected);

  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entry: NetworkEntry } | null>(null);
  const row = (e: NetworkEntry) => {
    const failed = !!e.failed || (e.status !== undefined && e.status >= 400);
    const age = pendingAge(e, now);
    const stuck = isStuck(e, now, pendingSecs);
    const select = () => setSelected(e.id);
    return (
      <tr
        key={e.id}
        tabIndex={0}
        aria-selected={e.id === selected}
        className={`net-row${failed ? ' failed' : ''}${stuck ? ' stuck' : ''}${e.id === selected ? ' selected' : ''}`}
        onClick={select}
        onContextMenu={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setMenu({ at: { x: ev.clientX, y: ev.clientY }, entry: e });
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            select();
          }
        }}
      >
        <td className="net-name" title={e.url}>{nameOf(e.url)}</td>
        <td className="net-ops" title={ops[e.id]}>{ops[e.id] ?? ''}</td>
        <td>{e.method}</td>
        <td>{e.failed ? t('browser.network.failed') : (e.status ?? '')}</td>
        <td>{e.type ?? ''}</td>
        <td>{e.done ? formatSize(e.size) : ''}</td>
        <td>{age !== undefined ? t('browser.network.pendingAge', { n: age }) : e.timing === undefined ? '' : `${Math.round(e.timing)} ms`}</td>
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
        <IconButton
          icon="download"
          size="sm"
          label={t('browser.network.exportHar')}
          disabled={logs.networkEntries.length === 0}
          onClick={() =>
            void browserApi
              .exportHar(tab)
              .then((r) => toast({ message: `${t('browser.network.harSaved')}: ${r.path}`, timeout: 6000 }))
              .catch(() => {})
          }
        />
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.logs.filter')} placeholder={t('browser.logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="browser-chips" role="group" aria-label={t('browser.network.types')}>
          {FILTERS.map((f) => (
            <Button key={f} size="xs" pressed={type === f} onClick={() => setType(f)}>{t(`browser.network.type.${f}` as const)}</Button>
          ))}
        </div>
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.network.bodySearch')} placeholder={t('browser.network.bodySearch')} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
        <Button size="sm" pressed={logs.preserve.network} onClick={() => logs.setPreserve('network', !logs.preserve.network)}>{t('browser.logs.preserve')}</Button>
      </div>
      <div className="browser-pane-bar">
        <Button size="sm" title={t('browser.network.markSet')} onClick={logs.setMark}>{t('browser.network.mark')}</Button>
        <Button size="sm" pressed={sinceMark} disabled={!logs.mark} onClick={() => setSinceMark(!sinceMark)}>{t('browser.network.sinceMark')}</Button>
        {logs.mark && <span className="browser-count" role="status">{t('browser.network.afterMark', { n: afterMark })}</span>}
        <Button size="sm" pressed={pendingOnly} onClick={() => setPendingOnly(!pendingOnly)}>{t('browser.network.pendingOnly')}</Button>
        <input
          className="browser-secs"
          type="number"
          min={1}
          aria-label={t('browser.network.pendingOver')}
          title={t('browser.network.pendingOver')}
          value={pendingSecs}
          onChange={(e) => setPendingSecs(Math.max(1, Number(e.target.value) || DEFAULT_PENDING_SECS))}
        />
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
                  <th>{t('browser.network.col.operations')}</th>
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
          {menu && (
            <ContextMenu
              at={menu.at}
              onClose={() => setMenu(null)}
              items={[
                { id: 'details', label: t('browser.row.details'), icon: 'file-text', run: () => setSelected(menu.entry.id) },
                { id: 'copy', label: t('browser.menu.copyUrl'), icon: 'copy', run: () => void copyNotify(menu.entry.url) },
              ]}
            />
          )}
        </div>
        {entry && <NetworkDetail tab={tab} entry={entry} search={needle} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
