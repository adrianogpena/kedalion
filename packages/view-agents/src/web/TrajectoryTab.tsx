import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ContextMenu, type ContextMenuItem, Empty, ErrorBanner, Spinner, useAsync, useRovingList } from '@kedalion/ui';
import type { AgentTraceStep } from '../protocol';
import { t } from '../i18n';
import { getTrace } from './api';
import { FilesView } from './trajectory/FilesView';
import { StatsView } from './trajectory/StatsView';
import { Timeline } from './trajectory/Timeline';
import {
  applyFilters,
  entriesOf,
  filesOf,
  filtersActive,
  findFrom,
  fmtClock,
  fmtDelta,
  fmtDuration,
  fmtTokens,
  focusOf,
  infoOf,
  isError,
  isPrompt,
  NO_FILTERS,
  resultTokens,
  STEP_KINDS,
  stepMarkdown,
  toolNames,
  type Filters,
  type StepInfo,
  type StepFocus,
} from './trajectory/model';

/** Lines PgUp / PgDn scroll the detail by. */
const PAGE_LINES = 5;
/** Background refresh of the trace while the tab is visible. */
const REFRESH_MS = 3000;

const KIND_KEY = {
  user: 'agents.trajectory.user',
  assistant: 'agents.trajectory.assistant',
  tool: 'agents.trajectory.tool',
  thinking: 'panel.trajectory.thinking',
} as const;

const kindLabel = (s: AgentTraceStep) => (s.source ? t(`panel.trajectory.source.${s.source}`) : t(KIND_KEY[s.kind]));
const lineOf = (s: AgentTraceStep) => `${kindLabel(s)}: ${s.label}`;

type Tab = 'steps' | 'files' | 'stats';

export interface TrajectoryTabProps {
  /** The selected session's id; absent when none is selected. */
  sessionId?: string;
  /** The session is a Claude session with a transcript to read. */
  available: boolean;
  /** Esc / v / q inside the tab. */
  onClose: () => void;
  /** Side-panel form: the step list with duration and context per step and the right-click menu, nothing else. */
  compact?: boolean;
  /** Claude is working in the session: the live row shows the tool call in flight. */
  running?: boolean;
  /** The session view is a transcript (stopped or external), so a step can be shown there. */
  canShow?: boolean;
  onShow?: (focus: StepFocus) => void;
  /** Opens the Output panel on the Bash call with that tool-use id. */
  onOutput?: (toolUseId: string) => void;
  /** Side-panel form: opens the full Trajectory view with that step (0-based) selected. */
  onExpand?: (step: number) => void;
  /** Step (0-based) to select once the steps have loaded, e.g. when opened from the side panel. */
  initialStep?: number;
}

function StepMeta({ s, info, n, total }: { s: AgentTraceStep; info?: StepInfo; n: number; total: number }) {
  const cells: Array<[string, string]> = [[t('panel.trajectory.meta.step'), t('panel.trajectory.meta.stepValue', { n, total })]];
  if (s.ts) cells.push([t('panel.trajectory.meta.time'), fmtClock(s.ts)]);
  if (s.pending) cells.push([t('panel.trajectory.meta.duration'), t('panel.trajectory.pending')]);
  else if (s.durationMs !== undefined) cells.push([t('panel.trajectory.meta.duration'), fmtDuration(s.durationMs)]);
  if (s.tokens) {
    cells.push([t('panel.trajectory.meta.tokens'), t('panel.trajectory.meta.tokensValue', { input: fmtTokens(s.tokens.input), output: fmtTokens(s.tokens.output), cache: fmtTokens(s.tokens.cacheRead + s.tokens.cacheWrite) })]);
  }
  if (s.context) {
    const base = s.contextPercent !== undefined ? `${fmtTokens(s.context)} · ${s.contextPercent}%` : fmtTokens(s.context);
    cells.push([t('panel.trajectory.meta.context'), info?.delta !== undefined ? `${base} (${fmtDelta(info.delta)})` : base]);
  }
  const rt = resultTokens(s);
  if (rt !== undefined) cells.push([t('panel.trajectory.meta.result'), t('panel.trajectory.meta.resultValue', { n: fmtTokens(rt) })]);
  if (info?.head !== undefined) cells.push([t('panel.trajectory.meta.request'), t('panel.trajectory.meta.requestSame', { n: info.head + 1, all: info.members.map((m) => `#${m + 1}`).join(' ') })]);
  else if (info && info.group > 1) cells.push([t('panel.trajectory.meta.request'), t('panel.trajectory.meta.requestHead', { all: info.members.map((m) => `#${m + 1}`).join(' ') })]);
  if (s.model) cells.push([t('panel.trajectory.meta.model'), s.model]);
  if (s.sidechain) cells.push([t('panel.trajectory.meta.subagent'), '✓']);
  if (cells.length === 0) return null;
  return (
    <dl className="agents-traj-metabar">
      {cells.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The Trajectory tab: the session's steps (prompts, replies, thinking, tool calls) newest first, with the picked step's detail; Files and Statistics views, filters and a timeline in the wide form. */
export function TrajectoryTab({ sessionId, available, onClose, compact = false, running = false, canShow = false, onShow, onOutput, onExpand, initialStep }: TrajectoryTabProps) {
  const [picked, setPicked] = useState<number>();
  const [seen, setSeen] = useState(0);
  const [tab, setTab] = useState<Tab>('steps');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'> }>();
  const [now, setNow] = useState(Date.now());
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLPreElement>(null);
  const state = useAsync(() => (sessionId && available ? getTrace(sessionId) : Promise.resolve(undefined)), [sessionId, available], available && sessionId ? REFRESH_MS : 0);
  useRovingList(listRef, '.agents-traj-step');
  useEffect(() => {
    setPicked(undefined);
    setFilters(NO_FILTERS);
    setTab('steps');
  }, [sessionId]);

  const steps = state.data?.steps;
  const appliedStep = useRef<string>();
  useEffect(() => {
    if (initialStep === undefined || !steps || steps.length === 0) return;
    const key = `${sessionId}:${initialStep}`;
    if (appliedStep.current === key) return;
    appliedStep.current = key;
    setPicked(initialStep >= steps.length - 1 ? undefined : initialStep);
    setSeen(steps.length);
  }, [initialStep, steps, sessionId]);
  const entries = useMemo(() => entriesOf(steps ?? []), [steps]);
  const visible = useMemo(() => applyFilters(entries, filters), [entries, filters]);
  const infos = useMemo(() => infoOf(steps ?? []), [steps]);
  const tint = useMemo(() => {
    const m = new Map<string, number>();
    (steps ?? []).forEach((s, i) => {
      if (s.messageId && infos[i]!.group > 1 && !m.has(s.messageId)) m.set(s.messageId, m.size % 2);
    });
    return m;
  }, [steps, infos]);
  const last = entries.length - 1;
  const live = running && !compact ? steps?.filter((s) => s.kind === 'tool' && s.pending).pop() : undefined;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const vPos = (() => {
    if (visible.length === 0) return -1;
    if (picked === undefined) return visible.length - 1;
    let p = visible.length - 1;
    while (p > 0 && visible[p]!.i > picked) p--;
    return p;
  })();
  const index = vPos >= 0 ? visible[vPos]!.i : -1;
  const step = index >= 0 ? steps?.[index] : undefined;

  useEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [index, sessionId]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!sessionId) return <Empty title={t('agents.trajectory.noSession')} />;
  if (!available) return <Empty title={t('agents.trajectory.unavailable')} />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.reload} />;
  if (!steps) {
    return (
      <div className="agents-traj-loading">
        <Spinner />
      </div>
    );
  }
  if (steps.length === 0) return <Empty title={t('agents.trajectory.empty')} />;

  const pick = (i: number) => {
    setPicked(i >= last ? undefined : i);
    setSeen(steps.length);
  };
  const newCount = picked === undefined ? 0 : Math.max(0, steps.length - seen);
  const focusStep = (domPos: number) => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('.agents-traj-step');
    items?.[Math.max(0, Math.min((items?.length ?? 1) - 1, domPos))]?.focus();
  };
  const jump = (dir: 1 | -1, match: (s: AgentTraceStep) => boolean) => {
    const hit = findFrom(visible, vPos, dir, match);
    if (hit) focusStep(visible.length - 1 - visible.indexOf(hit));
  };
  const setKind = (k: AgentTraceStep['kind']) =>
    setFilters((f) => {
      const on = f.kinds.includes(k);
      return { ...f, kinds: on ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] };
    });
  const openTool = (tool: string) => {
    setFilters({ ...NO_FILTERS, tool });
    setTab('steps');
  };
  const gotoStep = (i: number) => {
    setFilters(NO_FILTERS);
    setTab('steps');
    pick(i);
  };

  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => undefined);
  const openMenu = (e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    const s = steps[i]!;
    pick(i);
    const items: Array<ContextMenuItem | 'sep'> = [
      { id: 'copy', label: t('panel.trajectory.menu.copy'), icon: 'copy', run: () => copy(s.detail) },
      { id: 'md', label: t('panel.trajectory.menu.copyMarkdown'), icon: 'markdown', run: () => copy(stepMarkdown(s, kindLabel(s))) },
    ];
    if (s.file) items.push({ id: 'path', label: t('panel.trajectory.menu.copyPath'), icon: 'file', run: () => copy(s.file!) });
    items.push('sep');
    const focus = onShow ? focusOf(steps, i, Date.now()) : undefined;
    if (onShow) items.push({ id: 'show', label: t('panel.trajectory.menu.show'), icon: 'eye', hint: canShow ? undefined : t('panel.trajectory.menu.showHint'), disabled: !canShow || !focus, run: () => focus && onShow(focus) });
    if (compact && onExpand) items.push({ id: 'expand', label: t('panel.trajectory.menu.expand'), icon: 'plan', run: () => onExpand(i) });
    if (s.tool === 'Bash' && s.toolUseId && onOutput) items.push({ id: 'output', label: t('panel.trajectory.menu.output'), icon: 'terminal', run: () => onOutput(s.toolUseId!) });
    if (!compact) {
      if (s.file) items.push({ id: 'files', label: t('panel.trajectory.menu.files'), icon: 'file', run: () => setTab('files') });
      if (s.tool) items.push({ id: 'only', label: t('panel.trajectory.menu.onlyTool', { tool: s.tool }), icon: 'search', run: () => openTool(s.tool!) });
    }
    setMenu({ at: { x: e.clientX, y: e.clientY }, items });
  };

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea')) {
      if (e.key === 'Escape') {
        (target as HTMLElement).blur();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const detail = detailRef.current;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if ((e.key === 'PageUp' || e.key === 'PageDown') && detail) {
      const line = Number.parseFloat(getComputedStyle(detail).lineHeight) || 18;
      detail.scrollBy({ top: (e.key === 'PageUp' ? -1 : 1) * line * PAGE_LINES });
      stop();
    } else if (e.key === 'j' || e.key === 'k') {
      focusStep(visible.length - 1 - vPos + (e.key === 'j' ? 1 : -1));
      stop();
    } else if (!compact && tab === 'steps' && (e.key === 'e' || e.key === 'E')) {
      jump(e.key === 'e' ? -1 : 1, isError);
      stop();
    } else if (!compact && tab === 'steps' && (e.key === 'p' || e.key === 'P')) {
      jump(e.key === 'p' ? -1 : 1, isPrompt);
      stop();
    } else if (!compact && e.key === '/') {
      document.querySelector<HTMLInputElement>('.agents-traj-search')?.focus();
      stop();
    } else if (e.key === 'Escape' || e.key === 'v' || e.key === 'q') {
      onClose();
      stop();
    }
  };

  const tools = toolNames(steps);
  const active = filtersActive(filters);

  const row = (i: number, s: AgentTraceStep, around: [AgentTraceStep | undefined, AgentTraceStep | undefined]) => {
    const grouped = s.messageId !== undefined && tint.has(s.messageId);
    const edge = (n: AgentTraceStep | undefined) => (n?.messageId === s.messageId ? '' : ' agents-traj-grp-edge');
    const grp = grouped ? ` agents-traj-grp agents-traj-grp-${tint.get(s.messageId!)}${edge(around[0]).replace('edge', 'top')}${edge(around[1]).replace('edge', 'bottom')}` : '';
    return (
    <li key={i}>
      <button
        type="button"
        className={`agents-traj-step agents-traj-${s.kind}${s.error ? ' agents-traj-error' : ''}${s.source ? ` agents-traj-src-${s.source}` : ''}${s.sidechain ? ' agents-traj-sub' : ''}${grp}`}
        aria-pressed={i === index}
        title={lineOf(s)}
        onFocus={() => pick(i)}
        onClick={() => pick(i)}
        onContextMenu={(e) => openMenu(e, i)}
      >
        <span className="agents-traj-num">#{i + 1}</span>
        {!compact && s.ts && <span className="agents-traj-time">{fmtClock(s.ts)}</span>}
        <span className="agents-traj-kind">{kindLabel(s)}:</span>
        <span className="agents-traj-label">{s.label}</span>
        {!compact && infos[i]?.head !== undefined && (
          <span className="agents-traj-same" title={t('panel.trajectory.sameRequest', { n: infos[i]!.head! + 1 })}>{t('panel.trajectory.partOf', { n: infos[i]!.head! + 1 })}</span>
        )}
        {!compact && s.pending && <span className="agents-traj-pending" aria-label={t('panel.trajectory.pending')} />}
        {s.durationMs !== undefined && <span className="agents-traj-meta" title={t('panel.trajectory.meta.duration')}>{fmtDuration(s.durationMs)}</span>}
        {s.context ? <span className="agents-traj-meta agents-traj-ctx" title={t('panel.trajectory.meta.context')}>{s.contextPercent !== undefined ? `${s.contextPercent}%` : fmtTokens(s.context)}</span> : null}
      </button>
    </li>
    );
  };

  const list = (
    <div className="agents-traj-listcol">
      {live && (
        <div className="agents-traj-live" role="status">
          <span className="agents-traj-pending" />
          <span className="agents-traj-label">{t('panel.trajectory.live.running', { label: live.label })}</span>
          {live.ts && <span className="agents-traj-meta">{t('panel.trajectory.live.for', { time: fmtDuration(now - live.ts) })}</span>}
        </div>
      )}
      {newCount > 0 && (
        <Button variant="ghost" size="xs" className="agents-traj-new" onClick={() => setPicked(undefined)}>
          {t('panel.trajectory.new', { n: newCount })}
        </Button>
      )}
      <ul ref={listRef} className="agents-traj-list" aria-label={t('agents.trajectory.steps')}>
        {[...visible].reverse().map(({ step: s, i }, k, all) => row(i, s, [all[k - 1]?.step, all[k + 1]?.step]))}
      </ul>
    </div>
  );

  const detail = (
    <div className="agents-traj-detailcol">
      {step && <StepMeta s={step} info={infos[index]} n={index + 1} total={steps.length} />}
      {step?.tool === 'Bash' && step.toolUseId && onOutput && (
        <div className="agents-traj-actions">
          <Button size="xs" icon="terminal" onClick={() => onOutput(step.toolUseId!)}>{t('panel.trajectory.menu.output')}</Button>
        </div>
      )}
      <pre ref={detailRef} className="agents-traj-detail" tabIndex={0} aria-label={t('agents.trajectory.detail')}>
        {step ? step.detail || t('agents.trajectory.noDetail') : t('agents.trajectory.empty')}
      </pre>
    </div>
  );

  const menuEl = menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} />;

  if (compact) {
    return (
      <div className="agents-traj agents-traj-compact" onKeyDownCapture={onKeyDownCapture}>
        {list}
        <pre ref={detailRef} className="agents-traj-detail agents-traj-preview" tabIndex={0} aria-label={t('agents.trajectory.detail')}>
          {step ? step.detail || t('agents.trajectory.noDetail') : t('agents.trajectory.empty')}
        </pre>
        {menuEl}
      </div>
    );
  }

  const shown = new Set(visible.map((v) => v.i));
  return (
    <div className="agents-traj-root" onKeyDownCapture={onKeyDownCapture}>
      <div className="agents-traj-bar">
        <div className="agents-traj-tabs" role="tablist">
          {(['steps', 'files', 'stats'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="agents-traj-tab" onClick={() => setTab(k)}>
              {t(`panel.trajectory.tab.${k}`)}
            </button>
          ))}
        </div>
        {tab === 'steps' && (
          <>
            <div className="agents-traj-kinds">
              {STEP_KINDS.map((k) => (
                <Button key={k} variant="ghost" size="xs" pressed={filters.kinds.includes(k)} onClick={() => setKind(k)}>
                  {t(KIND_KEY[k])}
                </Button>
              ))}
              <Button variant="ghost" size="xs" pressed={filters.errorsOnly} onClick={() => setFilters((f) => ({ ...f, errorsOnly: !f.errorsOnly }))}>
                {t('panel.trajectory.filter.errors')}
              </Button>
            </div>
            <select className="agents-traj-tool" aria-label={t('panel.trajectory.filter.tool')} value={filters.tool} onChange={(e) => setFilters((f) => ({ ...f, tool: e.target.value }))}>
              <option value="">{t('panel.trajectory.filter.allTools')}</option>
              {tools.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            <input
              type="search"
              className="agents-traj-search"
              value={filters.query}
              placeholder={t('panel.trajectory.filter.search')}
              aria-label={t('panel.trajectory.filter.search')}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
            {active && (
              <>
                <span className="agents-traj-meta">{t('panel.trajectory.filter.shown', { shown: visible.length, total: steps.length })}</span>
                <Button variant="ghost" size="xs" onClick={() => setFilters(NO_FILTERS)}>{t('panel.trajectory.filter.reset')}</Button>
              </>
            )}
            <div className="agents-traj-nav">
              <Button variant="ghost" size="xs" title={t('panel.trajectory.nav.prevError')} aria-label={t('panel.trajectory.nav.prevError')} onClick={() => jump(-1, isError)}>✕↓</Button>
              <Button variant="ghost" size="xs" title={t('panel.trajectory.nav.nextError')} aria-label={t('panel.trajectory.nav.nextError')} onClick={() => jump(1, isError)}>✕↑</Button>
              <Button variant="ghost" size="xs" title={t('panel.trajectory.nav.prevPrompt')} aria-label={t('panel.trajectory.nav.prevPrompt')} onClick={() => jump(-1, isPrompt)}>{t(KIND_KEY.user)}↓</Button>
              <Button variant="ghost" size="xs" title={t('panel.trajectory.nav.nextPrompt')} aria-label={t('panel.trajectory.nav.nextPrompt')} onClick={() => jump(1, isPrompt)}>{t(KIND_KEY.user)}↑</Button>
            </div>
          </>
        )}
      </div>
      {tab === 'steps' && <Timeline steps={steps} shown={shown} picked={index} onPick={pick} />}
      {tab === 'steps' &&
        (visible.length === 0 ? (
          <Empty title={t('panel.trajectory.filter.shown', { shown: 0, total: steps.length })} />
        ) : (
          <div className="agents-traj">
            {list}
            {detail}
          </div>
        ))}
      {tab === 'files' && <FilesView files={filesOf(steps)} onGoto={gotoStep} />}
      {tab === 'stats' && <StatsView steps={steps} onTool={openTool} />}
      {menuEl}
    </div>
  );
}
