import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleEntry, NetworkEntry } from '@kedalion/cdp';
import { Button, ContextMenu, copyNotify, IconButton, request } from '@kedalion/ui';
import { t } from './i18n';
import { errorsSinceMark, requestsBefore, type NetMark } from './netview';
import type { BrowserSocket } from './web/useBrowserSocket';

export type LogKind = 'console' | 'network';

export const MAX_ROWS = 2000;

export interface EvalResult {
  ok: boolean;
  text: string;
  type?: string;
}

export interface BrowserLogs {
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  errors: number;
  preserve: Record<LogKind, boolean>;
  setPreserve(kind: LogKind, on: boolean): void;
  clear(kind: LogKind): void;
  /** Last mark of the tab: the newest request id and the time it was set. */
  mark: NetMark | null;
  setMark(): void;
}

const PRESERVE_KEY = 'kedalion.browser.preserve';

function readPreserve(): Record<LogKind, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESERVE_KEY) ?? '{}') as Partial<Record<LogKind, unknown>>;
    return { console: raw.console === true, network: raw.network === true };
  } catch {
    return { console: false, network: false };
  }
}

const cap = <T,>(rows: T[]): T[] => (rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows);

/** Console and network rows of every tab, collected from the socket so counts stay right while the dock is closed. */
export function useBrowserLogs(socket: BrowserSocket, tab: string | undefined, url: string | undefined): BrowserLogs {
  const [consoleRows, setConsoleRows] = useState<Record<string, ConsoleEntry[]>>({});
  const [networkRows, setNetworkRows] = useState<Record<string, NetworkEntry[]>>({});
  const [preserve, setPreserveState] = useState<Record<LogKind, boolean>>(readPreserve);
  const lastUrl = useRef(new Map<string, string>());
  const preserveRef = useRef(preserve);
  preserveRef.current = preserve;
  const { subscribe } = socket;

  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type === 'console') {
          setConsoleRows((prev) => ({ ...prev, [msg.tab]: cap([...(prev[msg.tab] ?? []), ...msg.entries]) }));
        } else if (msg.type === 'network') {
          setNetworkRows((prev) => {
            const rows = [...(prev[msg.tab] ?? [])];
            for (const e of msg.entries) {
              const i = rows.findIndex((r) => r.id === e.id);
              if (i >= 0) rows[i] = e;
              else rows.push(e);
            }
            return { ...prev, [msg.tab]: cap(rows) };
          });
        }
      }),
    [subscribe],
  );

  useEffect(() => {
    if (!tab || url === undefined) return;
    const before = lastUrl.current.get(tab);
    lastUrl.current.set(tab, url);
    if (before === undefined || before === url) return;
    if (!preserveRef.current.console) setConsoleRows((prev) => ({ ...prev, [tab]: [] }));
    if (!preserveRef.current.network) setNetworkRows((prev) => ({ ...prev, [tab]: [] }));
  }, [tab, url]);

  useEffect(() => {
    if (!tab) return;
    for (const kind of ['console', 'network'] as const) {
      if (preserveRef.current[kind]) void request('POST', '/api/browser/logs/preserve', {}, { id: tab, kind, on: true }).catch(() => {});
    }
  }, [tab]);

  const setPreserve = useCallback(
    (kind: LogKind, on: boolean) => {
      const next = { ...preserveRef.current, [kind]: on };
      preserveRef.current = next;
      setPreserveState(next);
      try {
        localStorage.setItem(PRESERVE_KEY, JSON.stringify(next));
      } catch {
        // Not remembered.
      }
      if (tab) void request('POST', '/api/browser/logs/preserve', {}, { id: tab, kind, on }).catch(() => {});
    },
    [tab],
  );
  const clear = useCallback(
    (kind: LogKind) => {
      if (!tab) return;
      if (kind === 'console') setConsoleRows((prev) => ({ ...prev, [tab]: [] }));
      else setNetworkRows((prev) => ({ ...prev, [tab]: [] }));
      void request('POST', '/api/browser/logs/clear', {}, { id: tab, kind }).catch(() => {});
    },
    [tab],
  );

  const consoleEntries = useMemo(() => (tab ? (consoleRows[tab] ?? []) : []), [consoleRows, tab]);
  const networkEntries = useMemo(() => (tab ? (networkRows[tab] ?? []) : []), [networkRows, tab]);
  const errors = useMemo(() => consoleEntries.filter((e) => e.level === 'error').length, [consoleEntries]);
  const [marks, setMarks] = useState<Record<string, NetMark>>({});
  const mark = tab ? (marks[tab] ?? null) : null;
  const setMark = useCallback(() => {
    if (!tab) return;
    setMarks((prev) => ({ ...prev, [tab]: { id: networkEntries[networkEntries.length - 1]?.id ?? 0, ts: Date.now() } }));
  }, [tab, networkEntries]);
  return { consoleEntries, networkEntries, errors, preserve, setPreserve, clear, mark, setMark };
}

type Level = 'verbose' | 'info' | 'warnings' | 'errors';
const LEVELS: Level[] = ['verbose', 'info', 'warnings', 'errors'];
const SHOWN: Record<Level, string[]> = {
  verbose: ['debug', 'log', 'info', 'warn', 'error'],
  info: ['log', 'info', 'warn', 'error'],
  warnings: ['warn', 'error'],
  errors: ['error'],
};

interface Local {
  id: number;
  input: string;
  result?: EvalResult;
}

const fileOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname.split('/').filter(Boolean).pop() || u.host;
  } catch {
    return url;
  }
};

export interface ConsolePaneProps {
  tab: string;
  logs: BrowserLogs;
  /** Opens the DevTools at the Sources panel for a source link. */
  onSource(url: string, line: number): void;
}

export function ConsolePane({ tab, logs, onSource }: ConsolePaneProps) {
  const [level, setLevel] = useState<Level>('verbose');
  const [filter, setFilter] = useState('');
  const [local, setLocal] = useState<Local[]>([]);
  const [draft, setDraft] = useState('');
  const [linked, setLinked] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; text: string } | null>(null);
  const openMenu = (ev: React.MouseEvent, text: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({ at: { x: ev.clientX, y: ev.clientY }, text });
  };
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const nextLocal = useRef(1);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const rows = useMemo(() => {
    const shown = SHOWN[level];
    const needle = filter.trim().toLowerCase();
    return logs.consoleEntries.filter((e) => shown.includes(e.level) && (!needle || e.text.toLowerCase().includes(needle)));
  }, [logs.consoleEntries, level, filter]);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows, local]);

  const run = async () => {
    const input = draft.trim();
    if (!input) return;
    history.current.push(input);
    cursor.current = -1;
    setDraft('');
    const id = nextLocal.current++;
    setLocal((l) => [...l, { id, input }].slice(-MAX_ROWS));
    let result: EvalResult;
    try {
      result = await request<EvalResult>('POST', '/api/browser/eval', {}, { id: tab, expression: input });
    } catch (e) {
      result = { ok: false, text: e instanceof Error ? e.message : String(e) };
    }
    setLocal((l) => l.map((x) => (x.id === id ? { ...x, result } : x)));
  };

  const recall = (delta: number) => {
    const h = history.current;
    if (!h.length) return;
    const next = cursor.current === -1 ? (delta < 0 ? h.length - 1 : -1) : cursor.current + delta;
    if (next < 0 || next >= h.length) {
      cursor.current = -1;
      setDraft('');
      return;
    }
    cursor.current = next;
    setDraft(h[next]!);
  };

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <IconButton icon="trash" size="sm" label={t('browser.logs.clear')} onClick={() => {
          logs.clear('console');
          setLocal([]);
        }} />
        <select className="browser-select" aria-label={t('browser.console.level')} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{t(`browser.console.level.${l}` as const)}</option>
          ))}
        </select>
        <input className="browser-filter" type="text" spellCheck={false} aria-label={t('browser.logs.filter')} placeholder={t('browser.logs.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button size="sm" pressed={logs.preserve.console} onClick={() => logs.setPreserve('console', !logs.preserve.console)}>{t('browser.logs.preserve')}</Button>
        {logs.mark && <span className="browser-count" role="status">{t('browser.console.errorsSinceMark', { n: errorsSinceMark(logs.consoleEntries, logs.mark) })}</span>}
      </div>
      <div
        ref={list}
        className="browser-console-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {rows.length === 0 && local.length === 0 && <div className="browser-pane-empty">{t('browser.console.empty')}</div>}
        {rows.map((e) => {
          const near = e.level === 'error' ? requestsBefore(logs.networkEntries, e.ts) : [];
          return (
          <div key={e.id} className={`console-row lvl-${e.level}`} onContextMenu={(ev) => openMenu(ev, e.stack && !e.text.includes(e.stack) ? `${e.text}\n${e.stack}` : e.text)}>
            <div className="console-main">
              <pre className="console-text">{e.stack && !e.text.includes(e.stack) ? `${e.text}\n${e.stack}` : e.text}</pre>
              {near.length > 0 && (
                <>
                  <Button variant="ghost" size="xs" aria-expanded={linked === e.id} onClick={() => setLinked(linked === e.id ? null : e.id)}>
                    {t('browser.console.requestsBefore', { n: near.length })}
                  </Button>
                  {linked === e.id && (
                    <ul className="console-requests">
                      {near.map((r) => (
                        <li key={r.id} title={r.url}>
                          {r.method} {fileOf(r.url)} {r.failed ? t('browser.network.failed') : (r.status ?? '')}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            {e.source && (
              <Button variant="ghost" size="xs" className="console-source" title={`${e.source.url}:${e.source.line}`} onClick={() => onSource(e.source!.url, e.source!.line)}>
                {fileOf(e.source.url)}:{e.source.line}
              </Button>
            )}
          </div>
          );
        })}
        {local.map((x) => (
          <div key={`l${x.id}`} className="console-local">
            <div className="console-row lvl-input"><pre className="console-text">{`> ${x.input}`}</pre></div>
            {x.result && (
              <div className={`console-row ${x.result.ok ? 'lvl-result' : 'lvl-error'}`}>
                <pre className="console-text">{x.result.text}</pre>
              </div>
            )}
          </div>
        ))}
        {menu && (
          <ContextMenu
            at={menu.at}
            onClose={() => setMenu(null)}
            items={[{ id: 'copy', label: t('browser.row.copyMessage'), icon: 'copy', run: () => void copyNotify(menu.text) }]}
          />
        )}
      </div>
      <textarea
        className="browser-prompt"
        rows={1}
        spellCheck={false}
        aria-label={t('browser.console.prompt')}
        placeholder={t('browser.console.prompt')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void run();
          } else if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
            e.preventDefault();
            recall(-1);
          } else if (e.key === 'ArrowDown' && e.currentTarget.selectionEnd === e.currentTarget.value.length && cursor.current !== -1) {
            e.preventDefault();
            recall(1);
          }
        }}
      />
    </div>
  );
}
