import { useMemo } from 'react';
import { Button, Empty } from '@kedalion/ui';
import type { AgentTraceStep } from '../../protocol';
import { t } from '../../i18n';
import { fmtDuration, fmtTokens, toolStats, totalsOf } from './model';
import { CompareSection } from './CompareSection';
import { activityOf, contextSeries, costOfSteps, errorsOf, fileRollup, heaviestResults, modelsOf, promptsOf, subagentOf, timeOf, toolDetails } from './stats';
import { failedCalls, promptRows } from './views';

const TOP_PROMPTS = 5;
const MAX_FAILED = 50;

const fmtCost = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface Part {
  label: string;
  value: number;
  cls: string;
}

function Bar({ parts }: { parts: Part[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;
  return (
    <div className="agents-traj-bar-stack" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value / total)}`).join(', ')}>
      {parts.map((p) => (p.value > 0 ? <span key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${pct(p.value / total)}`} /> : null))}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; value: string; cls?: string }> }) {
  return (
    <dl className="agents-traj-totals">
      {items.map((p) => (
        <div key={p.label}>
          <dt>
            {p.cls && <span className={`agents-traj-swatch ${p.cls}`} />} {p.label}
          </dt>
          <dd>{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ContextChart({ points, onGoto }: { points: ReturnType<typeof contextSeries>; onGoto(i: number): void }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 80;
  const usePercent = points.every((p) => p.percent !== undefined);
  const max = usePercent ? 100 : Math.max(...points.map((p) => p.context), 1);
  const x = (k: number) => (k / (points.length - 1)) * W;
  const yOf = (v: number) => H - (v / max) * (H - 4) - 2;
  const y = (p: (typeof points)[number]) => yOf(usePercent ? p.percent! : p.context);
  return (
    <svg className="agents-traj-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('panel.trajectory.stats.contextChart')}>
      {usePercent && <line className="agents-traj-chart-warn" x1="0" x2={W} y1={yOf(80)} y2={yOf(80)} />}
      <polyline className="agents-traj-chart-line" fill="none" points={points.map((p, k) => `${x(k)},${y(p)}`).join(' ')} />
      {points.map((p, k) =>
        p.drop || (usePercent && p.percent! >= 80) ? (
          <circle key={p.i} className={p.drop ? 'agents-traj-chart-drop' : 'agents-traj-chart-hot'} cx={x(k)} cy={y(p)} r="3.5" onClick={() => onGoto(p.i)}>
            <title>{`${t(p.drop ? 'panel.trajectory.stats.compaction' : 'panel.trajectory.stats.nearFull')} · ${t('panel.trajectory.stats.step', { n: p.i + 1 })} · ${fmtTokens(p.context)}`}</title>
          </circle>
        ) : null,
      )}
    </svg>
  );
}

const Title = ({ text }: { text: string }) => <h3 className="agents-traj-stats-title">{text}</h3>;

/** Session statistics: totals, cost, models, time, context, heaviest results, prompts, subagents, errors, activity, files and tools. Clicking a tool filters the steps to it. */
export function StatsView({ steps, sessionId, unknown, onTool, onGoto }: { steps: AgentTraceStep[]; sessionId?: string; unknown: ReadonlySet<number>; onTool(tool: string): void; onGoto(i: number): void }) {
  const failed = useMemo(() => failedCalls(steps), [steps]);
  const costly = useMemo(() => promptRows(steps).filter((r) => r.cost > 0 || r.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, TOP_PROMPTS), [steps]);
  const unknownList = useMemo(() => [...unknown].sort((a, b) => a - b), [unknown]);
  const stats = useMemo(() => toolStats(steps), [steps]);
  const totals = useMemo(() => totalsOf(steps), [steps]);
  const models = useMemo(() => modelsOf(steps), [steps]);
  const cost = useMemo(() => costOfSteps(steps), [steps]);
  const time = useMemo(() => timeOf(steps), [steps]);
  const ctx = useMemo(() => contextSeries(steps), [steps]);
  const heavy = useMemo(() => heaviestResults(steps), [steps]);
  const prompts = useMemo(() => promptsOf(steps), [steps]);
  const split = useMemo(() => subagentOf(steps), [steps]);
  const errors = useMemo(() => errorsOf(steps), [steps]);
  const activity = useMemo(() => activityOf(steps), [steps]);
  const roll = useMemo(() => fileRollup(steps), [steps]);
  const details = useMemo(() => toolDetails(steps), [steps]);
  const rows: Array<[string, string]> = [
    [t('panel.trajectory.stats.span'), fmtDuration(totals.spanMs) || '–'],
    [t('panel.trajectory.stats.turns'), String(totals.turns)],
    [t('panel.trajectory.stats.input'), fmtTokens(totals.input)],
    [t('panel.trajectory.stats.output'), fmtTokens(totals.output)],
    [t('panel.trajectory.stats.cacheRead'), fmtTokens(totals.cacheRead)],
    [t('panel.trajectory.stats.cacheWrite'), fmtTokens(totals.cacheWrite)],
    [t('panel.trajectory.stats.peak'), fmtTokens(totals.peakContext) || '–'],
  ];
  const sources = (['you', 'skill', 'shell', 'task', 'agent', 'system'] as const).filter((k) => prompts[k] > 0);
  return (
    <div className="agents-traj-stats">
      <section>
        <Title text={t('panel.trajectory.stats.session')} />
        <dl className="agents-traj-totals">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      {cost.total > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.cost')} />
          <Bar parts={[{ label: t('panel.trajectory.stats.input'), value: cost.input, cls: 'agents-traj-c1' }, { label: t('panel.trajectory.stats.output'), value: cost.output, cls: 'agents-traj-c2' }, { label: t('panel.trajectory.stats.cacheRead'), value: cost.cacheRead, cls: 'agents-traj-c3' }, { label: t('panel.trajectory.stats.cacheWrite'), value: cost.cacheWrite, cls: 'agents-traj-c4' }]} />
          <Legend items={[{ label: t('panel.trajectory.stats.costTotal'), value: fmtCost(cost.total) }, { label: t('panel.trajectory.stats.input'), value: fmtCost(cost.input), cls: 'agents-traj-c1' }, { label: t('panel.trajectory.stats.output'), value: fmtCost(cost.output), cls: 'agents-traj-c2' }, { label: t('panel.trajectory.stats.cacheRead'), value: fmtCost(cost.cacheRead), cls: 'agents-traj-c3' }, { label: t('panel.trajectory.stats.cacheWrite'), value: fmtCost(cost.cacheWrite), cls: 'agents-traj-c4' }, { label: t('panel.trajectory.stats.hitRate'), value: pct(cost.hitRate) }]} />
          {cost.unpriced > 0 && <p className="agents-empty">{t('panel.trajectory.stats.unpriced', { n: cost.unpriced })}</p>}
        </section>
      )}
      {models.length > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.models')} />
          <table className="agents-traj-table">
            <thead>
              <tr>
                <th>{t('panel.trajectory.stats.model')}</th>
                <th>{t('panel.trajectory.stats.turns')}</th>
                <th>{t('panel.trajectory.stats.output')}</th>
                <th>{t('panel.trajectory.stats.costTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td>
                  <td>{m.turns}</td>
                  <td>{fmtTokens(m.output)}</td>
                  <td>{m.cost > 0 ? fmtCost(m.cost) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.length > 1 && <p className="agents-empty">{t('panel.trajectory.stats.switched', { n: models.length })}</p>}
        </section>
      )}
      {time.spanMs > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.time')} />
          <Bar parts={[{ label: t('panel.trajectory.stats.timeModel'), value: time.modelMs, cls: 'agents-traj-c1' }, { label: t('panel.trajectory.stats.timeTools'), value: time.toolMs, cls: 'agents-traj-c2' }, { label: t('panel.trajectory.stats.timeIdle'), value: time.idleMs, cls: 'agents-traj-c3' }]} />
          <Legend items={[{ label: t('panel.trajectory.stats.timeModel'), value: fmtDuration(time.modelMs) || '–', cls: 'agents-traj-c1' }, { label: t('panel.trajectory.stats.timeTools'), value: fmtDuration(time.toolMs) || '–', cls: 'agents-traj-c2' }, { label: t('panel.trajectory.stats.timeIdle'), value: fmtDuration(time.idleMs) || '–', cls: 'agents-traj-c3' }]} />
        </section>
      )}
      {ctx.length >= 2 && (
        <section>
          <Title text={t('panel.trajectory.stats.context')} />
          <ContextChart points={ctx} onGoto={onGoto} />
          <p className="agents-empty">{t('panel.trajectory.stats.contextNote', { peak: fmtTokens(totals.peakContext), drops: ctx.filter((p) => p.drop).length })}</p>
        </section>
      )}
      {heavy.length > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.heavy')} />
          <table className="agents-traj-table">
            <tbody>
              {heavy.map((h) => (
                <tr key={h.i}>
                  <td>
                    <button type="button" className="agents-traj-link" onClick={() => onGoto(h.i)}>{h.label}</button>
                  </td>
                  <td>{t('panel.trajectory.stats.step', { n: h.i + 1 })}</td>
                  <td>~{fmtTokens(h.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {sources.length > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.prompts')} />
          <Legend items={sources.map((k) => ({ label: t(k === 'you' ? 'panel.trajectory.stats.you' : `panel.trajectory.source.${k}`), value: String(prompts[k]) }))} />
        </section>
      )}
      {split.sub.steps > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.subagents')} />
          <table className="agents-traj-table">
            <thead>
              <tr>
                <th />
                <th>{t('panel.trajectory.stats.steps')}</th>
                <th>{t('panel.trajectory.stats.calls')}</th>
                <th>{t('panel.trajectory.stats.turns')}</th>
                <th>{t('panel.trajectory.stats.tokens')}</th>
                <th>{t('panel.trajectory.stats.costTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {([['main', split.main], ['sub', split.sub]] as const).map(([k, v]) => (
                <tr key={k}>
                  <td>{t(`panel.trajectory.stats.${k}`)}</td>
                  <td>{v.steps}</td>
                  <td>{v.tools}</td>
                  <td>{v.turns}</td>
                  <td>{fmtTokens(v.tokens)}</td>
                  <td>{v.cost > 0 ? fmtCost(v.cost) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {errors.length > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.errorsTitle')} />
          <table className="agents-traj-table">
            <thead>
              <tr>
                <th>{t('panel.trajectory.stats.tool')}</th>
                <th>{t('panel.trajectory.stats.errors')}</th>
                <th>{t('panel.trajectory.stats.rate')}</th>
                <th>{t('panel.trajectory.stats.retries')}</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.tool}>
                  <td>
                    <button type="button" className="agents-traj-link" onClick={() => onTool(e.tool)}>{e.tool}</button>
                  </td>
                  <td className="agents-traj-error">{e.errors}/{e.calls}</td>
                  <td>{pct(e.errors / e.calls)}</td>
                  <td>{e.retries || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {activity && (
        <section>
          <Title text={t('panel.trajectory.stats.activity')} />
          <div className="agents-traj-hist" role="img" aria-label={t('panel.trajectory.stats.activity')}>
            {activity.counts.map((n, k) => (
              <span key={k} style={{ height: `${(n / Math.max(...activity.counts)) * 100}%` }} title={`${new Date(activity.start + k * activity.bucketMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${n}`} />
            ))}
          </div>
          <p className="agents-empty">{t('panel.trajectory.stats.activityNote', { bucket: fmtDuration(activity.bucketMs), pauses: activity.pauses, longest: fmtDuration(activity.longestPauseMs) || '–' })}</p>
        </section>
      )}
      {costly.length > 1 && (
        <section>
          <Title text={t('panel.trajectory.stats.costlyTitle')} />
          <table className="agents-traj-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('panel.trajectory.prompts.prompt')}</th>
                <th>{t('panel.trajectory.stats.costTotal')}</th>
                <th>{t('panel.trajectory.stats.tokens')}</th>
                <th>{t('panel.trajectory.commands.duration')}</th>
                <th>{t('panel.trajectory.stats.calls')}</th>
              </tr>
            </thead>
            <tbody>
              {costly.map((r) => (
                <tr key={r.i}>
                  <td><Button variant="ghost" size="xs" onClick={() => onGoto(r.i)}>{r.i + 1}</Button></td>
                  <td className="agents-traj-cmd" title={r.label}>{r.label}</td>
                  <td>{fmtCost(r.cost)}</td>
                  <td>{fmtTokens(r.tokens)}</td>
                  <td>{fmtDuration(r.durationMs) || '–'}</td>
                  <td>{r.calls || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {failed.length > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.failedTitle', { fixed: failed.filter((f) => f.fixedAt !== undefined).length, total: failed.length })} />
          <table className="agents-traj-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('panel.trajectory.stats.tool')}</th>
                <th>{t('panel.trajectory.stats.call')}</th>
                <th>{t('panel.trajectory.stats.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {failed.slice(0, MAX_FAILED).map((f) => (
                <tr key={f.i}>
                  <td><Button variant="ghost" size="xs" onClick={() => onGoto(f.i)}>{f.i + 1}</Button></td>
                  <td>{f.tool}</td>
                  <td className="agents-traj-cmd" title={f.label}>{f.label}</td>
                  <td>
                    {f.fixedAt !== undefined ? (
                      <Button variant="ghost" size="xs" className="agents-traj-fixed" onClick={() => onGoto(f.fixedAt!)}>{t('panel.trajectory.stats.fixedAt', { n: f.fixedAt + 1 })}</Button>
                    ) : (
                      <span className="agents-traj-error">{t('panel.trajectory.stats.notFixed')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {failed.length > MAX_FAILED && <p className="agents-empty">{t('panel.trajectory.stats.moreFailed', { n: failed.length - MAX_FAILED })}</p>}
        </section>
      )}
      {unknownList.length > 0 && (
        <section>
          <Title text={t('panel.trajectory.stats.unknownTitle', { n: unknownList.length })} />
          <p className="agents-empty">{t('panel.trajectory.unknown.tip')}</p>
          <ul className="agents-traj-shelllist">
            {unknownList.map((i) => (
              <li key={i}>
                <Button variant="ghost" size="xs" onClick={() => onGoto(i)}>#{i + 1}</Button> <span>{steps[i]?.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <Title text={t('panel.trajectory.stats.filesTitle')} />
        <Legend items={[{ label: t('panel.trajectory.stats.filesRead'), value: String(roll.read) }, { label: t('panel.trajectory.stats.filesEdited'), value: String(roll.edited) }, { label: t('panel.trajectory.stats.filesCreated'), value: String(roll.created) }, { label: t('panel.trajectory.stats.filesDeleted'), value: String(roll.deleted) }, { label: t('panel.trajectory.stats.lines'), value: `+${roll.added} −${roll.removed}` }, { label: t('panel.trajectory.stats.bash'), value: String(roll.bash) }]} />
      </section>
      <CompareSection sessionId={sessionId} />
      {stats.length === 0 ? (
        <Empty title={t('panel.trajectory.stats.empty')} />
      ) : (
        <table className="agents-traj-table">
          <thead>
            <tr>
              <th>{t('panel.trajectory.stats.tool')}</th>
              <th>{t('panel.trajectory.stats.calls')}</th>
              <th>{t('panel.trajectory.stats.errors')}</th>
              <th>{t('panel.trajectory.stats.total')}</th>
              <th>{t('panel.trajectory.stats.avg')}</th>
              <th>{t('panel.trajectory.stats.max')}</th>
              <th>{t('panel.trajectory.stats.share')}</th>
              <th>p50</th>
              <th>p95</th>
              <th>{t('panel.trajectory.stats.resultTokens')}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const d = details.get(s.tool);
              return (
                <tr key={s.tool}>
                  <td>
                    <button type="button" className="agents-traj-link" onClick={() => onTool(s.tool)}>{s.tool}</button>
                  </td>
                  <td>{s.calls}</td>
                  <td className={s.errors ? 'agents-traj-error' : undefined}>{s.errors || ''}</td>
                  <td>{fmtDuration(s.totalMs) || '–'}</td>
                  <td>{fmtDuration(s.calls ? s.totalMs / s.calls : 0) || '–'}</td>
                  <td>{fmtDuration(s.maxMs) || '–'}</td>
                  <td>{d ? `${Math.round(d.pct)}%` : ''}</td>
                  <td>{fmtDuration(d?.p50) || '–'}</td>
                  <td>{fmtDuration(d?.p95) || '–'}</td>
                  <td>{d?.resultTokens ? `~${fmtTokens(d.resultTokens)}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
