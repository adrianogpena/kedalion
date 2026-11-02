import { statusTone, type StatusTone } from '../jira/map';

type Raw = Record<string, any>;

export interface JiraLinkedIssue {
  /** The link phrase seen from this ticket, e.g. "is blocked by". */
  label: string;
  key: string;
  summary: string;
  status: string;
  blocker: boolean;
}

export interface JiraComment {
  author: string;
  created: string;
  /** An Atlassian document (API v3) or a string (API v2). */
  body: unknown;
}

/** What the side panel shows from Jira for one ticket. */
export interface JiraInfo {
  summary: string;
  status: string;
  tone: StatusTone;
  type: string;
  priority: string;
  assignee: string;
  parent: string;
  labels: string[];
  fixVersions: string[];
  links: JiraLinkedIssue[];
  points: number | null;
  /** Seconds; null when unset. */
  originalEstimate: number | null;
  remainingEstimate: number | null;
  timeSpent: number | null;
  updated: string;
  due: string;
  lastComment: JiraComment | null;
}

/** The Jira fields the side panel reads (`pointsId` is the story points custom field of the server). */
export function infoFields(pointsId?: string): string[] {
  const out = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'parent', 'labels', 'fixVersions', 'issuelinks', 'comment', 'updated', 'duedate', 'timeoriginalestimate', 'timeestimate', 'timespent'];
  if (pointsId) out.push(pointsId);
  return out;
}

const name = (v: unknown): string => {
  if (!v || typeof v !== 'object') return '';
  const o = v as Raw;
  return String(o.displayName ?? o.name ?? '');
};

const seconds = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

function linked(link: Raw): JiraLinkedIssue | null {
  const inward = link.inwardIssue as Raw | undefined;
  const issue = inward ?? (link.outwardIssue as Raw | undefined);
  if (!issue) return null;
  const label = String((inward ? link.type?.inward : link.type?.outward) ?? link.type?.name ?? '');
  return {
    label,
    key: String(issue.key ?? ''),
    summary: String(issue.fields?.summary ?? ''),
    status: String(issue.fields?.status?.name ?? ''),
    blocker: !!inward && /blocked by/i.test(label),
  };
}

/** The number of the first `PCR#<n>` in `texts`. */
export function findPcr(texts: readonly string[]): string {
  for (const t of texts) {
    const m = /PCR\s*#\s*(\d+)/i.exec(t);
    if (m) return m[1];
  }
  return '';
}

/** The PCR number of a search result: in its title, its parent's title, its labels or a linked ticket's title. */
export function pcrOf(raw: Raw): string {
  const f: Raw = raw.fields ?? {};
  const links = (Array.isArray(f.issuelinks) ? (f.issuelinks as Raw[]) : []).flatMap((l) => linked(l) ?? []);
  return findPcr([String(f.summary ?? ''), String(f.parent?.fields?.summary ?? ''), ...(Array.isArray(f.labels) ? f.labels.map(String) : []), ...links.map((l) => l.summary)]);
}

/** One search result (either API version) as the side panel shows it. */
export function mapInfo(raw: Raw, pointsId?: string): JiraInfo {
  const f: Raw = raw.fields ?? {};
  const parent = f.parent;
  const comments: Raw[] = Array.isArray(f.comment?.comments) ? f.comment.comments : [];
  const last = comments[comments.length - 1];
  const points = pointsId ? f[pointsId] : undefined;
  const links = (Array.isArray(f.issuelinks) ? (f.issuelinks as Raw[]) : []).flatMap((l) => linked(l) ?? []);
  return {
    summary: String(f.summary ?? ''),
    status: String(f.status?.name ?? ''),
    tone: statusTone(f.status?.statusCategory?.key),
    type: String(f.issuetype?.name ?? ''),
    priority: String(f.priority?.name ?? ''),
    assignee: name(f.assignee),
    parent: parent ? `${parent.key ?? ''} ${parent.fields?.summary ?? ''}`.trim() : '',
    labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
    fixVersions: Array.isArray(f.fixVersions) ? (f.fixVersions as Raw[]).map((v) => String(v?.name ?? '')).filter(Boolean) : [],
    links: [...links.filter((l) => l.blocker), ...links.filter((l) => !l.blocker)],
    points: typeof points === 'number' ? points : null,
    originalEstimate: seconds(f.timeoriginalestimate),
    remainingEstimate: seconds(f.timeestimate),
    timeSpent: seconds(f.timespent),
    updated: String(f.updated ?? ''),
    due: String(f.duedate ?? ''),
    lastComment: last ? { author: name(last.author), created: String(last.created ?? ''), body: last.body ?? '' } : null,
  };
}

/** Jira duration style: 8 hours a day, 5 days a week (the default time tracking). */
export function formatDuration(totalSeconds: number): string {
  let minutes = Math.round(totalSeconds / 60);
  const parts: string[] = [];
  for (const [unit, size] of [['w', 2400], ['d', 480], ['h', 60], ['m', 1]] as const) {
    const n = Math.floor(minutes / size);
    if (n > 0) parts.push(`${n}${unit}`);
    minutes -= n * size;
  }
  return parts.join(' ') || '0m';
}

/** Whether a due date (YYYY-MM-DD) is before today and the ticket is not done. */
export function isOverdue(due: string, tone: StatusTone, now: number = Date.now()): boolean {
  if (!due || tone === 'ok') return false;
  const end = Date.parse(`${due}T23:59:59`);
  return Number.isFinite(end) && end < now;
}
