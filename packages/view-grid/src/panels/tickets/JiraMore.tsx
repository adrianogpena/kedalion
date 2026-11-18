import { useState, type ReactNode } from 'react';
import { Button, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import { formatAge, type JiraInfo } from './jira-info';

const date = (iso: string) => new Date(iso).toLocaleDateString();

/** The Jira detail rows both side panels show after the common ones: reporter, sprint, components and time in the current status. */
export function jiraExtraRows(jira: JiraInfo): [string, ReactNode][] {
  return [
    [tKey('dash.tickets.detail.reporter'), jira.reporter],
    [tKey('dash.tickets.detail.sprint'), jira.sprint],
    [tKey('dash.tickets.detail.components'), (jira.components ?? []).join(', ')],
    [tKey('dash.tickets.detail.statusSince'), jira.statusSince && `${formatAge(jira.statusSince)} · ${tKey('dash.tickets.detail.since', { date: date(jira.statusSince) })}`],
  ];
}

/** Subtasks and time logged of a Jira issue, as side-panel sections. */
export function JiraMore({ jira }: { jira: JiraInfo }) {
  const subtasks = jira.subtasks ?? [];
  const [expanded, setExpanded] = useState(false);
  const earlier = subtasks.slice(0, -1);
  const card = (t: JiraInfo['subtasks'][number]) => (
    <div key={t.key} className="tickets-card">
      <strong>{t.key}</strong> {t.summary} <Chip tone={t.tone}>{t.status}</Chip>
    </div>
  );
  return (
    <>
      {subtasks.length > 0 && (
        <section>
          <h4>{tKey('dash.tickets.detail.subtasks', { done: subtasks.filter((t) => t.tone === 'ok').length, total: subtasks.length })}</h4>
          {earlier.length > 0 && (
            <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              <Icon name="chevron" size={12} /> {tKey('dash.tickets.detail.subtasksEarlier', { n: earlier.length })}
            </Button>
          )}
          {expanded && earlier.map(card)}
          {card(subtasks[subtasks.length - 1]!)}
        </section>
      )}
    </>
  );
}
