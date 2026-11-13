import { useMemo, useState } from 'react';
import { Button, Empty } from '@kedalion/ui';
import type { AgentSubagentInfo, AgentTraceStep } from '../../protocol';
import { t } from '../../i18n';
import { fmtClock, fmtDuration, fmtTokens } from './model';
import { type AgentRow, agentsOf, commandsOf, phaseProgress, promptRows, todosOf, webCallsOf } from './views';

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

const COLS = 8;

interface AgentsViewProps extends ViewProps {
  infos?: AgentSubagentInfo[];
  /** Shows one agent's own steps. */
  onOpenAgent(agent: { agentId: string; runId?: string; label: string }): void;
}

/** Subagents and workflow runs of the session; a run is a group of agents, by phase. Each agent's own steps can be opened. */
export function AgentsView({ steps, infos, onGoto, onOpenAgent }: AgentsViewProps) {
  const rows = useMemo(() => agentsOf(steps, infos), [steps, infos]);
  const [open, setOpen] = useState<string>();
  const [folded, setFolded] = useState<Record<number, boolean>>({});
  if (rows.length === 0) return <Empty title={t('panel.trajectory.agents.empty')} />;
  const count = rows.reduce((n, r) => n + (r.workflow ? r.workflow.agents.length : 1), 0);
  const totalTokens = rows.reduce((a, r) => a + (r.tokens ?? 0), 0);
  const totalCost = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
  const runs = rows.filter((r) => r.workflow).length;

  const line = (r: AgentRow, key: string, member: boolean) => {
    const label = `${r.type} ${r.description}`;
    return [
      <tr key={key} className={`${r.status === 'failed' ? 'agents-traj-error' : ''}${member ? ' agents-traj-member' : ''}${r.workflow ? ' agents-traj-run' : ''}`}>
        <td>{member ? '' : r.i + 1}</td>
        <td className="agents-traj-cmd">
          {r.workflow && (
            <Button variant="ghost" size="xs" aria-expanded={!folded[r.i]} title={t(folded[r.i] ? 'panel.trajectory.agents.expand' : 'panel.trajectory.agents.collapse')} onClick={() => setFolded((f) => ({ ...f, [r.i]: !f[r.i] }))}>
              {folded[r.i] ? '▸' : '▾'}
            </Button>
          )}
          <strong>{r.workflow ? t('panel.trajectory.agents.workflow') : r.type}</strong> {r.workflow?.name && r.workflow.name !== r.description ? <>{r.workflow.name} <span className="agents-traj-meta">{r.description}</span></> : r.description}
          {r.background && !r.workflow && <span className="agents-traj-meta"> {t('panel.trajectory.agents.background')}</span>}
          {r.model && <span className="agents-traj-meta"> {r.model}</span>}
          {r.workflow && (
            <span className="agents-traj-phases">
              {phaseProgress(r).map((p) => (
                <span key={p.phase} className={`agents-traj-phase${p.total > 0 && p.ended === p.total ? ' agents-traj-phase-done' : ''}`}>
                  {p.phase} {p.ended}/{p.total}
                </span>
              ))}
              <span className="agents-traj-meta">{t('panel.trajectory.agents.count', { n: r.workflow.agents.length })}</span>
            </span>
          )}
          {r.current && <code className="agents-traj-current" title={r.current}>{r.current}</code>}
        </td>
        <td>{t(`panel.trajectory.agents.status.${r.status}`)}</td>
        <td>{fmtDuration(r.durationMs) || '–'}</td>
        <td>{r.tokens ? fmtTokens(r.tokens) : ''}</td>
        <td>{r.cost !== undefined ? fmtCost(r.cost) : ''}</td>
        <td>{r.toolUses ?? ''}</td>
        <td className="agents-traj-rowact">
          <Button variant="ghost" size="xs" onClick={() => setOpen(open === key ? undefined : key)}>{t('panel.trajectory.agents.details')}</Button>
          {r.agentId && <Button variant="ghost" size="xs" onClick={() => onOpenAgent({ agentId: r.agentId!, ...(r.runId ? { runId: r.runId } : {}), label })}>{t('panel.trajectory.agents.steps')}</Button>}
          {!member && <Button variant="ghost" size="xs" onClick={() => onGoto(r.i)}>{t('panel.trajectory.files.goto')}</Button>}
          {!member && r.noticeI !== undefined && <Button variant="ghost" size="xs" onClick={() => onGoto(r.noticeI!)}>{t('panel.trajectory.agents.report')}</Button>}
        </td>
      </tr>,
      open === key && (
        <tr key={`${key}-d`}>
          <td />
          <td colSpan={COLS - 1}>
            {r.prompt && <pre className="agents-traj-detail agents-traj-agentbox">{r.prompt}</pre>}
            {(r.summary || r.result) && <pre className="agents-traj-detail agents-traj-agentbox">{r.summary ? `${r.summary}\n\n` : ''}{r.result ?? ''}</pre>}
            {!r.prompt && !r.summary && !r.result && <p className="agents-empty">{t('panel.trajectory.agents.noDetail')}</p>}
          </td>
        </tr>
      ),
    ];
  };

  const members = (r: AgentRow) => {
    if (!r.workflow || folded[r.i]) return [];
    if (r.workflow.agents.length === 0) {
      return [
        <tr key={`${r.i}-none`} className="agents-traj-member">
          <td />
          <td colSpan={COLS - 1} className="agents-traj-meta">{t('panel.trajectory.agents.noMembers')}</td>
        </tr>,
      ];
    }
    const phases = phaseProgress(r).map((p) => p.phase);
    const groups: Array<{ phase?: string; agents: AgentRow[] }> = [...phases.map((phase) => ({ phase, agents: r.workflow!.agents.filter((a) => a.phase === phase) })), { agents: r.workflow.agents.filter((a) => !a.phase) }].filter((g) => g.agents.length > 0);
    return groups.flatMap((g) => [
      ...(groups.length > 1 || g.phase ? [
        <tr key={`${r.i}-p-${g.phase ?? ''}`} className="agents-traj-member agents-traj-phaserow">
          <td />
          <td colSpan={COLS - 1}>{g.phase ?? t('panel.trajectory.agents.noPhase')}</td>
        </tr>,
      ] : []),
      ...g.agents.flatMap((a) => line(a, `${r.i}-${a.agentId}`, true)),
    ]);
  };

  return (
    <div className="agents-traj-pane">
      <p className="agents-empty">
        {t('panel.trajectory.agents.total', { n: count, tokens: fmtTokens(totalTokens) || '0' })}
        {totalCost > 0 && ` · ${fmtCost(totalCost)}`}
        {runs > 0 && ` · ${t('panel.trajectory.agents.runs', { n: runs })}`}
      </p>
      <table className="agents-traj-table agents-traj-cmds">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('panel.trajectory.agents.agent')}</th>
            <th>{t('panel.trajectory.agents.status')}</th>
            <th>{t('panel.trajectory.commands.duration')}</th>
            <th>{t('panel.trajectory.stats.tokens')}</th>
            <th>{t('panel.trajectory.agents.cost')}</th>
            <th>{t('panel.trajectory.agents.toolUses')}</th>
            <th />
          </tr>
        </thead>
        <tbody>{rows.flatMap((r) => [...line(r, String(r.i), false), ...members(r)])}</tbody>
      </table>
    </div>
  );
}

/** One row per prompt you typed: what the turn did, how long it took and what it cost. */
type PromptSort = 'order' | 'cost' | 'tokens' | 'duration';

export function PromptsView({ steps, onGoto, onFiles }: ViewProps & { onFiles(prompt: number): void }) {
  const [sort, setSort] = useState<PromptSort>('order');
  const all = useMemo(() => promptRows(steps), [steps]);
  const rows = useMemo(() => {
    if (sort === 'order') return all;
    const key = (r: (typeof all)[number]) => (sort === 'cost' ? r.cost : sort === 'tokens' ? r.tokens : (r.durationMs ?? 0));
    return [...all].sort((a, b) => key(b) - key(a));
  }, [all, sort]);
  if (rows.length === 0) return <Empty title={t('panel.trajectory.prompts.empty')} />;
  const top = rows.reduce((m, r) => (r.cost > m ? r.cost : m), 0);
  return (
    <div className="agents-traj-pane">
      <div className="agents-traj-kinds" role="group" aria-label={t('panel.trajectory.prompts.sort')}>
        <span className="agents-traj-meta">{t('panel.trajectory.prompts.sort')}</span>
        {(['order', 'cost', 'tokens', 'duration'] as const).map((k) => (
          <Button key={k} variant="ghost" size="xs" pressed={sort === k} onClick={() => setSort(k)}>
            {t(`panel.trajectory.prompts.sort.${k}`)}
          </Button>
        ))}
      </div>
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
            <th>{t('panel.trajectory.stats.tokens')}</th>
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
              <td>{r.files ? <Button variant="ghost" size="xs" title={t('panel.trajectory.prompts.showFiles')} onClick={() => onFiles(r.i)}>{r.files}</Button> : ''}</td>
              <td>{r.tokens ? fmtTokens(r.tokens) : ''}</td>
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
