import { Fragment, useState, type ReactNode } from 'react';
import { Button, copyNotify, Icon, IconButton, useAsync, validConfig, type SidePanelContent } from '@kedalion/ui';
import { dashboardItemOf } from '../../dashboard/items';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import { requestRefresh } from '../../panel';
import { runAction } from '../../source';
import { TICKETS_FIELDS } from '../tickets/fields';
import type { Ticket } from '../tickets/model';
import { showTicketsNow, type TicketsConfig } from '../tickets/TicketsPanel';
import { AdfView } from '../tickets/AdfView';
import { JiraMore, jiraExtraRows } from '../tickets/JiraMore';
import { formatAge, formatDuration, isOverdue, type JiraInfo } from '../tickets/jira-info';
import '../tickets/tickets.css';
import './jira.css';
import type { JiraIssue } from './map';

function AddToTickets({ issue }: { issue: JiraIssue }) {
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: string }>({ busy: false, done: false, error: '' });
  const item = dashboardItemOf('tickets');
  if (!item) return <span className="muted">{tKey('dash.jira.addTicket.noPanel')}</span>;
  const add = async () => {
    setState({ busy: true, done: false, error: '' });
    try {
      const config = validConfig(TICKETS_FIELDS, item.config) as TicketsConfig;
      showTicketsNow(await runAction<Ticket[]>('tickets', 'add', config, { key: issue.key }));
      setState({ busy: false, done: true, error: '' });
    } catch (err) {
      setState({ busy: false, done: false, error: String((err as Error)?.message ?? err) });
    } finally {
      requestRefresh('tickets');
    }
  };
  return (
    <div className="jira-side-add">
      <Button size="sm" disabled={state.busy || state.done} onClick={() => void add()}>
        {tKey(state.done ? 'dash.jira.addTicket.done' : 'dash.jira.addTicket')}
      </Button>
      {state.error && <span className="gh-error" role="alert">{state.error}</span>}
    </div>
  );
}

function IssueOverview({ issue, source, config }: { issue: JiraIssue; source: string; config: Record<string, unknown> }) {
  const info = useAsync(() => runAction<JiraInfo>(source, 'info', config, { key: issue.key }), [issue.key]);
  const [showComment, setShowComment] = useState(false);
  const jira = info.data;
  const date = (iso: string) => new Date(iso).toLocaleDateString();
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
  const details: [string, ReactNode][] = [
    [tKey('dash.tickets.detail.type'), jira?.type ?? issue.type],
    [tKey('dash.tickets.detail.parent'), jira?.parent],
    [tKey('dash.tickets.detail.estimation'), estimation],
    [tKey('dash.tickets.detail.fixVersions'), jira?.fixVersions.join(', ')],
    [tKey('dash.tickets.detail.labels'), jira?.labels.join(', ')],
    [tKey('dash.tickets.detail.due'), (jira?.due ?? issue.due) && <span className={isOverdue(jira?.due ?? issue.due, jira?.tone ?? issue.tone) ? 'tickets-overdue' : undefined}>{date(jira?.due ?? issue.due)}</span>],
    [tKey('dash.tickets.detail.updated'), (jira?.updated ?? issue.updated) && date(jira?.updated ?? issue.updated)],
    [tKey('dash.tickets.detail.age'), jira?.created && `${formatAge(jira.created)} · ${tKey('dash.tickets.detail.created', { date: date(jira.created) })}`],
    ...(jira ? jiraExtraRows(jira) : []),
  ];
  const shown = details.filter(([, v]) => v);
  const priority = jira?.priority ?? issue.priority;
  const assignee = jira?.assignee ?? issue.assignee;
  return (
    <div className="tickets-ov">
      {info.error && <div className="tickets-error" role="alert">{info.error.message}</div>}
      <div className="tickets-card">
        <h4>{issue.summary}</h4>
      </div>
      <div className="tickets-ov-top">
        <div className="tickets-card tickets-ov-small">
          <h4>{tKey('dash.tickets.detail.status')}</h4>
          <p><Chip tone={jira?.tone ?? issue.tone}>{jira?.status ?? issue.status}</Chip></p>
        </div>
        {priority && (
          <div className="tickets-card tickets-ov-small">
            <h4>{tKey('dash.tickets.detail.priority')}</h4>
            <p>{priority}</p>
          </div>
        )}
        {assignee && (
          <div className="tickets-card tickets-ov-small">
            <h4>{tKey('dash.tickets.detail.assignee')}</h4>
            <p>{assignee}</p>
          </div>
        )}
      </div>
      <div className="tickets-card">
        <h4>{tKey('dash.tickets.detail.description')}</h4>
        {!jira ? <span className="muted">{tKey('dash.github.rc.loading')}</span> : jira.description ? <AdfView body={jira.description} /> : <p className="tickets-detail-none">{tKey('dash.tickets.noDescription')}</p>}
      </div>
      {shown.length > 0 && (
        <div className="tickets-card">
          <dl className="tickets-ov-details">
            {shown.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      {jira && <JiraMore jira={jira} />}
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
      <section className="tickets-card">
        <AddToTickets issue={issue} />
      </section>
    </div>
  );
}

/** What the Jira panels open in the Dashboard side panel for one issue. */
export function issueSideContent({ instanceId, issue, source, config }: { instanceId: string; issue: JiraIssue; source: string; config: Record<string, unknown> }): SidePanelContent {
  return {
    id: `${instanceId}:${issue.key}`,
    title: issue.key,
    subtitle: issue.status,
    icon: 'log',
    tabs: [{ id: 'overview', label: tKey('dash.pods.tab.overview'), render: () => <IssueOverview issue={issue} source={source} config={config} /> }],
    actions: (
      <>
        <IconButton icon="copy" label={tKey('dash.jira.copyKey')} onClick={() => void copyNotify(issue.key)} />
        <IconButton icon="link" label={tKey('dash.jira.open')} onClick={() => window.open(issue.url, '_blank', 'noreferrer')} />
      </>
    ),
  };
}
