import { useEffect, useMemo, useState } from 'react';
import type { CaptureRecord, CommandRecord, HistoryEntry, ResultRecord, TerminalAlerts } from '@kedalion/terminal/protocol';
import { copyNotify, Icon, IconButton, type IconName, request, useDialogs } from '@kedalion/ui';
import { t } from './i18n';

/** What the panel shows of one session; the screen keeps it up to date from the pane's frames. */
export interface SessionData {
  commands: CommandRecord[];
  results: ResultRecord[];
  captures: CaptureRecord[];
  alerts: TerminalAlerts;
}

export const emptySessionData = (): SessionData => ({ commands: [], results: [], captures: [], alerts: { finish: false, quiet: false, print: false } });

export type PanelTab = 'commands' | 'results' | 'captures' | 'history';
const TABS: PanelTab[] = ['commands', 'results', 'captures', 'history'];

export interface SessionPanelProps {
  session?: string;
  data?: SessionData;
  tab: PanelTab;
  onTab(tab: PanelTab): void;
  onClose(): void;
  /** Types the command and presses Enter in the session's pane. */
  onRun(command: string): void;
  onInsert(command: string): void;
  /** Scrolls the pane to the command; false when it is no longer in the buffer. */
  onJump(command: string): boolean;
  onAlerts(patch: Partial<TerminalAlerts>): void;
  onOpenResult(result: ResultRecord): void;
}

const RESULT_ICONS: Record<ResultRecord['kind'], IconName> = {
  pr: 'git-branch',
  issue: 'alert',
  newPr: 'plus',
  app: 'globe',
  commit: 'history',
  push: 'arrow-up',
};

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return `${ms} ms`;
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function statusOf(r: { exitCode?: number | null; endedAt?: number }): { cls: string; title: string } {
  if (r.endedAt === undefined) return { cls: 'running', title: t('terminalScreen.panel.running') };
  if (r.exitCode === null || r.exitCode === undefined) return { cls: '', title: '' };
  return r.exitCode === 0 ? { cls: 'ok', title: t('terminalScreen.panel.exit', { code: 0 }) } : { cls: 'err', title: t('terminalScreen.panel.exit', { code: r.exitCode }) };
}

/** Side panel of the Terminal view: the focused terminal's commands, results, captured lines and alerts, and the history of all terminals. */
export function SessionPanel(props: SessionPanelProps) {
  const { session, data, tab } = props;
  const [filter, setFilter] = useState('');
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const dialogs = useDialogs();

  useEffect(() => {
    if (tab !== 'history') return;
    let stale = false;
    const timer = setTimeout(() => {
      request<HistoryEntry[]>('GET', '/api/terminal/history', { q: filter, ...(failed ? { failed: '1' } : {}) }).then(
        (list) => !stale && setHistory(list),
        () => !stale && setHistory([]),
      );
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [tab, filter, failed, historyTick, data?.commands.length]);

  const commands = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.commands ?? [])
      .filter((c) => (!failed || (c.exitCode !== undefined && c.exitCode !== null && c.exitCode !== 0)) && (!q || c.command.toLowerCase().includes(q)))
      .slice()
      .reverse();
  }, [data?.commands, filter, failed]);

  const copyOutput = async (c: CommandRecord) => {
    if (!session) return;
    try {
      const out = await request<{ text: string }>('GET', '/api/terminal/command-output', { session, id: String(c.id) });
      await copyNotify(out.text);
    } catch {
      await copyNotify('', t('terminalScreen.panel.gone'));
    }
  };

  const clearHistory = async () => {
    const ok = await dialogs.confirm({ title: t('terminalScreen.panel.clearHistory'), body: t('terminalScreen.panel.clearHistory.confirm'), danger: true });
    if (!ok) return;
    await request('POST', '/api/terminal/history/clear').catch(() => {});
    setHistoryTick((n) => n + 1);
  };

  const commandRow = (key: string | number, c: { command: string; cwd: string; startedAt: number; durationMs?: number | null; exitCode?: number | null; endedAt?: number; terminal?: string }, live?: CommandRecord) => {
    const st = statusOf(c);
    const took = c.durationMs ?? (c.endedAt !== undefined ? c.endedAt - c.startedAt : null);
    return (
      <li key={key} className="term-panel-row">
        <button type="button" className="term-panel-main" title={live ? t('terminalScreen.panel.jump') : c.command} onClick={() => live && props.onJump(c.command)}>
          <span className={`term-panel-dot ${st.cls}`} title={st.title} />
          <span className="term-panel-text">
            <code>{c.command}</code>
            <span className="muted">
              {[c.terminal, basename(c.cwd), clock(c.startedAt), took !== null ? duration(took) : null, st.cls === 'err' ? st.title : null].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        <span className="term-panel-actions">
          {session && <IconButton icon="play" size="sm" label={t('terminalScreen.panel.rerun')} onClick={() => props.onRun(c.command)} />}
          {session && <IconButton icon="edit" size="sm" label={t('terminalScreen.panel.insert')} onClick={() => props.onInsert(c.command)} />}
          <IconButton icon="copy" size="sm" label={t('terminalScreen.panel.copy')} onClick={() => void copyNotify(c.command)} />
          {live && live.endedAt !== undefined && <IconButton icon="file-text" size="sm" label={t('terminalScreen.panel.copyOutput')} onClick={() => void copyOutput(live)} />}
        </span>
      </li>
    );
  };

  const empty = (text: string) => <p className="term-panel-empty muted">{text}</p>;

  const body = () => {
    if (tab === 'history') {
      return history.length ? (
        <ul className="term-panel-list">{history.map((h, i) => commandRow(i, { ...h, startedAt: h.at }))}</ul>
      ) : (
        empty(t('terminalScreen.panel.noHistory'))
      );
    }
    if (!session || !data) return empty(t('terminalScreen.panel.noSession'));
    if (tab === 'commands') {
      return commands.length ? <ul className="term-panel-list">{commands.map((c) => commandRow(c.id, c, c))}</ul> : empty(t('terminalScreen.panel.noCommands'));
    }
    if (tab === 'results') {
      return data.results.length ? (
        <ul className="term-panel-list">
          {data.results.map((r) => (
            <li key={r.id} className="term-panel-row">
              <button type="button" className="term-panel-main" title={r.url ?? r.hash ?? r.title} onClick={() => props.onOpenResult(r)}>
                <Icon name={RESULT_ICONS[r.kind]} />
                <span className="term-panel-text">
                  <span>{r.title}</span>
                  <span className="muted">{[t(`terminalScreen.result.${r.kind}`), r.detail, r.hash?.slice(0, 7), clock(r.at)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <span className="term-panel-actions">
                <IconButton icon="copy" size="sm" label={t('terminalScreen.panel.copy')} onClick={() => void copyNotify(r.url ?? r.hash ?? r.title)} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        empty(t('terminalScreen.panel.noResults'))
      );
    }
    return data.captures.length ? (
      <ul className="term-panel-list">
        {data.captures.map((c) => (
          <li key={c.id} className="term-panel-row">
            <button type="button" className="term-panel-main" onClick={() => void copyNotify(c.text)}>
              <span className="term-panel-text">
                <code>{c.text}</code>
                <span className="muted">{`${c.trigger} · ${clock(c.at)}`}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      empty(t('terminalScreen.panel.noCaptures'))
    );
  };

  const alerts = data?.alerts;
  return (
    <aside className="term-panel" aria-label={t('terminalScreen.panel')}>
      <div className="term-panel-head">
        <div className="term-panel-tabs" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`chip${tab === id ? ' chip-on' : ''}`} onClick={() => props.onTab(id)}>
              {t(`terminalScreen.panel.${id}`)}
              {id === 'results' && data?.results.length ? <span className="term-panel-count">{data.results.length}</span> : null}
              {id === 'captures' && data?.captures.length ? <span className="term-panel-count">{data.captures.length}</span> : null}
            </button>
          ))}
        </div>
        <IconButton icon="close" size="sm" label={t('terminalScreen.panel.close')} onClick={props.onClose} />
      </div>
      {(tab === 'commands' || tab === 'history') && (
        <div className="term-panel-filter">
          <input type="search" value={filter} placeholder={t('terminalScreen.panel.filter')} aria-label={t('terminalScreen.panel.filter')} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className={`chip${failed ? ' chip-on' : ''}`} aria-pressed={failed} onClick={() => setFailed(!failed)}>
            {t('terminalScreen.panel.failedOnly')}
          </button>
          {tab === 'history' && <IconButton icon="trash" size="sm" label={t('terminalScreen.panel.clearHistory')} onClick={() => void clearHistory()} />}
        </div>
      )}
      <div className="term-panel-body">{body()}</div>
      {session && alerts && tab !== 'history' && (
        <fieldset className="term-panel-alerts">
          <legend className="muted">{t('terminalScreen.panel.alerts')}</legend>
          {(['finish', 'quiet', 'print'] as const).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={alerts[k]} onChange={(e) => props.onAlerts({ [k]: e.target.checked })} />
              {t(`terminalScreen.alert.${k}`)}
            </label>
          ))}
        </fieldset>
      )}
      {dialogs.element}
    </aside>
  );
}
