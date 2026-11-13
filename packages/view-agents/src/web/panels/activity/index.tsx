import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, ErrorBanner, Spinner, useAsync } from '@kedalion/ui';
import { type AgentTraceArea, shortModel } from '../../../protocol';
import { t } from '../../../i18n';
import { getTrace } from '../../api';
import { fmtDuration } from '../../trajectory/model';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps, SectionProps, WorkspaceApi } from '../../workspace/types';
import { boardOf, type Board, type FeedRow, STATIONS, stationOf, wear } from './board';
import './style.css';

const C = 200;
const R = 146;
const SR = 17;
const CR = 38;
const LIVE_MS = 2000;
const IDLE_MS = 6000;
const PULSE_MS = 900;
const RING_MS = 3000;

const areaName = (a: AgentTraceArea) => t(`panel.trajectory.area.${a}`);

function at(a: AgentTraceArea): { x: number; y: number } {
  const k = STATIONS.indexOf(a);
  const rad = ((-90 + (k * 360) / STATIONS.length) * Math.PI) / 180;
  return { x: C + R * Math.cos(rad), y: C + R * Math.sin(rad) };
}

/** An arc around (x, y) of radius r covering `frac` of a turn from the top, clockwise. */
function arc(x: number, y: number, r: number, frac: number): string {
  const f = Math.min(0.9999, Math.max(0, frac));
  const a = 2 * Math.PI * f - Math.PI / 2;
  return `M ${x} ${y - r} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x + r * Math.cos(a)} ${y + r * Math.sin(a)}`;
}

interface Pulse {
  id: number;
  area: AgentTraceArea;
  err: boolean;
}

function MapSvg({ board, now, pulses, answer, modelRing }: { board: Board; now: number; pulses: Pulse[]; answer: number; modelRing: boolean }) {
  const ctx = board.context;
  const ctxLevel = ctx === undefined ? '' : ctx >= 90 ? ' activity-ctx-err' : ctx >= 70 ? ' activity-ctx-warn' : '';
  const ctxLen = 2 * Math.PI * (CR + 5);
  return (
    <svg className="activity-map" viewBox="-40 -14 480 432" role="img" aria-label={t('panel.activity.map')}>
      {STATIONS.map((a) => {
        const p = at(a);
        const w = wear(board.stations[a].count);
        return <line key={`s-${a}`} className={`activity-spoke agents-area-${a}`} x1={C} y1={C} x2={p.x} y2={p.y} style={{ strokeWidth: w.width, opacity: w.opacity }} />;
      })}
      {board.route.map((leg, k) => {
        const a = at(leg.from);
        const b = at(leg.to);
        const newest = k === board.route.length - 1;
        return (
          <path
            key={`r-${leg.key}`}
            className={`activity-route${newest ? ' activity-route-new' : ''}`}
            d={`M ${a.x} ${a.y} Q ${C} ${C} ${b.x} ${b.y}`}
            pathLength={1}
            style={{ opacity: leg.opacity }}
          />
        );
      })}
      {pulses.map((p) => {
        const s = at(p.area);
        return (
          <circle
            key={`p-${p.id}`}
            className={`activity-pulse agents-area-${p.area}${p.err ? ' activity-pulse-err' : ''}`}
            cx={C}
            cy={C}
            r={4}
            style={{ '--dx': `${s.x - C}px`, '--dy': `${s.y - C}px` } as CSSProperties}
          />
        );
      })}
      {answer > 0 && <circle key={`a-${answer}`} className="activity-answer" cx={C} cy={C} r={CR} />}
      <circle className="activity-core" cx={C} cy={C} r={CR} />
      <circle className="activity-ctx-track" cx={C} cy={C} r={CR + 5} />
      {ctx !== undefined && (
        <circle
          className={`activity-ctx${ctxLevel}`}
          cx={C}
          cy={C}
          r={CR + 5}
          strokeDasharray={`${(ctxLen * Math.min(100, ctx)) / 100} ${ctxLen}`}
          transform={`rotate(-90 ${C} ${C})`}
        />
      )}
      {ctx !== undefined && <text className="activity-core-ctx" x={C} y={C - 6}>{Math.round(ctx)}%</text>}
      <text className="activity-core-name" x={C} y={ctx !== undefined ? C + 10 : C + 4}>{board.model ? shortModel(board.model) : 'Claude'}</text>
      {STATIONS.map((a) => {
        const p = at(a);
        const st = board.stations[a];
        const on = st.running > 0;
        const elapsed = on && st.since !== undefined ? Math.max(0, now - st.since) : 0;
        const ring = a === 'model' && modelRing;
        return (
          <g key={`n-${a}`} className={`activity-station agents-area-${a}${on ? ' activity-on' : ''}${st.count === 0 ? ' activity-idle' : ''}`}>
            <title>{`${areaName(a)}: ${t('panel.activity.calls', { n: st.count })}`}</title>
            {ring && <circle className="activity-model-ring" cx={p.x} cy={p.y} r={SR + 6} />}
            <circle className="activity-node" cx={p.x} cy={p.y} r={SR} />
            {on && elapsed > 0 && <path className="activity-hand" d={arc(p.x, p.y, SR + 3, (elapsed % 60_000) / 60_000)} />}
            {on && elapsed > 0 && <path className="activity-hand activity-hand-outer" d={arc(p.x, p.y, SR + 6.5, elapsed / 600_000)} />}
            {on && st.running > 1 && <text className="activity-times" x={p.x} y={p.y + 4}>×{st.running}</text>}
            {a === 'agents' && board.agents > 0 && (
              <g className="activity-orbit" style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
                {Array.from({ length: Math.min(8, board.agents) }, (_, k) => {
                  const r = ((k * 360) / Math.min(8, board.agents) * Math.PI) / 180;
                  return <circle key={k} className="activity-sub" cx={p.x + (SR + 9) * Math.cos(r)} cy={p.y + (SR + 9) * Math.sin(r)} r={2.5} />;
                })}
              </g>
            )}
            <text className="activity-label" x={p.x} y={p.y + SR + 13}>{areaName(a)}</text>
            {st.count > 0 && <text className="activity-count" x={p.x} y={p.y + SR + 25}>{st.count}</text>}
            {st.errors > 0 && (
              <g className="activity-err">
                <circle cx={p.x + SR * 0.75} cy={p.y - SR * 0.75} r={6.5} />
                <text x={p.x + SR * 0.75} y={p.y - SR * 0.75 + 3}>{st.errors > 9 ? '9+' : st.errors}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const GLYPH: Record<FeedRow['status'], string> = { run: '●', ok: '·', err: '✕', model: '◆' };

function Feed({ rows, onOpen }: { rows: FeedRow[]; onOpen: (step: number) => void }) {
  const [open, setOpen] = useState<number>();
  if (rows.length === 0) return <p className="activity-feed-empty">{t('panel.activity.empty')}</p>;
  return (
    <ul className="activity-feed" aria-label={t('panel.activity.feed')}>
      {rows.map((r) => {
        const i = r.entry.i;
        const whole = open === i;
        return (
          <li key={i} className={`activity-row activity-row-${r.status}${whole ? ' activity-row-whole' : ''}`}>
            <span className="activity-glyph" aria-hidden>{GLYPH[r.status]}</span>
            <span className={`agents-traj-area agents-area-${r.area}`} title={areaName(r.area)} />
            <button type="button" className="activity-row-label" title={t('panel.activity.openStep', { n: i + 1 })} onClick={() => onOpen(i)}>
              {r.label}
            </button>
            {r.more > 0 && <span className="activity-more">+{r.more}</span>}
            {r.label.length > 48 && (
              <button type="button" className="activity-expand" aria-expanded={whole} aria-label={t('panel.activity.expand')} onClick={() => setOpen(whole ? undefined : i)}>
                ▸
              </button>
            )}
            <span className="activity-time">{r.ms !== undefined ? fmtDuration(r.ms) : '–'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The map of a session: the one in `sessionId`, else the selected session. */
function ActivityBody({ api, sessionId: given, compact }: { api: WorkspaceApi; sessionId?: string; compact: boolean }) {
  const host = useAgentsHost();
  const sessionId = given || host.selectedId;
  const session = host.sessions.find((s) => s.id === sessionId);
  const available = !!session && session.lifecycle !== 'starting';
  const live = session?.status === 'running';
  const state = useAsync(() => (sessionId && available ? getTrace(sessionId) : Promise.resolve(undefined)), [sessionId, available], available && sessionId ? (live ? LIVE_MS : IDLE_MS) : 0);
  const steps = state.data?.steps;
  const [now, setNow] = useState(Date.now());
  const infos = state.data?.subagents;
  const board = useMemo(() => (steps ? boardOf(steps, now, live, infos) : undefined), [steps, now, live, infos]);

  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [answer, setAnswer] = useState(0);
  const [modelRing, setModelRing] = useState(false);
  const seen = useRef<{ id?: string; n: number; sub: number; subErr: number }>({ n: -1, sub: 0, subErr: 0 });
  const pulseId = useRef(0);
  useEffect(() => {
    if (!steps) return;
    const prev = seen.current;
    const sub = (infos ?? []).reduce((n, a) => n + a.toolUses, 0);
    const subErr = (infos ?? []).reduce((n, a) => n + a.errors, 0);
    seen.current = { id: sessionId, n: steps.length, sub, subErr };
    if (prev.id !== sessionId || prev.n < 0) return;
    const fresh = steps.slice(Math.min(prev.n, steps.length));
    const born: Pulse[] = [];
    for (const s of fresh) {
      const a = stationOf(s);
      if (a && !s.sidechain) born.push({ id: ++pulseId.current, area: a, err: !!s.error });
      else if (a && s.sidechain) born.push({ id: ++pulseId.current, area: 'agents', err: !!s.error });
    }
    // Tool calls of subagents and workflow agents, read from their own transcripts.
    const errs = Math.max(0, subErr - prev.subErr);
    for (let k = 0; k < Math.min(6, Math.max(0, sub - prev.sub)); k++) born.push({ id: ++pulseId.current, area: 'agents', err: k < errs });
    if (born.length > 0) {
      const ids = new Set(born.slice(-6).map((p) => p.id));
      setPulses((p) => [...p, ...born.slice(-6)]);
      window.setTimeout(() => setPulses((p) => p.filter((x) => !ids.has(x.id))), PULSE_MS + 100);
    }
    if (fresh.some((s) => s.modelFrom)) {
      setModelRing(true);
      window.setTimeout(() => setModelRing(false), RING_MS);
    }
  }, [steps, infos, sessionId]);

  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) setAnswer((n) => n + 1);
    wasLive.current = live;
  }, [live]);

  const moving = !!board && (board.route.length > 0 || STATIONS.some((a) => board.stations[a].running > 0));
  useEffect(() => {
    if (!moving) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [moving]);
  useEffect(() => setNow(Date.now()), [steps]);

  if (!sessionId) return <Empty title={t('agents.trajectory.noSession')} />;
  if (!available) return <Empty title={t('agents.trajectory.unavailable')} />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.reload} />;
  if (!board) {
    return (
      <div className="activity-loading">
        <Spinner />
      </div>
    );
  }

  const running = live ? steps!.filter((s) => s.kind === 'tool' && s.pending) : [];
  const top = running[running.length - 1];
  const what = top ? `${areaName(top.area ?? 'shell')}: ${top.label}${running.length > 1 ? t('panel.activity.andMore', { n: running.length - 1 }) : ''}` : t('panel.activity.idle');
  const meter = [board.context !== undefined ? `${Math.round(board.context)}%` : '', board.model ? shortModel(board.model) : ''].filter(Boolean).join(' · ');
  const rows = compact ? board.feed.slice(0, 6) : board.feed;
  return (
    <div className={`activity${compact ? ' activity-compact' : ''}`}>
      <MapSvg board={board} now={now} pulses={pulses} answer={answer} modelRing={modelRing} />
      <div className="activity-now" role="status">
        <span className="activity-now-what">{what}</span>
        {meter && <span className="activity-now-meter">{meter}</span>}
      </div>
      <Feed rows={rows} onOpen={(step) => api.open('trajectory', { sessionId, step })} />
    </div>
  );
}

function ActivityPanel({ params, api }: PanelProps) {
  const sessionId = typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : undefined;
  return (
    <div className="agents-panel-activity">
      <ActivityBody api={api} sessionId={sessionId} compact={params.side === true} />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'activity',
  titleKey: 'panel.activity.title',
  icon: 'locate',
  placement: 'both',
  Panel: ActivityPanel,
  Section: ({ api, sessionId }: SectionProps) => (
    <div className="agents-panel-activity agents-panel-activity-side">
      <ActivityBody api={api} sessionId={sessionId} compact />
    </div>
  ),
};
