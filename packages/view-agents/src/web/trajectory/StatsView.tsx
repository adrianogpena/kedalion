import { useMemo } from 'react';
import { Empty } from '@kedalion/ui';
import type { AgentTraceStep } from '../../protocol';
import { t } from '../../i18n';
import { fmtDuration, fmtTokens, toolStats, totalsOf } from './model';

/** Tool statistics (calls, errors, time) and the session's token totals. Clicking a tool filters the steps to it. */
export function StatsView({ steps, onTool }: { steps: AgentTraceStep[]; onTool(tool: string): void }) {
  const stats = useMemo(() => toolStats(steps), [steps]);
  const totals = useMemo(() => totalsOf(steps), [steps]);
  const rows: Array<[string, string]> = [
    [t('panel.trajectory.stats.span'), fmtDuration(totals.spanMs) || '–'],
    [t('panel.trajectory.stats.turns'), String(totals.turns)],
    [t('panel.trajectory.stats.input'), fmtTokens(totals.input)],
    [t('panel.trajectory.stats.output'), fmtTokens(totals.output)],
    [t('panel.trajectory.stats.cacheRead'), fmtTokens(totals.cacheRead)],
    [t('panel.trajectory.stats.cacheWrite'), fmtTokens(totals.cacheWrite)],
    [t('panel.trajectory.stats.peak'), fmtTokens(totals.peakContext) || '–'],
  ];
  return (
    <div className="agents-traj-stats">
      <section>
        <h3 className="agents-traj-stats-title">{t('panel.trajectory.stats.session')}</h3>
        <dl className="agents-traj-totals">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
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
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.tool}>
                <td>
                  <button type="button" className="agents-traj-link" onClick={() => onTool(s.tool)}>{s.tool}</button>
                </td>
                <td>{s.calls}</td>
                <td className={s.errors ? 'agents-traj-error' : undefined}>{s.errors || ''}</td>
                <td>{fmtDuration(s.totalMs) || '–'}</td>
                <td>{fmtDuration(s.calls ? s.totalMs / s.calls : 0) || '–'}</td>
                <td>{fmtDuration(s.maxMs) || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
