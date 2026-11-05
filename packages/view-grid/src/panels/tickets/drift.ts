import type { Ticket } from './model';

export type JiraMap = Record<string, string>;

export interface Drift {
  expected: string;
  direction: 'ahead' | 'behind';
}

const DEFAULTS: [string[], string][] = [
  [['Draft', 'Open'], 'Open'],
  [['In Analysis', 'In Progress'], 'In Progress'],
  [['In Review'], 'In Review'],
  [['Ready for Test', 'In Test', 'Awaiting Validation'], 'In Test'],
  [['TSYS Validated', 'Merged', 'Resolved', 'Delivered', 'Internal Only', 'Closed'], 'Ready to Merge'],
];

/** Jira status (lower-cased) -> expected board column. */
export const DEFAULT_JIRA_MAP: JiraMap = Object.fromEntries(DEFAULTS.flatMap(([names, col]) => names.map((n) => [n.toLowerCase(), col])));

/** One `Jira status = Column` per line; blank and bad lines dropped; merged over the defaults. */
export function parseJiraMap(text: string): JiraMap {
  const map: JiraMap = { ...DEFAULT_JIRA_MAP };
  for (const line of (text ?? '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const status = line.slice(0, i).trim().toLowerCase();
    const column = line.slice(i + 1).trim();
    if (status && column) map[status] = column;
  }
  return map;
}

/** How the card's column differs from the column its Jira status maps to, or null. */
export function driftOf(ticket: Ticket, jiraStatus: string | undefined, statuses: string[], map: JiraMap): Drift | null {
  const status = (jiraStatus ?? '').trim();
  if (!status || ticket.jiraMuted === status) return null;
  const want = map[status.toLowerCase()];
  if (!want) return null;
  const expectedIdx = statuses.findIndex((s) => s.toLowerCase() === want.toLowerCase());
  if (expectedIdx < 0) return null;
  const expected = statuses[expectedIdx]!;
  if (ticket.status.toLowerCase() === expected.toLowerCase()) return null;
  const cur = statuses.findIndex((s) => s.toLowerCase() === ticket.status.toLowerCase());
  return { expected, direction: expectedIdx > (cur < 0 ? 0 : cur) ? 'ahead' : 'behind' };
}
