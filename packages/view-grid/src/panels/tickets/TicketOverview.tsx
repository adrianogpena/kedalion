import { Fragment, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button, ContextMenu, copyNotify, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import { runAction } from '../../source';
import type { TrackedPr } from '../github/tracked';
import type { Pod } from '../pods/model';
import { AdfView } from './AdfView';
import { formatDuration, isOverdue, type JiraInfo } from './jira-info';
import { normPodId, parsePcr, podId, workloadName, type Ticket } from './model';
import { showTicketsNow } from './TicketsPanel';
import type { TicketLink } from './types';
import './tickets.css';

const REVIEW: Record<string, string> = {
  APPROVED: 'dash.tickets.pipeline.approved',
  CHANGES_REQUESTED: 'dash.tickets.pipeline.changes',
  REVIEW_REQUIRED: 'dash.tickets.pipeline.review',
};

export function prLine(pr: TrackedPr): string {
  const checks = tKey('dash.tickets.pipeline.checks', { passed: pr.checks.passed, total: pr.checks.total });
  const review = pr.reviewDecision ? tKey(REVIEW[pr.reviewDecision] as 'dash.tickets.pipeline.approved') : tKey('dash.tickets.pipeline.noReview');
  return `${pr.repo}#${pr.number} · ${checks} · ${review}`;
}

const stateLabel = (pr: TrackedPr) =>
  pr.draft ? tKey('dash.tickets.detail.draft') : tKey(`dash.tickets.pipeline.${pr.state}` as 'dash.tickets.pipeline.merged');

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const stateTone = (pr: TrackedPr): Tone => (pr.draft ? 'neutral' : pr.state === 'merged' ? 'ok' : pr.state === 'open' ? 'info' : 'neutral');
const checksTone = (pr: TrackedPr): Tone => ({ passed: 'ok', failed: 'danger', pending: 'warn', none: 'neutral' })[pr.checks.state] as Tone;
const reviewTone = (pr: TrackedPr): Tone => (pr.reviewDecision === 'APPROVED' ? 'ok' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'danger' : pr.reviewDecision ? 'warn' : 'neutral');

/** The one tone that says whether the PR needs attention: red when blocked, amber when waiting, green when good. */
function attention(pr: TrackedPr): Tone {
  if (pr.state === 'merged') return 'ok';
  if (pr.state === 'closed') return 'neutral';
  if (checksTone(pr) === 'danger' || reviewTone(pr) === 'danger') return 'danger';
  if (pr.draft || checksTone(pr) === 'warn' || reviewTone(pr) === 'warn') return 'warn';
  return checksTone(pr) === 'ok' && reviewTone(pr) === 'ok' ? 'ok' : 'neutral';
}

/** One PR as a card: a status stripe and state/checks/review chips; a click opens the PR side panel over this one. */
function PrCard({ pr, onOpen }: { pr: TrackedPr; onOpen(pr: TrackedPr): void }) {
  const review = pr.reviewDecision ? tKey(REVIEW[pr.reviewDecision] as 'dash.tickets.pipeline.approved') : tKey('dash.tickets.pipeline.noReview');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={`tickets-card tickets-pr-card tickets-pr-${attention(pr)}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {menu && (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { id: 'open', label: tKey('dash.tickets.ctx.open'), icon: 'link', run: () => onOpen(pr) },
            { id: 'copy', label: tKey('dash.tickets.ctx.copyPrLink'), icon: 'copy', run: () => void copyNotify(pr.url) },
          ]}
        />
      )}
      <button type="button" className="tickets-card-edit" onClick={() => onOpen(pr)}>
        <strong>
          {pr.repo}#{pr.number}
        </strong>{' '}
        {pr.title}
        <span className="tickets-pr-chips">
          <Chip tone={stateTone(pr)}>{stateLabel(pr)}</Chip>
          <Chip tone={checksTone(pr)}>{tKey('dash.tickets.pipeline.checks', { passed: pr.checks.passed, total: pr.checks.total })}</Chip>
          <Chip tone={reviewTone(pr)}>{review}</Chip>
        </span>
      </button>
    </div>
  );
}

interface Props {
  ticket: Ticket;
  link?: TicketLink;
  jira?: JiraInfo;
  allPods: Pod[];
  config: Record<string, unknown>;
  onChanged(): void;
  onOpenPr(pr: TrackedPr): void;
  onOpenPod(pod: Pod): void;
}

/** The ticket in the Dashboard side panel: description, linked PRs and pods (link or unlink pods by hand). */
export function TicketOverview({ ticket, link, jira, allPods, config, onChanged, onOpenPr, onOpenPod }: Props) {
  const [description, setDescription] = useState(ticket.description);
  const [manual, setManual] = useState<string[]>(link?.manualPods ?? ticket.podLinks ?? []);
  const [choice, setChoice] = useState('');
  const [editing, setEditing] = useState(false);
  const [pcr, setPcr] = useState(ticket.pcr ?? '');
  const [editingPcr, setEditingPcr] = useState(false);
  const [error, setError] = useState('');
  const [podMenu, setPodMenu] = useState<{ at: { x: number; y: number }; items: ComponentProps<typeof ContextMenu>['items'] } | null>(null);
  const [showComment, setShowComment] = useState(false);
  const none = <p className="tickets-detail-none">{tKey('dash.tickets.detail.none')}</p>;

  const fromServer = new Set((link?.manualPods ?? []).map(normPodId));
  const auto = (link?.pods ?? []).filter((p) => !fromServer.has(podId(p)));
  const everyPod = [...new Map([...(link?.pods ?? []), ...allPods].map((p) => [`${p.cluster}/${p.name}`, p])).values()];
  const manualIds = new Set(manual.map(normPodId));
  const manualPods = everyPod.filter((p) => manualIds.has(podId(p)));
  const shown = new Set([...auto, ...manualPods].map(podId));
  const candidates = [...new Map(allPods.filter((p) => !shown.has(podId(p))).map((p) => [podId(p), p])).values()];

  const latest = useRef({ description, pcr });
  latest.current = { description, pcr };
  const saved = useRef({ description: ticket.description, pcr: ticket.pcr ?? '' });

  const saveDescription = async () => {
    const value = latest.current.description;
    if (value === saved.current.description) return;
    saved.current.description = value;
    try {
      showTicketsNow(await runAction<Ticket[]>('tickets', 'update', config, { id: ticket.id, description: value }));
      setError('');
    } catch (err) {
      saved.current.description = ticket.description;
      setError(String((err as Error)?.message ?? err));
    }
    onChanged();
  };

  const savePcr = async () => {
    const value = parsePcr(latest.current.pcr);
    setPcr(value);
    if (value === saved.current.pcr) return;
    saved.current.pcr = value;
    try {
      showTicketsNow(await runAction<Ticket[]>('tickets', 'update', config, { id: ticket.id, pcr: value }));
      setError('');
    } catch (err) {
      saved.current.pcr = ticket.pcr ?? '';
      setError(String((err as Error)?.message ?? err));
    }
    onChanged();
  };

  useEffect(
    () => () => {
      void saveDescription();
      void savePcr();
    },
    [],
  );

  const setLinked = async (pod: string, linked: boolean) => {
    const before = manual;
    const rest = manual.filter((x) => normPodId(x) !== pod);
    setManual(linked ? [...rest, pod] : rest);
    try {
      await runAction('tickets', 'link-pod', config, { id: ticket.id, pod, linked });
      setError('');
    } catch (err) {
      setManual(before);
      setError(String((err as Error)?.message ?? err));
    }
    onChanged();
  };

  const podRow = (p: Pod, byHand: boolean) => (
    <div
      key={podId(p)}
      className="tickets-detail-pod tickets-ov-pod"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPodMenu({
          at: { x: e.clientX, y: e.clientY },
          items: [
            { id: 'open', label: tKey('dash.tickets.ctx.open'), icon: 'link', run: () => onOpenPod(p) },
            { id: 'copy', label: tKey('dash.tickets.ctx.copyPod'), icon: 'copy', run: () => void copyNotify(p.name) },
            ...(byHand ? [{ id: 'unlink', label: tKey('dash.tickets.detail.unlinkPod'), icon: 'close' as const, run: () => void setLinked(podId(p), false) }] : []),
          ],
        });
      }}
    >
      <Button className="tickets-detail-podname" onClick={() => onOpenPod(p)}>
        {workloadName(p.name)} · {p.status} · {tKey('dash.tickets.pipeline.restarts', { n: p.restarts })}
      </Button>
      {byHand && (
        <Button onClick={() => void setLinked(podId(p), false)}>
          <Icon name="close" size={12} /> {tKey('dash.tickets.detail.unlinkPod')}
        </Button>
      )}
    </div>
  );

  const estimation = jira
    ? [
        jira.points !== null && tKey('dash.tickets.detail.estPoints', { n: jira.points }),
        jira.originalEstimate !== null && tKey('dash.tickets.detail.estOriginal', { t: formatDuration(jira.originalEstimate) }),
        jira.remainingEstimate !== null && tKey('dash.tickets.detail.estRemaining', { t: formatDuration(jira.remainingEstimate) }),
        jira.timeSpent !== null && tKey('dash.tickets.detail.estSpent', { t: formatDuration(jira.timeSpent) }),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const date = (iso: string) => new Date(iso).toLocaleDateString();
  const details: [string, ReactNode][] = jira
    ? [
        [tKey('dash.tickets.detail.type'), jira.type],
        [tKey('dash.tickets.detail.parent'), jira.parent],
        [tKey('dash.tickets.detail.estimation'), estimation],
        [tKey('dash.tickets.detail.fixVersions'), jira.fixVersions.join(', ')],
        [tKey('dash.tickets.detail.labels'), jira.labels.join(', ')],
        [tKey('dash.tickets.detail.due'), jira.due && <span className={isOverdue(jira.due, jira.tone) ? 'tickets-overdue' : undefined}>{date(jira.due)}</span>],
        [tKey('dash.tickets.detail.updated'), jira.updated && date(jira.updated)],
      ]
    : [];
  const shownDetails = details.filter(([, v]) => v);
  const projects = [...new Set((link?.prs ?? []).map((pr) => pr.repo))];

  return (
    <div className="tickets-ov">
      {podMenu && <ContextMenu at={podMenu.at} items={podMenu.items} onClose={() => setPodMenu(null)} />}
      {error && <div className="tickets-error" role="alert">{error}</div>}
      <div className="tickets-ov-top">
        <div className="tickets-card tickets-ov-small">
          <h4>{tKey('dash.tickets.detail.status')}</h4>
          <p>{jira?.status ? <Chip tone={jira.tone}>{jira.status}</Chip> : <span className="tickets-detail-dim">{tKey('dash.tickets.detail.jiraStatusNone')}</span>}</p>
        </div>
        {jira?.priority && (
          <div className="tickets-card tickets-ov-small">
            <h4>{tKey('dash.tickets.detail.priority')}</h4>
            <p>{jira.priority}</p>
          </div>
        )}
        <div className="tickets-card tickets-ov-small">
          <h4>{tKey('dash.tickets.detail.pcr')}</h4>
          {editingPcr ? (
            <input
              className="tickets-edit tickets-ov-pcr"
              autoFocus
              value={pcr}
              placeholder="163"
              aria-label={tKey('dash.tickets.editPcr')}
              onChange={(e) => setPcr(e.target.value)}
              onBlur={() => {
                setEditingPcr(false);
                void savePcr();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                e.currentTarget.blur();
              }}
            />
          ) : (
            <button type="button" className="tickets-card-edit" aria-label={tKey('dash.tickets.editPcr')} onClick={() => setEditingPcr(true)}>
              {pcr ? `#${pcr}` : <span className="tickets-detail-dim">{tKey('dash.tickets.noPcr')}</span>}
            </button>
          )}
        </div>
        {jira?.assignee && (
          <div className="tickets-card tickets-ov-small">
            <h4>{tKey('dash.tickets.detail.assignee')}</h4>
            <p>{jira.assignee}</p>
          </div>
        )}
        <div className="tickets-card tickets-ov-wide">
          <h4>{tKey('dash.tickets.detail.description')}</h4>
          {editing ? (
            <textarea
              className="tickets-edit"
              rows={4}
              autoFocus
              value={description}
              placeholder={tKey('dash.tickets.noDescription')}
              aria-label={tKey('dash.tickets.editDescription')}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                setEditing(false);
                void saveDescription();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                e.currentTarget.blur();
              }}
            />
          ) : (
            <button type="button" className="tickets-card-edit" aria-label={tKey('dash.tickets.editDescription')} onClick={() => setEditing(true)}>
              {description || <span className="tickets-detail-dim">{tKey('dash.tickets.noDescription')}</span>}
            </button>
          )}
        </div>
      </div>
      {shownDetails.length > 0 && (
        <div className="tickets-card">
          <dl className="tickets-ov-details">
            {shownDetails.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      {jira && jira.links.length > 0 && (
        <section>
          <h4>{tKey('dash.tickets.detail.links')}</h4>
          {jira.links.map((l) => (
            <div key={`${l.label}-${l.key}`} className="tickets-card">
              <span className={l.blocker ? 'tickets-blocker' : 'tickets-detail-dim'}>{l.label}</span> <strong>{l.key}</strong> {l.summary}
              {l.status && <span className="tickets-detail-dim"> · {l.status}</span>}
            </div>
          ))}
        </section>
      )}
      {jira?.lastComment && (
        <section>
          <Button aria-expanded={showComment} onClick={() => setShowComment(!showComment)}>
            <Icon name="chevron" size={12} /> {tKey('dash.tickets.detail.lastComment')}
          </Button>
          {showComment && (
            <div className="tickets-card">
              <span className="tickets-detail-dim">
                {jira.lastComment.author} · {date(jira.lastComment.created)}
              </span>
              <AdfView body={jira.lastComment.body} />
            </div>
          )}
        </section>
      )}
      <section>
        <h4>{tKey('dash.tickets.detail.projects')}</h4>
        {projects.length ? <div className="tickets-ov-projects">{projects.map((r) => <Chip key={r}>{r}</Chip>)}</div> : none}
      </section>
      <section>
        <h4>{tKey('dash.tickets.detail.prs')}</h4>
        {link && link.prs.length > 1 && (
          <p className="tickets-detail-dim">
            {tKey('dash.tickets.detail.prsSummary', {
              open: link.prs.filter((p) => p.state === 'open').length,
              merged: link.prs.filter((p) => p.state === 'merged').length,
              closed: link.prs.filter((p) => p.state === 'closed').length,
            })}
          </p>
        )}
        {link?.prs.length ? link.prs.map((pr) => <PrCard key={pr.url} pr={pr} onOpen={onOpenPr} />) : none}
      </section>
      <section>
        <h4>{tKey('dash.tickets.detail.pods')}</h4>
        {auto.length + manualPods.length === 0 && none}
        {auto.map((p) => podRow(p, false))}
        {manualPods.map((p) => podRow(p, true))}
        {candidates.length > 0 && (
          <div className="tickets-ov-add">
            <select value={choice} aria-label={tKey('dash.tickets.detail.linkPod')} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{tKey('dash.tickets.detail.linkPod')}</option>
              {candidates.map((p) => (
                <option key={podId(p)} value={podId(p)}>
                  {workloadName(p.name)} ({p.cluster})
                </option>
              ))}
            </select>
            <Button
              disabled={!choice}
              onClick={() => {
                void setLinked(choice, true);
                setChoice('');
              }}
            >
              <Icon name="plus" size={12} /> {tKey('dash.tickets.detail.link')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
