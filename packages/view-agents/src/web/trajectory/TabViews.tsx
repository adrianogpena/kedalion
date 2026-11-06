import { useMemo, useState } from 'react';
import { Button, Empty } from '@kedalion/ui';
import type { AgentTraceStep } from '../../protocol';
import { t } from '../../i18n';
import { fmtClock, fmtDuration, fmtTokens } from './model';
import { agentsOf, commandsOf, promptRows, todosOf, webCallsOf } from './views';

export const fmtCost = (usd: number) => (usd === 0 ? '–' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => undefined);

interface ViewProps {
  steps: AgentTraceStep[];
  onGoto(i: number): void;
}

/** Every Bash command of the session, with status, time and output size. */
export function CommandsView({ steps, onGoto }: ViewProps) {
  const rows = useMemo(() => commandsOf(steps), [steps]);
  const [failedOnly, setFailedOnly] = useState(false);
  const [query, setQuery] = useState('');
  if (rows.length === 0) return <Empty title={t('panel.trajectory.commands.empty')} />;
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (!failedOnly || r.error) && (!q || r.command.toLowerCase().includes(q)));
  return (
    <div className="agents-traj-pane">
      <div className="agents-traj-filesbar">
        <input className="agents-traj-fsearch" type="search" value={query} placeholder={t('panel.trajectory.commands.search')} aria-label={t('panel.trajectory.commands.search')} onChange={(e) => setQuery(e.target.value)} />
        <div className="agents-traj-kinds">
          <Button variant="ghost" size="xs" pressed={failedOnly} onClick={() => setFailedOnly(!failedOnly)}>{t('panel.trajectory.commands.failed')}</Button>
          <Button variant="ghost" size="xs" onClick={() => copy(shown.map((r) => r.command).join('\n'))}>{t('panel.trajectory.commands.copyScript', { n: shown.length })}</Button>
        </div>
      </div>
      <table className="agents-traj-table agents-traj-cmds">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('panel.trajectory.commands.time')}</th>
            <th>{t('panel.trajectory.commands.command')}</th>
            <th>{t('panel.trajectory.commands.status')}</th>
            <th>{t('panel.trajectory.commands.duration')}</th>
            <th>{t('panel.trajectory.commands.output')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.i} className={r.error ? 'agents-traj-error' : undefined}>
              <td>{r.i + 1}</td>
              <td>{r.ts ? fmtClock(r.ts) : ''}</td>
              <td className="agents-traj-cmd"><code title={r.command}>{r.command}</code></td>
              <td>{r.pending ? '…' : r.error ? `✕ ${r.exitCode ?? ''}` : '✓'}</td>
              <td>{fmtDuration(r.durationMs) || '–'}</td>
              <td>{r.tokens ? `~${fmtTokens(r.tokens)}` : ''}</td>
              <td className="agents-traj-rowact">
                <Button variant="ghost" size="xs" onClick={() => copy(r.command)}>{t('common.copy')}</Button>
                <Button variant="ghost" size="xs" onClick={() => onGoto(r.i)}>{t('panel.trajectory.files.goto')}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TODO_MARK = { completed: '☑', in_progress: '▶', pending: '☐' } as const;

/** The plan (TodoWrite) as last written and how it changed over the session. */
export function TodosView({ steps, onGoto }: ViewProps) {
  const h = useMemo(() => todosOf(steps), [steps]);
  if (h.writes.length === 0) return <Empty title={t('panel.trajectory.todos.empty')} />;
  return (
    <div className="agents-traj-pane">
      <section>
        <h3 className="agents-traj-stats-title">{t('panel.trajectory.todos.final', { done: h.last.length - h.open.length, total: h.last.length })}</h3>
        <ul className="agents-traj-todos">
          {h.last.map((x, k) => (
            <li key={k} className={`agents-traj-todo-${x.status}`}>
              <span>{TODO_MARK[x.status]}</span> {x.content}
            </li>
          ))}
        </ul>
        {h.open.length > 0 && <p className="agents-empty">{t('panel.trajectory.todos.open', { n: h.open.length })}</p>}
      </section>
      <section>
        <h3 className="agents-traj-stats-title">{t('panel.trajectory.todos.history')}</h3>
        <ul className="agents-traj-todos">
          {h.writes.map((w) => (
            <li key={w.i}>
              <span className="agents-traj-meta">{w.ts ? fmtClock(w.ts) : ''}</span> {t('panel.trajectory.todos.progress', { done: w.done, total: w.todos.length })}
              {w.added.length > 0 && <span className="agents-traj-diff-add"> {t('panel.trajectory.todos.added', { n: w.added.length })}</span>}
              {w.completed.length > 0 && <span className="agents-traj-diff-add"> {t('panel.trajectory.todos.completed', { n: w.completed.length })}</span>}
              {w.completed.length > 0 && <span className="agents-traj-meta"> {w.completed.join(' · ')}</span>}
              <Button variant="ghost" size="xs" onClick={() => onGoto(w.i)}>{t('panel.trajectory.files.goto')}</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Subagents launched during the session. */
export function AgentsView({ steps, onGoto }: ViewProps) {
  const rows = useMemo(() => agentsOf(steps), [steps]);
  const [open, setOpen] = useState<number>();
  if (rows.length === 0) return <Empty title={t('panel.trajectory.agents.empty')} />;
  const totalTokens = rows.reduce((a, r) => a + (r.tokens ?? 0), 0);
  return (
    <div className="agents-traj-pane">
      <p className="agents-empty">{t('panel.trajectory.agents.total', { n: rows.length, tokens: fmtTokens(totalTokens) || '0' })}</p>
      <table className="agents-traj-table agents-traj-cmds">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('panel.trajectory.agents.agent')}</th>
            <th>{t('panel.trajectory.agents.status')}</th>
            <th>{t('panel.trajectory.commands.duration')}</th>
            <th>{t('panel.trajectory.stats.tokens')}</th>
            <th>{t('panel.trajectory.agents.toolUses')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => [
            <tr key={r.i} className={r.status === 'failed' ? 'agents-traj-error' : undefined}>
              <td>{r.i + 1}</td>
              <td className="agents-traj-cmd">
                <strong>{r.type}</strong> {r.description}
                {r.background && <span className="agents-traj-meta"> {t('panel.trajectory.agents.background')}</span>}
                {r.model && <span className="agents-traj-meta"> {r.model}</span>}
              </td>
              <td>{t(`panel.trajectory.agents.status.${r.status}`)}</td>
              <td>{fmtDuration(r.durationMs) || '–'}</td>
              <td>{r.tokens ? fmtTokens(r.tokens) : ''}</td>
              <td>{r.toolUses ?? ''}</td>
              <td className="agents-traj-rowact">
                <Button variant="ghost" size="xs" onClick={() => setOpen(open === r.i ? undefined : r.i)}>{t('panel.trajectory.agents.details')}</Button>
                <Button variant="ghost" size="xs" onClick={() => onGoto(r.i)}>{t('panel.trajectory.files.goto')}</Button>
                {r.noticeI !== undefined && <Button variant="ghost" size="xs" onClick={() => onGoto(r.noticeI!)}>{t('panel.trajectory.agents.report')}</Button>}
              </td>
            </tr>,
            open === r.i && (
              <tr key={`${r.i}-d`}>
                <td />
                <td colSpan={6}>
                  {r.prompt && <pre className="agents-traj-detail agents-traj-agentbox">{r.prompt}</pre>}
                  {(r.summary || r.result) && <pre className="agents-traj-detail agents-traj-agentbox">{r.summary ? `${r.summary}\n\n` : ''}{r.result ?? ''}</pre>}
                </td>
              </tr>
            ),
          ])}
        </tbody>
      </table>
    </div>
  );
}

/** One row per prompt you typed: what the turn did, how long it took and what it cost. */
export function PromptsView({ steps, onGoto }: ViewProps) {
  const rows = useMemo(() => promptRows(steps), [steps]);
  if (rows.length === 0) return <Empty title={t('panel.trajectory.prompts.empty')} />;
  const top = rows.reduce((m, r) => (r.cost > m ? r.cost : m), 0);
  return (
    <div className="agents-traj-pane">
      <table className="agents-traj-table agents-traj-cmds">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('panel.trajectory.commands.time')}</th>
            <th>{t('panel.trajectory.prompts.prompt')}</th>
            <th>{t('panel.trajectory.prompts.answer')}</th>
            <th>{t('panel.trajectory.commands.duration')}</th>
            <th>{t('panel.trajectory.stats.calls')}</th>
            <th>{t('panel.trajectory.stats.errors')}</th>
            <th>{t('panel.trajectory.prompts.files')}</th>
            <th>{t('panel.trajectory.stats.costTotal')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.i}>
              <td>{r.i + 1}</td>
              <td>{r.ts ? fmtClock(r.ts) : ''}</td>
              <td className="agents-traj-cmd">{r.label}{r.interrupted && <span className="agents-traj-fail"> {t('panel.trajectory.marker.interrupt')}</span>}</td>
              <td>{fmtDuration(r.answerMs) || '–'}</td>
              <td>{fmtDuration(r.durationMs) || '–'}</td>
              <td>{r.calls || ''}</td>
              <td className={r.errors ? 'agents-traj-error' : undefined}>{r.errors || ''}</td>
              <td>{r.files || ''}</td>
              <td className={top > 0 && r.cost === top ? 'agents-traj-topcost' : undefined} title={top > 0 && r.cost === top ? t('panel.trajectory.prompts.top') : undefined}>{fmtCost(r.cost)}</td>
              <td className="agents-traj-rowact"><Button variant="ghost" size="xs" onClick={() => onGoto(r.i)}>{t('panel.trajectory.files.goto')}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Web and MCP calls grouped by server. */
export function WebView({ steps, onGoto }: ViewProps) {
  const rows = useMemo(() => webCallsOf(steps), [steps]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m];
  }, [rows]);
  if (rows.length === 0) return <Empty title={t('panel.trajectory.web.empty')} />;
  return (
    <div className="agents-traj-pane">
      {groups.map(([group, list]) => (
        <section key={group}>
          <h3 className="agents-traj-stats-title">
            {group === 'web' ? t('panel.trajectory.web.web') : group} · {list.length} · {list.filter((r) => r.error).length > 0 ? t('panel.trajectory.web.failures', { n: list.filter((r) => r.error).length }) : t('panel.trajectory.web.ok')}
          </h3>
          <table className="agents-traj-table agents-traj-cmds">
            <tbody>
              {list.map((r) => (
                <tr key={r.i} className={r.error ? 'agents-traj-error' : undefined}>
                  <td>{r.i + 1}</td>
                  <td>{r.ts ? fmtClock(r.ts) : ''}</td>
                  <td>{r.tool}</td>
                  <td className="agents-traj-cmd"><code title={r.target}>{r.target}</code></td>
                  <td>{fmtDuration(r.durationMs) || '–'}</td>
                  <td>{r.tokens ? `~${fmtTokens(r.tokens)}` : ''}</td>
                  <td className="agents-traj-rowact"><Button variant="ghost" size="xs" onClick={() => onGoto(r.i)}>{t('panel.trajectory.files.goto')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
