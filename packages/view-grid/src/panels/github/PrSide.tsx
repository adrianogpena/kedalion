import { useSyncExternalStore, type ReactNode } from 'react';
import { copyNotify, IconButton, labelList, useAsync, type SidePanelContent } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip, relTime, type Tone } from '../../kit';
import { runAction } from '../../source';
import { latestRc, RC_STEPS, type RcBuild, type RcInfo, type RcStepState } from './rc';
import type { BotEntry } from './bot';
import type { ThreadsInfo } from './threads';
import { POLICY_BOT, type Approvals, type PrItem } from './map';
import type { PullRequestsConfig } from './PullRequests';
import { safeHttpUrl, type CheckDetail, type CheckState, type TrackedPr } from './tracked';
import './github.css';

export const REVIEW_TONE: Record<string, Tone> = { approved: 'ok', changes: 'danger', required: 'warn' };
export const CI_TONE: Record<string, Tone> = { pass: 'ok', fail: 'danger', pending: 'warn', policy: 'info' };

export interface PrSideInput {
  instanceId: string;
  pr: PrItem;
  config: PullRequestsConfig;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gh-pr-card">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Line({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="gh-pr-line" title={title}>
      <span className="muted">{label}</span>
      {children}
    </div>
  );
}

const CHECK_TONE: Record<CheckState, Tone> = { failure: 'danger', pending: 'warn', success: 'ok', neutral: 'neutral' };
const NOTE_MAX = 160;

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function PolicyApprovals({ approvals }: { approvals: Approvals }) {
  const { current, outdated } = approvals;
  return (
    <div className="gh-check-approvals">
      <span title={current.join(', ')}>{tKey('dash.github.pr.policy.current', { n: current.length })}{current.length > 0 && `: ${current.join(', ')}`}</span>
      {outdated.length > 0 && (
        <span className="muted" title={tKey('dash.github.pr.policy.outdatedHint')}>
          {tKey('dash.github.pr.policy.outdated', { n: outdated.length })}: {outdated.join(', ')}
        </span>
      )}
    </div>
  );
}

function CheckRow({ check, approvals }: { check: CheckDetail; approvals?: Approvals }) {
  const start = check.startedAt ? Date.parse(check.startedAt) : NaN;
  const end = check.completedAt ? Date.parse(check.completedAt) : NaN;
  let took = '';
  if (check.state === 'pending') {
    if (!Number.isNaN(start)) took = tKey('dash.github.pr.check.running', { elapsed: duration(Date.now() - start) });
  } else if (!Number.isNaN(start) && !Number.isNaN(end)) took = duration(end - start);
  const endMs = check.completedAt ? Date.parse(check.completedAt) : NaN;
  const finished = Number.isNaN(endMs) ? '' : relTime(endMs);
  const finishedAbs = check.completedAt ? when(check.completedAt) : '';
  const policy = POLICY_BOT.test(check.name);
  const note = check.state === 'failure' ? (check.note ?? '').split('\n')[0]!.trim() : '';
  const cut = check.name.lastIndexOf(' / ');
  const group = cut > 0 ? check.name.slice(0, cut) : check.workflow && !check.name.includes(check.workflow) ? check.workflow : '';
  const job = cut > 0 ? check.name.slice(cut + 3) : check.name;
  return (
    <div className={`gh-check gh-check-${check.state}`}>
      <div className="gh-check-row">
        <Chip tone={CHECK_TONE[check.state]}>{tKey(`dash.github.pr.check.${check.state}`)}</Chip>
        <span className="gh-check-name" title={check.name}>
          {group && <span className="muted">{group} / </span>}
          <strong>{job}</strong>
        </span>
        <span className="gh-check-num">{took}</span>
        <span className="gh-check-num muted" title={finishedAbs ? tKey('dash.github.pr.check.finished', { when: finishedAbs }) : undefined}>{finished}</span>
        {safeHttpUrl(check.url) ? <IconButton icon="link" label={tKey('dash.github.pr.check.open')} onClick={() => window.open(safeHttpUrl(check.url),'_blank', 'noreferrer')} /> : <span />}
      </div>
      {note && (
        <div className="gh-check-note muted" title={note}>
          {note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note}
        </div>
      )}
      {policy && approvals && <PolicyApprovals approvals={approvals} />}
    </div>
  );
}

const checkKey = (c: CheckDetail) => `${c.workflow ?? ''}/${c.name}`;

function CheckGroups({ list, approvals }: { list: readonly CheckDetail[]; approvals: Approvals }) {
  const by = (s: CheckState) => list.filter((c) => c.state === s);
  const sub = (s: CheckState, items: CheckDetail[]) => (
    <div className="gh-check-sub">{tKey(`dash.github.pr.checks.group.${s}`, { n: items.length })}</div>
  );
  const rows = (items: CheckDetail[]) => items.map((c) => <CheckRow key={checkKey(c)} check={c} approvals={approvals} />);
  const failed = by('failure');
  const running = by('pending');
  const passed = by('success');
  const skipped = by('neutral');
  return (
    <div className="gh-check-list">
      {failed.length > 0 && <>{sub('failure', failed)}{rows(failed)}</>}
      {running.length > 0 && <>{sub('pending', running)}{rows(running)}</>}
      {passed.length > 0 &&
        (passed.length > 8 ? (
          <details className="gh-check-fold">
            <summary className="gh-check-sub">{tKey('dash.github.pr.checks.group.success', { n: passed.length })}</summary>
            {rows(passed)}
          </details>
        ) : (
          <>{sub('success', passed)}{rows(passed)}</>
        ))}
      {skipped.length > 0 && (
        <details className="gh-check-fold">
          <summary className="gh-check-sub">{tKey('dash.github.pr.checks.group.neutral', { n: skipped.length })}</summary>
          {rows(skipped)}
        </details>
      )}
    </div>
  );
}

const STEP_TONE: Record<RcStepState, Tone> = { ok: 'ok', fail: 'danger', none: 'neutral' };
const STEP_MARK: Record<RcStepState, string> = { ok: '✅', fail: '❌', none: '🚧' };

const hasRcLabel = (labels: readonly string[], wanted: unknown) => {
  const list = labelList(wanted);
  const ws = (list.length ? list : ['RC branch']).map((w) => w.trim().toLowerCase());
  return labels.some((l) => ws.some((w) => l.toLowerCase().includes(w)));
};

function BuildDate({ date }: { date: string }) {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return <span className="muted">{date}</span>;
  return <span className="muted" title={new Date(t).toLocaleString()}>{relTime(t)}</span>;
}

function Steps({ build }: { build: RcBuild }) {
  return (
    <span className="gh-chips">
      {RC_STEPS.map((s) => {
        const state = build.steps[s] ?? 'none';
        return (
          <Chip key={s} tone={STEP_TONE[state]} title={tKey(`dash.github.rc.state.${state}`)}>
            {STEP_MARK[state]} {tKey(`dash.github.rc.step.${s}`)}
          </Chip>
        );
      })}
    </span>
  );
}

interface PrExtra {
  rc: RcInfo | null;
  bot: BotEntry[];
  threads?: ThreadsInfo;
}

function BotCard({ entries }: { entries: readonly BotEntry[] }) {
  const count = entries.reduce((n, e) => n + e.lines.length, 0);
  return (
    <section className="gh-pr-card">
      <details className="gh-bot">
        <summary>
          <h4>{tKey('dash.github.bot.title', { n: count })}</h4>
        </summary>
        {entries.map((e, i) => {
          const t = Date.parse(e.updatedAt);
          return (
            <div key={i} className="gh-bot-entry">
              <div className="gh-pr-line">
                <strong>{e.source}</strong>
                {!Number.isNaN(t) && <span className="muted" title={new Date(t).toLocaleString()}>{relTime(t)}</span>}
                {safeHttpUrl(e.url) && <IconButton icon="link" label={tKey('dash.github.bot.open')} onClick={() => window.open(safeHttpUrl(e.url),'_blank', 'noreferrer')} />}
              </div>
              <ul className="gh-bot-lines">{e.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
            </div>
          );
        })}
      </details>
    </section>
  );
}

const THREAD_CHARS = 240;

function ThreadsCard({ pr, info }: { pr: PrItem; info: ThreadsInfo | undefined }) {
  return (
    <Card title={tKey('dash.github.pr.unresolved', { n: pr.threads })}>
      {!info ? (
        <span className="muted">{tKey('dash.github.rc.loading')}</span>
      ) : (
        <>
          {info.items.map((t, i) => {
            const at = Date.parse(t.createdAt);
            const long = t.body.length > THREAD_CHARS;
            const link = safeHttpUrl(t.url);
            return (
              <div key={i} className="gh-thread">
                <div className="gh-pr-line">
                  <strong>{t.author}</strong>
                  {t.copilot && <Chip tone="info">{tKey('dash.github.thread.copilot')}</Chip>}
                  {t.outdated && <Chip tone="neutral" title={tKey('dash.github.thread.outdatedHint')}>{tKey('dash.github.thread.outdated')}</Chip>}
                  {!Number.isNaN(at) && <span className="muted" title={new Date(at).toLocaleString()}>{relTime(at)}</span>}
                  {t.path && <IconButton icon="copy" label={tKey('dash.github.thread.copyPath')} onClick={() => void copyNotify(`${t.path.split('/').pop()}${t.line ? `:${t.line}` : ''}`)} />}
                  {link && <IconButton icon="link" label={tKey('dash.github.thread.open')} onClick={() => window.open(link, '_blank', 'noreferrer')} />}
                </div>
                {t.path && <code className="gh-thread-path">{t.path}{t.line ? `:${t.line}` : ''}</code>}
                {long ? (
                  <details className="gh-thread-body">
                    <summary>{t.body.slice(0, THREAD_CHARS).trimEnd()}…</summary>
                    <div>{t.body}</div>
                  </details>
                ) : (
                  <div className="gh-thread-body">{t.body}</div>
                )}
                {t.replies > 0 && <span className="muted">{tKey('dash.github.thread.replies', { n: t.replies, who: t.lastReplier })}</span>}
              </div>
            );
          })}
          {info.more > 0 && <span className="muted">{tKey('dash.github.thread.more', { n: info.more })}</span>}
        </>
      )}
    </Card>
  );
}

function RcCard({ state }: { state: { data: PrExtra | undefined; error?: { message: string } | null } }) {
  const info = state.data?.rc;
  const { latest, lastGood } = latestRc(info?.modules ?? []);
  return (
    <Card title={tKey('dash.github.rc.title')}>
      {state.error && !info ? (
        <span className="gh-error">{state.error.message}</span>
      ) : info === undefined ? (
        <span className="muted">{tKey('dash.github.rc.loading')}</span>
      ) : !info || !latest ? (
        <span className="muted">{tKey('dash.github.rc.none')}</span>
      ) : (
        <>
          <div className="gh-pr-line">
            {latest.failed || !latest.version ? (
              <Chip tone="danger">{tKey('dash.github.rc.failed')}</Chip>
            ) : (
              <>
                <code>{latest.version}</code>
                <IconButton icon="copy" label={tKey('dash.github.rc.copy')} onClick={() => void copyNotify(latest.version ?? '')} />
              </>
            )}
            <BuildDate date={latest.date} />
            {safeHttpUrl(latest.npmUrl) && <IconButton icon="link" label={tKey('dash.github.rc.npm')} onClick={() => window.open(safeHttpUrl(latest.npmUrl),'_blank', 'noreferrer')} />}
          </div>
          <Steps build={latest} />
          {latest.failed && lastGood && <div className="gh-pr-line">{tKey('dash.github.rc.lastGood', { version: lastGood })}</div>}
          {info.modules.map((m) => (
            <details key={m.name} className="gh-rc-builds">
              <summary>{m.name} · {tKey('dash.github.rc.all', { n: m.builds.length })}</summary>
              {[...m.builds].reverse().map((b, i) => (
                <div key={i} className="gh-check">
                  <div className="gh-pr-line">
                    {b.failed || !b.version ? <Chip tone="danger">{tKey('dash.github.rc.failed')}</Chip> : <code>{b.version}</code>}
                    <BuildDate date={b.date} />
                  </div>
                  <Steps build={b} />
                </div>
              ))}
            </details>
          ))}
          {info.warnings.length > 0 && <div className="gh-rc-warn">{info.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
        </>
      )}
    </Card>
  );
}

interface ExtraSource {
  source: string;
  action: string;
}

const PRS_EXTRA: ExtraSource = { source: 'github-prs', action: 'rc' };
const PRS_ONE: ExtraSource = { source: 'github-prs', action: 'pr' };

interface Live {
  fresh?: PrItem;
  busy: boolean;
  failed: string;
  tick: number;
}

const IDLE: Live = { busy: false, failed: '', tick: 0 };
const lives = new Map<string, Live>();
const listeners = new Set<() => void>();
interface PrRef {
  repo: string;
  number: number;
}
const liveKey = (pr: PrRef) => `${pr.repo}#${pr.number}`;
const setLive = (key: string, patch: Partial<Live>) => {
  lives.set(key, { ...(lives.get(key) ?? IDLE), ...patch });
  listeners.forEach((l) => l());
};

function useLive(key: string): Live {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => lives.get(key) ?? IDLE,
  );
}

function refreshPr(listed: PrRef, config: Record<string, unknown>, source: ExtraSource) {
  const key = liveKey(listed);
  setLive(key, { busy: true, failed: '', tick: (lives.get(key)?.tick ?? 0) + 1 });
  runAction<PrItem>(source.source, source.action, config, { repo: listed.repo, number: listed.number })
    .then((item) => setLive(key, { fresh: item, busy: false }))
    .catch((e: unknown) => setLive(key, { busy: false, failed: e instanceof Error ? e.message : String(e) }));
}

function RefreshButton({ pr, config, source }: { pr: PrRef; config: Record<string, unknown>; source: ExtraSource }) {
  const live = useLive(liveKey(pr));
  return <IconButton icon="refresh" label={tKey(live.busy ? 'dash.github.pr.refreshing' : 'dash.github.pr.refresh')} disabled={live.busy} onClick={() => refreshPr(pr, config, source)} />;
}

function PrOverview({ pr: listed, config, extraSource = PRS_EXTRA }: { pr: PrItem; config: Record<string, unknown>; extraSource?: ExtraSource }) {
  const live = useLive(liveKey(listed));
  const pr = live.fresh && live.fresh.updatedAt >= listed.updatedAt ? { ...live.fresh, linked: listed.linked } : listed;
  const c = pr.checks;
  const extra = useAsync(() => runAction<PrExtra>(extraSource.source, extraSource.action, config, { repo: pr.repo, number: pr.number }), [pr.id, live.tick]);
  return (
    <div className="gh-pr">
      {live.failed && <span className="gh-error">{live.failed}</span>}
      <Card title={tKey('dash.github.pr.status')}>
        <Line label={tKey('dash.github.pr.review')}>
          {pr.review === 'none' ? <span>{tKey('dash.github.pr.noReview')}</span> : <Chip tone={REVIEW_TONE[pr.review]}>{tKey(`dash.github.review.${pr.review}`)}</Chip>}
        </Line>
        <Line label={tKey('dash.github.pr.conflicts')}>
          {pr.conflicts ? <Chip tone="danger">{tKey('dash.github.conflicts')}</Chip> : <span>{tKey('dash.github.pr.noConflicts')}</span>}
        </Line>
        <Line label={tKey('dash.github.pr.draft')}>
          <span>{pr.draft ? tKey('dash.github.pr.draft') : tKey('dash.github.pr.ready')}</span>
        </Line>
        {pr.autoMerge && <Chip tone="info">{tKey('dash.github.pr.autoMerge')}</Chip>}
        <Line label={tKey('dash.github.pr.comments')}>
          <span>{pr.comments}</span>
        </Line>
        <Line label={tKey('dash.github.pr.threads')} title={tKey('dash.github.pr.threadsHint')}>
          <span>{pr.threads}</span>
        </Line>
      </Card>
      {pr.threads > 0 && <ThreadsCard pr={pr} info={extra.data?.threads} />}
      <Card title={tKey('dash.github.pr.checks')}>
        {pr.ci === 'none' ? (
          <span>{tKey('dash.github.pr.noChecks')}</span>
        ) : (
          <div className="gh-pr-line">
            <Chip tone={CI_TONE[pr.ci]}>{tKey(`dash.github.ci.${pr.ci}`)} {c.passed}/{c.total}</Chip>
            <span>{tKey('dash.github.pr.checkCounts', { passed: c.passed, failed: c.failed, pending: c.pending })}</span>
          </div>
        )}
        <CheckGroups list={pr.checkList} approvals={pr.approvals} />
      </Card>
      {hasRcLabel(pr.labels, config.rcLabel) && <RcCard state={extra} />}
      <Card title={tKey('dash.github.pr.branch')}>
        <div className="gh-pr-line"><code>{pr.branch}</code><span>{'→'}</span><code>{pr.base}</code></div>
      </Card>
      <Card title={tKey('dash.github.pr.size')}>
        <div className="gh-pr-line">
          <span className="gh-pr-add">+{pr.additions}</span>
          <span className="gh-pr-del">{'−'}{pr.deletions}</span>
          <span className="muted">{tKey('dash.github.pr.files', { n: pr.files })}</span>
        </div>
      </Card>
      <Card title={tKey('dash.github.pr.dates')}>
        <Line label={tKey('dash.github.pr.created')}><span>{when(pr.createdAt)}</span></Line>
        <Line label={tKey('dash.github.pr.updated')}><span>{when(pr.updatedAt)}</span></Line>
      </Card>
      {pr.labels.length > 0 && (
        <Card title={tKey('dash.github.pr.labels')}>
          <span className="gh-chips">{pr.labels.map((l) => <Chip key={l}>{l}</Chip>)}</span>
        </Card>
      )}
      <Card title={tKey('dash.github.pr.ticket')}>
        <div className="gh-pr-line">
          {pr.ticket && <Chip tone="info">{pr.ticket}</Chip>}
          {!pr.linked && (
            <Chip tone="warn" title={pr.ticket ? tKey('dash.github.noTicket.notOnBoard', { key: pr.ticket }) : tKey('dash.github.noTicket.noKey')}>
              {tKey('dash.github.noTicket')}
            </Chip>
          )}
        </div>
      </Card>
      {extra.data && extra.data.bot.length > 0 && <BotCard entries={extra.data.bot} />}
    </div>
  );
}

function FetchedPr({ pr, config }: { pr: TrackedPr; config: Record<string, unknown> }) {
  const repo = `${pr.owner}/${pr.repo}`;
  const item = useAsync(() => runAction<PrItem>('tickets', 'pr', config, { repo, number: pr.number }), [pr.url]);
  if (item.data) return <PrOverview pr={item.data} config={config} extraSource={{ source: 'tickets', action: 'pr-extra' }} />;
  return (
    <div className="gh-pr">
      {item.error ? <span className="gh-error">{item.error.message}</span> : <span className="muted">{tKey('dash.github.rc.loading')}</span>}
    </div>
  );
}

/** The PR side panel for a PR a ticket links to: the details load when it opens. */
export function trackedPrSideContent({ instanceId, pr, config }: { instanceId: string; pr: TrackedPr; config: Record<string, unknown> }): SidePanelContent {
  return {
    id: `${instanceId}:${pr.url}`,
    title: `#${pr.number} ${pr.title}`,
    subtitle: `${pr.owner}/${pr.repo}`,
    icon: 'link',
    tabs: [{ id: 'overview', label: tKey('dash.github.pr.tab.overview'), render: () => <FetchedPr pr={pr} config={config} /> }],
    actions: (
      <>
        <IconButton icon="link" label={tKey('dash.github.pr.open')} onClick={() => window.open(pr.url, '_blank', 'noreferrer')} />
        <RefreshButton pr={{ repo: `${pr.owner}/${pr.repo}`, number: pr.number }} config={config} source={{ source: 'tickets', action: 'pr' }} />
        <IconButton icon="copy" label={tKey('dash.github.pr.copyLink')} onClick={() => void copyNotify(pr.url)} />
        <IconButton icon="copy" label={tKey('dash.github.pr.copyBranch')} onClick={() => void copyNotify(pr.branch)} />
      </>
    ),
  };
}

/** What the Pull Requests panel opens in the Dashboard side panel for one PR. */
export function prSideContent({ instanceId, pr, config }: PrSideInput): SidePanelContent {
  return {
    id: `${instanceId}:${pr.id}`,
    title: `#${pr.number} ${pr.title}`,
    subtitle: pr.repo,
    icon: 'link',
    tabs: [{ id: 'overview', label: tKey('dash.github.pr.tab.overview'), render: () => <PrOverview pr={pr} config={config} /> }],
    actions: (
      <>
        <IconButton icon="link" label={tKey('dash.github.pr.open')} onClick={() => window.open(pr.url, '_blank', 'noreferrer')} />
        <RefreshButton pr={pr} config={config} source={PRS_ONE} />
        <IconButton icon="copy" label={tKey('dash.github.pr.copyLink')} onClick={() => void copyNotify(pr.url)} />
        <IconButton icon="copy" label={tKey('dash.github.pr.copyBranch')} onClick={() => void copyNotify(pr.branch)} />
      </>
    ),
  };
}
