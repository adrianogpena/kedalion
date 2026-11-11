import { copyNotify } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip, ListRows, relTime, type ListRow } from '../../kit';
import './jira.css';
import { boardLanes, groupIssues, type GroupBy, type JiraIssue } from './map';
import type { IssuesData } from './server';
import { Card } from './SprintBoard';

export interface IssuesConfig {
  columns: string[];
  groupBy: GroupBy;
  view: 'list' | 'board';
  [key: string]: unknown;
}

const has = (config: IssuesConfig, column: string): boolean => config.columns.includes(column);

/** The chosen columns of an issue as meta parts (status is the chip). */
export function metaOf(issue: JiraIssue, config: IssuesConfig, now: number = Date.now()): string[] {
  const parts: (string | false)[] = [
    has(config, 'type') && issue.type,
    has(config, 'priority') && issue.priority,
    has(config, 'assignee') && issue.assignee,
    has(config, 'reporter') && issue.reporter,
    has(config, 'sprint') && issue.sprint,
    has(config, 'updated') && !!issue.updated && relTime(issue.updated, now),
    has(config, 'due') && !!issue.due && tKey('dash.jira.due', { date: issue.due.slice(0, 10) }),
  ];
  return parts.filter((p): p is string => !!p);
}

const rowOf = (issue: JiraIssue, config: IssuesConfig): ListRow => ({
  id: issue.key,
  title: `${issue.key}  ${issue.summary}`,
  href: issue.url,
  chip: <Chip tone={issue.tone}>{issue.status}</Chip>,
  meta: metaOf(issue, config),
  menu: () => [
    { id: 'open', label: tKey('dash.jira.open'), icon: 'link', run: () => window.open(issue.url, '_blank', 'noreferrer') },
    'sep',
    { id: 'copy-key', label: tKey('dash.jira.copyKey'), icon: 'copy', run: () => void copyNotify(issue.key) },
    { id: 'copy-link', label: tKey('dash.jira.copyLink'), icon: 'copy', run: () => void copyNotify(issue.url) },
  ],
});

function Board({ issues, config }: { issues: readonly JiraIssue[]; config: IssuesConfig }) {
  const lanes = boardLanes(issues, config.groupBy);
  return (
    <div className="jira-lanes jira-board" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(160px, 1fr))` }}>
      {lanes.map((lane) => (
        <section key={lane.key || '-'} className="jira-lane">
          <h4 className="jira-group-title">{lane.key || tKey('dash.jira.none')} <span className="muted">{lane.issues.length}</span></h4>
          <ul className="jira-cards">
            {lane.issues.map((i) => (
              <Card key={i.key} issue={i} extra={metaOf(i, config)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function IssuesPanel({ config, data }: { config: IssuesConfig; data: IssuesData | undefined }) {
  const issues = data?.issues ?? [];
  if (config.view === 'board' && issues.length > 0) {
    return (
      <div className="jira">
        <div className="jira-head">{tKey(issues.length === 1 ? 'dash.jira.count.one' : 'dash.jira.count.other', { n: issues.length })}</div>
        <Board issues={issues} config={config} />
      </div>
    );
  }
  const groups = groupIssues(issues, config.groupBy);
  return (
    <div className="jira">
      <div className="jira-head">{tKey(issues.length === 1 ? 'dash.jira.count.one' : 'dash.jira.count.other', { n: issues.length })}</div>
      <div className="jira-body">
        {config.groupBy === 'none' ? (
          <ListRows rows={issues.map((i) => rowOf(i, config))} empty={tKey('dash.jira.empty')} />
        ) : issues.length === 0 ? (
          <ListRows rows={[]} empty={tKey('dash.jira.empty')} />
        ) : (
          groups.map((g) => (
            <section key={g.key || '-'} className="jira-group">
              <h4 className="jira-group-title">{g.key || tKey('dash.jira.none')} <span className="muted">{g.issues.length}</span></h4>
              <ListRows rows={g.issues.map((i) => rowOf(i, config))} empty="" />
            </section>
          ))
        )}
      </div>
    </div>
  );
}
