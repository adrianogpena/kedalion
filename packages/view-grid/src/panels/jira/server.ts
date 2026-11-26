import { invalid } from '@kedalion/server-core';
import { notifyChanges, notifyScope } from '../../notify-changes';
import { defineSource, SourceError, type DataSource, type GridPanelSpec, type SourceContext } from '../../server';
import { agile, count, fieldIds, search } from './client';
import { BOARD_FIELDS, COUNT_FIELDS, fields, ISSUES_FIELDS } from './fields';
import { infoFields, mapInfo, type JiraInfo } from '../tickets/jira-info';
import { breakdown, mapIssue, mapSprint, requestFields, type JiraIssue, type SprintData, type Slice } from './map';

export interface IssuesData {
  issues: JiraIssue[];
}

export interface CountData {
  total: number;
  slices: Slice[];
  /** How many issues the slices count when that is fewer than `total` (breakdown capped at `BREAKDOWN_CAP`). */
  sampled?: number;
}

/** Most issues read for a Count breakdown (10 pages of 100). */
const BREAKDOWN_CAP = 1000;
/** Most issues read for a sprint board (pages of 100). */
const SPRINT_CAP = 1000;

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** The `info` action of the panels that list issues: one issue's full detail. */
async function issueInfo(payload: unknown, _config: object, ctx: SourceContext): Promise<JiraInfo> {
  const key = String(((payload ?? {}) as Record<string, unknown>).key ?? '');
  if (!KEY_RE.test(key)) throw invalid('jira-invalid-key', 'Not an issue key.');
  const conn = await ctx.connection('jira');
  const ids = await fieldIds(conn, ctx.signal);
  const [raw] = await search(conn, `key = ${key}`, infoFields(ids.points, ids.sprint), 1, ctx.signal);
  if (!raw) throw invalid('jira-issue-not-found', 'The issue was not found.', { key });
  return mapInfo(raw, ids.points, ids.sprint);
}

const issuesSource = defineSource<{ jql: string; max: number; columns: string[]; notify: boolean }>({
  id: 'jira-issues',
  fields: ISSUES_FIELDS,
  actions: { info: issueInfo },
  async fetch({ jql, max, columns, notify }, ctx): Promise<IssuesData> {
    const conn = await ctx.connection('jira');
    const ids = columns.includes('sprint') ? await fieldIds(conn, ctx.signal) : {};
    const raw = await search(conn, jql, requestFields(columns, ids), max, ctx.signal);
    const issues = raw.map((r) => mapIssue(r, conn.baseUrl, ids));
    if (notify !== false) {
      notifyChanges(ctx, notifyScope('jira-issues', { jql, max }), issues, {
        key: (i) => i.key,
        sig: (i) => `${i.status}|${i.assignee}`,
        title: 'Jira issues',
        line: (i) => `${i.key}: ${i.summary} (${i.status})`,
      });
    }
    return { issues };
  },
});

const countSource = defineSource<{ jql: string; display: string; notify: boolean }>({
  id: 'jira-count',
  fields: COUNT_FIELDS,
  async fetch({ jql, display, notify }, ctx): Promise<CountData> {
    const conn = await ctx.connection('jira');
    const total = await count(conn, jql, ctx.signal);
    if (notify === true) {
      notifyChanges(ctx, notifyScope('jira-count', { jql }), [total], {
        key: () => 'count',
        sig: (n) => String(n),
        title: 'Jira count',
        line: (n) => `Count: ${n}`,
      });
    }
    if (display !== 'status' && display !== 'assignee' && display !== 'priority') return { total, slices: [] };
    const raw = await search(conn, jql, requestFields([display]), BREAKDOWN_CAP, ctx.signal);
    const slices = breakdown(raw.map((r) => mapIssue(r, conn.baseUrl)), display);
    return raw.length < total ? { total, slices, sampled: raw.length } : { total, slices };
  },
});

const sprintSource = defineSource<{ boardId: number; columns: string[]; notify: boolean }>({
  id: 'jira-sprint',
  fields: BOARD_FIELDS,
  actions: { info: issueInfo },
  async fetch({ boardId, columns, notify }, ctx): Promise<SprintData | null> {
    const conn = await ctx.connection('jira');
    if (!boardId) throw SourceError('not-configured', 'No board is set.');
    const sprints = await agile(conn, `/board/${boardId}/sprint?state=active`, ctx.signal);
    const sprint = (sprints.values ?? [])[0];
    if (!sprint) return null;
    const ids = await fieldIds(conn, ctx.signal);
    const wanted = requestFields(columns, ids);
    const raw: Record<string, any>[] = [];
    for (let startAt = 0; startAt < SPRINT_CAP; ) {
      const q = new URLSearchParams({ startAt: String(startAt), maxResults: '100', fields: wanted.join(',') });
      const res = await agile(conn, `/sprint/${sprint.id}/issue?${q}`, ctx.signal);
      const page = (res.issues ?? []) as Record<string, any>[];
      raw.push(...page);
      startAt += page.length;
      if (page.length === 0 || startAt >= Number(res.total ?? 0)) break;
    }
    const data = mapSprint(sprint, raw.map((r) => mapIssue(r, conn.baseUrl, ids)));
    if (notify !== false) {
      const column = (list: JiraIssue[], name: string) => list.map((issue) => ({ issue, column: name }));
      const placed = [...column(data.todo, 'To do'), ...column(data.doing, 'In progress'), ...column(data.finished, 'Done')];
      notifyChanges(ctx, notifyScope('jira-sprint', { boardId }), placed, {
        key: (p) => p.issue.key,
        sig: (p) => p.column,
        title: `Sprint ${data.name}`,
        line: (p) => `${p.issue.key}: ${p.issue.summary} (${p.column})`,
      });
    }
    return data;
  },
});

export const specs: GridPanelSpec[] = [
  { kind: 'jira-issues', fields: fields['jira-issues'], allowMultiple: true },
  { kind: 'jira-count', fields: fields['jira-count'], allowMultiple: true },
  { kind: 'jira-sprint', fields: fields['jira-sprint'], allowMultiple: true },
];
export const sources: DataSource<any>[] = [issuesSource, countSource, sprintSource];
