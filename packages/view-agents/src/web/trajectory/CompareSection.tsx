import { useState } from 'react';
import { useAsync } from '@kedalion/ui';
import type { AgentSessionSummary } from '../../protocol';
import { t } from '../../i18n';
import { getCompare, getSiblings } from '../api';
import { fmtDuration, fmtTokens } from './model';

const fmtCost = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
const count = (n: number) => String(Math.round(n * 10) / 10);

interface Metric {
  key: keyof Omit<AgentSessionSummary, 'id'>;
  label: string;
  fmt(n: number): string;
}

function metrics(): Metric[] {
  return [
    { key: 'cost', label: t('panel.trajectory.stats.costTotal'), fmt: fmtCost },
    { key: 'spanMs', label: t('panel.trajectory.stats.span'), fmt: (n) => fmtDuration(n) || '–' },
    { key: 'prompts', label: t('panel.trajectory.compare.prompts'), fmt: count },
    { key: 'turns', label: t('panel.trajectory.stats.turns'), fmt: count },
    { key: 'toolCalls', label: t('panel.trajectory.stats.calls'), fmt: count },
    { key: 'errors', label: t('panel.trajectory.stats.errors'), fmt: count },
    { key: 'outputTokens', label: t('panel.trajectory.stats.output'), fmt: (n) => fmtTokens(Math.round(n)) },
    { key: 'peakContext', label: t('panel.trajectory.stats.peak'), fmt: (n) => fmtTokens(Math.round(n)) },
    { key: 'filesEdited', label: t('panel.trajectory.compare.files'), fmt: count },
  ];
}

const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? '' : '+∞') : `${a >= b ? '+' : '−'}${Math.round((Math.abs(a - b) / b) * 100)}%`);

/** This session next to the project's average or another session of the project. */
export function CompareSection({ sessionId }: { sessionId?: string }) {
  const [other, setOther] = useState('project');
  const siblings = useAsync(() => (sessionId ? getSiblings(sessionId) : Promise.resolve(undefined)), [sessionId], 0);
  const cmp = useAsync(() => (sessionId ? getCompare(sessionId, other) : Promise.resolve(undefined)), [sessionId, other], 0);
  if (!sessionId) return null;
  const data = cmp.data;
  return (
    <section>
      <h3 className="agents-traj-stats-title">{t('panel.trajectory.compare.title')}</h3>
      <select className="agents-traj-fsearch agents-traj-select" value={other} aria-label={t('panel.trajectory.compare.with')} onChange={(e) => setOther(e.target.value)}>
        <option value="project">{t('panel.trajectory.compare.average')}</option>
        {(siblings.data?.sessions ?? []).map((s) => (
          <option key={s.id} value={s.id}>{`${new Date(s.mtime).toLocaleDateString()} · ${s.prompt ?? s.id.slice(0, 8)}`}</option>
        ))}
      </select>
      {data && !data.other && <p className="agents-empty">{t('panel.trajectory.compare.none')}</p>}
      {data?.other && (
        <>
          <p className="agents-empty">{other === 'project' ? t('panel.trajectory.compare.averageOf', { n: data.count }) : t('panel.trajectory.compare.picked')}</p>
          <table className="agents-traj-table">
            <thead>
              <tr>
                <th />
                <th>{t('panel.trajectory.compare.this')}</th>
                <th>{t('panel.trajectory.compare.other')}</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {metrics().map((m) => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  <td>{m.fmt(data.current[m.key])}</td>
                  <td>{m.fmt(data.other![m.key])}</td>
                  <td>{delta(data.current[m.key], data.other![m.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
