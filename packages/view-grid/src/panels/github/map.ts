import { summarizeChecks, type CheckDetail, type ContextNode } from './tracked';

export const DEFAULT_TICKET_PATTERN = '[A-Z][A-Z0-9]+-\\d+';
export const MIN_REFRESH_MS = 60_000;
export const PR_REFRESH_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

export type SearchKind = 'pr' | 'issue';
export type CiState = 'pass' | 'fail' | 'pending' | 'policy' | 'none';

export const PR_MODES = ['mine', 'review', 'assigned', 'involves', 'closed', 'repo', 'custom'] as const;
export const ISSUE_MODES = ['assigned', 'created', 'mentioned', 'repo', 'custom'] as const;

const PR_QUERIES: Record<string, string> = {
  mine: 'is:pr is:open author:@me',
  review: 'is:pr is:open review-requested:@me',
  assigned: 'is:pr is:open assignee:@me',
  involves: 'is:pr is:open involves:@me',
  closed: 'is:pr is:closed author:@me sort:updated-desc',
};

const ISSUE_QUERIES: Record<string, string> = {
  assigned: 'is:issue is:open assignee:@me',
  created: 'is:issue is:open author:@me',
  mentioned: 'is:issue is:open mentions:@me',
};

/** The search string of a mode; null when the mode needs a repo or query that is empty. */
export function buildQuery(kind: SearchKind, mode: string, repo: string, query: string): string | null {
  const prefix = kind === 'pr' ? 'is:pr' : 'is:issue';
  if (mode === 'repo') return /^[\w.-]+\/[\w.-]+$/.test(repo.trim()) ? `${prefix} is:open repo:${repo.trim()}` : null;
  if (mode === 'custom') {
    const q = query.trim();
    if (!q) return null;
    return new RegExp(`(^|\\s)${prefix}(\\s|$)`).test(q) ? q : `${prefix} ${q}`;
  }
  return (kind === 'pr' ? PR_QUERIES : ISSUE_QUERIES)[mode] ?? null;
}

interface Rollup {
  state?: string;
  contexts?: { nodes?: (ContextNode | null)[] };
}

/** The checks of a rollup as detail rows: latest run per name, failures first. */
export function mapCheckList(rollup: Rollup | null | undefined): CheckDetail[] {
  return summarizeChecks((rollup?.contexts?.nodes ?? []).filter((n): n is ContextNode => !!n)).details;
}

const FAIL_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);

/** policy-bot stays pending until a reviewer approves, so it never counts as a running check. */
export const POLICY_BOT = /policy-bot/i;

/** Repos whose policy keeps approvals across new commits, so none is ever outdated. */
const PERSISTENT_APPROVALS = new Set(['miles-core', 'miles-ria', 'miles-mmc']);

export interface Approvals {
  /** Approved on the head commit. */
  current: string[];
  /** Approved on an older commit; policy-bot drops these where approvals do not survive a push. */
  outdated: string[];
}

interface ReviewNode {
  state?: string;
  author?: { login?: string } | null;
  commit?: { oid?: string } | null;
}

/** The approving reviewers (latest review each) split by whether they approved the head commit. */
export function mapApprovals(reviews: readonly (ReviewNode | null)[] | undefined, headOid: string | undefined, repo: string): Approvals {
  const persistent = PERSISTENT_APPROVALS.has(repo.split('/')[1] ?? '');
  const out: Approvals = { current: [], outdated: [] };
  for (const r of reviews ?? []) {
    const login = r?.author?.login;
    if (r?.state !== 'APPROVED' || !login) continue;
    const stale = !persistent && !!headOid && !!r.commit?.oid && r.commit.oid !== headOid;
    (stale ? out.outdated : out.current).push(login);
  }
  return out;
}

/** statusCheckRollup -> pass/fail/pending plus the names of the failing checks; a failure shows as pending while another check still runs. */
export function reduceChecks(rollup: Rollup | null | undefined): { state: CiState; failing: string[] } {
  if (!rollup?.state) return { state: 'none', failing: [] };
  const failing: string[] = [];
  for (const n of rollup.contexts?.nodes ?? []) {
    if (!n) continue;
    if (n.__typename === 'CheckRun') {
      if (n.conclusion && FAIL_CONCLUSIONS.has(n.conclusion)) failing.push(n.name ?? '');
    } else if (n.state === 'FAILURE' || n.state === 'ERROR') failing.push(n.context ?? '');
  }
  const names = failing.filter(Boolean);
  const list = mapCheckList(rollup);
  const running = list.some((d) => d.state === 'pending' && !POLICY_BOT.test(d.name));
  const policyOnly = !running && list.some((d) => d.state === 'pending');
  switch (rollup.state) {
    case 'SUCCESS':
      return { state: 'pass', failing: [] };
    case 'FAILURE':
    case 'ERROR':
      return { state: running ? 'pending' : 'fail', failing: names };
    case 'PENDING':
    case 'EXPECTED':
      return { state: names.length && !running ? 'fail' : policyOnly && !names.length ? 'policy' : 'pending', failing: names };
    default:
      return { state: 'none', failing: [] };
  }
}

export interface CheckCounts {
  passed: number;
  failed: number;
  pending: number;
  total: number;
}

/** The checks of a rollup counted by outcome, over the same list the side panel groups (latest run per name; skipped counts as passed). */
export function countChecks(rollup: Rollup | null | undefined): CheckCounts {
  const c: CheckCounts = { passed: 0, failed: 0, pending: 0, total: 0 };
  for (const d of mapCheckList(rollup)) {
    c.total++;
    if (d.state === 'failure') c.failed++;
    else if (d.state === 'pending') c.pending++;
    else c.passed++;
  }
  return c;
}

/** The first ticket key in the title, else in the branch; '' when none or the pattern is not a valid regex. */
export function ticketKey(title: string, branch: string, pattern: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern || DEFAULT_TICKET_PATTERN);
  } catch {
    re = new RegExp(DEFAULT_TICKET_PATTERN);
  }
  return re.exec(title)?.[0] ?? re.exec(branch)?.[0] ?? '';
}

export interface RateLimit {
  remaining: number;
  limit: number;
}

/**
 * The suggested interval under rate pressure: below 10% remaining it doubles `prev` (or `base`), max 15 min;
 * undefined when the quota is fine.
 */
export function nextRefreshMs(rate: RateLimit | null | undefined, base: number, prev?: number): number | undefined {
  if (!rate || !(rate.limit > 0) || rate.remaining / rate.limit >= 0.1) return undefined;
  return Math.min(MAX_BACKOFF_MS, Math.max(base, prev ?? base) * 2);
}

export interface Node {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  updatedAt?: string;
  author?: { login?: string } | null;
  repository?: { nameWithOwner?: string } | null;
  labels?: { nodes?: ({ name?: string } | null)[] } | null;
  isDraft?: boolean;
  headRefName?: string;
  reviewDecision?: string | null;
  headRefOid?: string;
  latestOpinionatedReviews?: { nodes?: (ReviewNode | null)[] } | null;
  commits?: { nodes?: ({ commit?: { statusCheckRollup?: Rollup | null } } | null)[] } | null;
  assignees?: { nodes?: ({ login?: string } | null)[] } | null;
  comments?: { totalCount?: number; nodes?: (CommentNode | null)[] } | null;
  milestone?: { title?: string } | null;
  createdAt?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable?: string;
  baseRefName?: string;
  autoMergeRequest?: { enabledAt?: string } | null;
  reviewThreads?: { nodes?: ({ isResolved?: boolean; comments?: { nodes?: (CommentNode | null)[] } | null } | null)[] } | null;
}

interface CommentNode {
  author?: { login?: string; __typename?: string } | null;
}

const isCopilot = (login: string) => /copilot/i.test(login);

/** A comment to review: from someone other than the PR author, and not from a bot unless it is Copilot. */
function countsAsComment(c: CommentNode | null | undefined, prAuthor: string): boolean {
  const login = c?.author?.login ?? '';
  if (!c || !login || login === prAuthor) return false;
  return c.author?.__typename !== 'Bot' || isCopilot(login);
}

export interface SearchResponse {
  search?: { issueCount?: number; nodes?: (Node | null)[] };
  rateLimit?: { remaining?: number; limit?: number } | null;
}

export type Review = 'approved' | 'changes' | 'required' | 'none';

export interface PrItem {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  draft: boolean;
  state: string;
  branch: string;
  labels: string[];
  review: Review;
  ci: CiState;
  failing: string[];
  ticket: string;
  /** The ticket key is on the Tickets board (always true when the board could not be read). */
  linked: boolean;
  updatedAt: string;
  createdAt: string;
  additions: number;
  deletions: number;
  files: number;
  conflicts: boolean;
  threads: number;
  comments: number;
  base: string;
  autoMerge: boolean;
  checks: CheckCounts;
  checkList: CheckDetail[];
  approvals: Approvals;
}

export interface IssueItem {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  state: string;
  labels: string[];
  assignees: string[];
  comments: number;
  milestone: string;
  updatedAt: string;
}

export interface SearchData<T> {
  total: number;
  items: T[];
  /** Suggested reload interval under rate pressure. */
  nextRefreshMs?: number;
}

const names = (list: { nodes?: ({ name?: string; login?: string } | null)[] } | null | undefined, key: 'name' | 'login'): string[] =>
  (list?.nodes ?? []).map((n) => n?.[key] ?? '').filter(Boolean);

const REVIEW: Record<string, Review> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };

/** Required status contexts of a base branch, keyed `owner/name@branch`; GitHub leaves one out of the rollup until it is first reported. */
export type RequiredChecks = ReadonlyMap<string, readonly string[]>;

/** The rollup plus an EXPECTED status for each required context it lacks, as the PR page shows them. */
export function withExpected(rollup: Rollup | null | undefined, required: readonly string[] | undefined): Rollup | null | undefined {
  if (!rollup || !required?.length) return rollup;
  const nodes = (rollup.contexts?.nodes ?? []).filter((n): n is ContextNode => !!n);
  const have = new Set(nodes.map((n) => n.context ?? n.name ?? ''));
  const missing = required.filter((c) => !have.has(c));
  if (!missing.length) return rollup;
  const expected = missing.map((context): ContextNode => ({ __typename: 'StatusContext', context, state: 'EXPECTED', description: 'Waiting for status to be reported' }));
  return { ...rollup, contexts: { nodes: [...nodes, ...expected] } };
}

export function mapPullRequests(res: SearchResponse, ticketPattern: string, required?: RequiredChecks): SearchData<PrItem> {
  const items: PrItem[] = [];
  for (const n of res.search?.nodes ?? []) {
    if (!n?.number || !n.url) continue;
    const rollup = withExpected(n.commits?.nodes?.[0]?.commit?.statusCheckRollup, required?.get(`${n.repository?.nameWithOwner}@${n.baseRefName}`));
    const checks = reduceChecks(rollup);
    const title = n.title ?? '';
    const branch = n.headRefName ?? '';
    items.push({
      id: n.url,
      number: n.number,
      title,
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      author: n.author?.login ?? '',
      draft: n.isDraft === true,
      state: (n.state ?? '').toLowerCase(),
      branch,
      labels: names(n.labels, 'name'),
      review: REVIEW[n.reviewDecision ?? ''] ?? 'none',
      ci: checks.state,
      failing: checks.failing,
      ticket: ticketKey(title, branch, ticketPattern),
      linked: true,
      updatedAt: n.updatedAt ?? '',
      createdAt: n.createdAt ?? '',
      additions: n.additions ?? 0,
      deletions: n.deletions ?? 0,
      files: n.changedFiles ?? 0,
      conflicts: n.mergeable === 'CONFLICTING',
      threads: (n.reviewThreads?.nodes ?? []).filter((t) => t && t.isResolved === false).length,
      comments:
        (n.reviewThreads?.nodes ?? []).filter((t) => t && countsAsComment(t.comments?.nodes?.[0], n.author?.login ?? '')).length +
        (n.comments?.nodes ?? []).filter((c) => countsAsComment(c, n.author?.login ?? '')).length,
      base: n.baseRefName ?? '',
      autoMerge: !!n.autoMergeRequest?.enabledAt,
      checks: countChecks(rollup),
      checkList: mapCheckList(rollup),
      approvals: mapApprovals(n.latestOpinionatedReviews?.nodes, n.headRefOid, n.repository?.nameWithOwner ?? ''),
    });
  }
  return { total: res.search?.issueCount ?? items.length, items };
}

export function mapIssues(res: SearchResponse): SearchData<IssueItem> {
  const items: IssueItem[] = [];
  for (const n of res.search?.nodes ?? []) {
    if (!n?.number || !n.url) continue;
    items.push({
      id: n.url,
      number: n.number,
      title: n.title ?? '',
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      author: n.author?.login ?? '',
      state: (n.state ?? '').toLowerCase(),
      labels: names(n.labels, 'name'),
      assignees: names(n.assignees, 'login'),
      comments: n.comments?.totalCount ?? 0,
      milestone: n.milestone?.title ?? '',
      updatedAt: n.updatedAt ?? '',
    });
  }
  return { total: res.search?.issueCount ?? items.length, items };
}

/** The reload interval of a search panel: `base`, 60 s while checks are pending, never below 60 s, never under the source's suggestion. */
export function searchRefreshMs(data: { nextRefreshMs?: number; items: readonly object[] } | undefined, base = PR_REFRESH_MS): number {
  const pending = data?.items.some((i) => (i as { ci?: CiState }).ci === 'pending') ? MIN_REFRESH_MS : base;
  return Math.max(MIN_REFRESH_MS, pending, data?.nextRefreshMs ?? 0);
}
