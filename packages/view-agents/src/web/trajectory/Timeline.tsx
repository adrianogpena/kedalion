import { useMemo } from 'react';
import type { AgentTraceStep } from '../../protocol';
import { t } from '../../i18n';
import { fmtClock } from './model';

const MAX_TICKS = 300;

interface Tick {
  /** Position of the step the tick selects (the last of its bucket). */
  to: number;
  kind: AgentTraceStep['kind'];
  source: AgentTraceStep['source'];
  error: boolean;
  dim: boolean;
}

const RANK: Record<AgentTraceStep['kind'], number> = { thinking: 0, assistant: 1, tool: 2, user: 3 };

/** One tick per step, colored by kind, errors in red; past `MAX_TICKS` steps a tick stands for a run of steps. Click selects. */
export function Timeline({ steps, shown, picked, onPick }: { steps: AgentTraceStep[]; shown: Set<number>; picked: number; onPick(i: number): void }) {
  const ticks = useMemo<Tick[]>(() => {
    const size = Math.max(1, Math.ceil(steps.length / MAX_TICKS));
    const out: Tick[] = [];
    for (let from = 0; from < steps.length; from += size) {
      const to = Math.min(steps.length, from + size) - 1;
      let kind: Tick['kind'] = steps[from]!.kind;
      let source = steps[from]!.source;
      let error = false;
      let dim = true;
      for (let i = from; i <= to; i++) {
        const s = steps[i]!;
        if (RANK[s.kind] > RANK[kind] || (s.kind === 'user' && kind === 'user' && source && !s.source)) {
          kind = s.kind;
          source = s.source;
        }
        if (s.error) error = true;
        if (shown.has(i)) dim = false;
      }
      out.push({ to, kind, source, error, dim });
    }
    return out;
  }, [steps, shown]);

  return (
    <div className="agents-traj-timeline" role="group" aria-label={t('panel.trajectory.timeline')}>
      {ticks.map((k) => {
        const s = steps[k.to]!;
        const active = picked >= k.to - Math.max(0, Math.ceil(steps.length / MAX_TICKS) - 1) && picked <= k.to;
        return (
          <button
            key={k.to}
            type="button"
            tabIndex={-1}
            className={`agents-traj-tick agents-traj-tick-${k.kind}${k.source ? ` agents-traj-tick-src-${k.source}` : ''}${k.error ? ' agents-traj-tick-error' : ''}${k.dim ? ' agents-traj-tick-dim' : ''}`}
            aria-pressed={active}
            title={`${k.to + 1}. ${s.label}${s.ts ? ` · ${fmtClock(s.ts)}` : ''}`}
            onClick={() => onPick(k.to)}
          />
        );
      })}
    </div>
  );
}
