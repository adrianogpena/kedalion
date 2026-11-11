export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export type CheckState = 'failure' | 'pending' | 'neutral' | 'success';

export interface CheckDetail {
  name: string;
  state: CheckState;
  url: string;
  workflow?: string;
  startedAt?: string;
  completedAt?: string;
  /** When a waiting check was created (its suite or status), for how long it has waited. */
  queuedAt?: string;
  /** Pending but not started: queued, waiting for a runner or approval, or a status not reported yet. */
  waiting?: boolean;
  /** Output title or description, first line of the summary otherwise. */
  note?: string;
}

export interface TrackedChecks {
  state: 'none' | 'failed' | 'pending' | 'passed';
  passed: number;
  total: number;
  details: CheckDetail[];
}

export interface TrackedPr extends PrRef {
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  branch: string;
  labels: string[];
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  changesRequested: boolean;
  checks: TrackedChecks;
  ready: boolean;
  rc: boolean;
  scope?: 'mine' | 'review' | 'tracked';
}

export interface ContextNode {
  __typename?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
  description?: string | null;
  title?: string | null;
  summary?: string | null;
  createdAt?: string | null;
  checkSuite?: { createdAt?: string | null; workflowRun?: { workflow?: { name?: string } | null } | null } | null;
}

export interface PrNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: string;
  merged?: boolean;
  headRefName: string;
  labels?: { nodes?: { name: string }[] };
  reviewDecision?: string | null;
  latestReviews?: { nodes?: { state: string }[] };
  commits?: { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: ContextNode[] } } | null } }[] };
}

const URL_RE = /github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/pull\/(\d+)/i;
const SHORT_RE = /^([^/\s#]+)\/([^/\s#]+)\s*#(\d+)$/;

/** A PR link or `owner/repo#123`; null when it is neither. */
export function parseTrackedPrRef(input: string): PrRef | null {
  const text = input.trim();
  const url = URL_RE.exec(text);
  if (url) {
    const [owner, repo] = url[1]!.split('/');
    return { owner: owner!, repo: repo!, number: Number(url[2]) };
  }
  const short = SHORT_RE.exec(text);
  if (short) return { owner: short[1]!, repo: short[2]!, number: Number(short[3]) };
  return null;
}

const ORDER: Record<CheckState, number> = { failure: 0, pending: 1, neutral: 2, success: 3 };

/** The url when it is http(s), else '' (third-party links must never be javascript: or similar). */
export const safeHttpUrl = (url: string | null | undefined): string => (url && /^https?:\/\//i.test(url) ? url : '');

/** Latest run per check name, commit statuses merged in, sorted failures first. */
export function summarizeChecks(nodes: readonly ContextNode[] | undefined): TrackedChecks {
  const latest = new Map<string, { node: ContextNode; at: string }>();
  const details: CheckDetail[] = [];
  for (const node of nodes ?? []) {
    if (node.__typename === 'StatusContext' || (node.context !== undefined && node.name === undefined)) continue;
    const name = node.name ?? '';
    const at = node.completedAt ?? node.startedAt ?? '';
    const prev = latest.get(name);
    if (!prev || at > prev.at) latest.set(name, { node, at });
  }
  for (const [name, { node }] of latest) {
    let state: CheckState;
    if (node.status !== 'COMPLETED') state = 'pending';
    else if (node.conclusion === 'SUCCESS') state = 'success';
    else if (node.conclusion === 'NEUTRAL' || node.conclusion === 'SKIPPED') state = 'neutral';
    else state = 'failure';
    const note = node.title || (node.summary ?? '').split('\n').find((l) => l.trim()) || '';
    details.push({
      name,
      state,
      url: node.detailsUrl ?? '',
      workflow: node.checkSuite?.workflowRun?.workflow?.name ?? '',
      startedAt: node.startedAt ?? '',
      completedAt: node.completedAt ?? '',
      ...(state === 'pending' && node.status !== 'IN_PROGRESS' ? { waiting: true, queuedAt: node.checkSuite?.createdAt ?? '' } : {}),
      note,
    });
  }
  for (const node of nodes ?? []) {
    if (!(node.__typename === 'StatusContext' || (node.context !== undefined && node.name === undefined))) continue;
    const state: CheckState = node.state === 'SUCCESS' ? 'success' : node.state === 'PENDING' || node.state === 'EXPECTED' ? 'pending' : 'failure';
    details.push({ name: node.context ?? '', state, url: node.targetUrl ?? '', ...(state === 'pending' ? { waiting: true, queuedAt: node.createdAt ?? '' } : {}), note: node.description ?? '' });
  }
  for (const d of details) {
    const m = /^(.+?) \/ (.+)$/.exec(d.name);
    if (m && m[1] === m[2]) d.name = m[1]!;
  }
  details.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
  const passed = details.filter((d) => d.state === 'success' || d.state === 'neutral').length;
  const state = !details.length ? 'none' : details.some((d) => d.state === 'failure') ? 'failed' : details.some((d) => d.state === 'pending') ? 'pending' : 'passed';
  return { state, passed, total: details.length, details };
}

const hasLabel = (labels: readonly string[], wanted: string | readonly string[]): boolean =>
  (typeof wanted === 'string' ? [wanted] : wanted).some((raw) => {
    const w = raw.trim().toLowerCase();
    return !!w && labels.some((l) => l.toLowerCase().includes(w));
  });

const DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const;

export function toTrackedPr(node: PrNode, ref: PrRef, opts: { readyLabel: string | readonly string[]; rcLabel: string | readonly string[] }): TrackedPr {
  const labels = (node.labels?.nodes ?? []).map((l) => l.name);
  const decision = DECISIONS.find((d) => d === node.reviewDecision) ?? null;
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes;
  return {
    owner: ref.owner,
    repo: ref.repo,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.merged || node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open',
    draft: node.isDraft,
    branch: node.headRefName,
    labels,
    reviewDecision: decision,
    changesRequested: (node.latestReviews?.nodes ?? []).some((r) => r.state === 'CHANGES_REQUESTED'),
    checks: summarizeChecks(contexts),
    ready: hasLabel(labels, opts.readyLabel),
    rc: hasLabel(labels, opts.rcLabel),
  };
}
