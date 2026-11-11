import { invalid } from '@kedalion/server-core';
import { defineSource, SourceError, type DataSource, type GridPanelSpec, type ResolvedConnection } from '../../server';
import { createJsonStore, type JsonStore } from '../../json-store';
import { graphql, rest } from './client';
import { mapLimit } from './limit';
import { parseTrackedPrRef, toTrackedPr, type PrNode, type PrRef, type TrackedPr } from './tracked';
import { ACTIONS_SOURCE_FIELDS, LABELS_SOURCE_FIELDS, TRACKED_SOURCE_FIELDS, fields,ISSUE_SOURCE_FIELDS, NOTIFICATIONS_SOURCE_FIELDS, OVERVIEW_SOURCE_FIELDS, PR_SOURCE_FIELDS, PR_QUERY_SOURCE_FIELDS, RELEASES_FIELDS } from './fields';
import { notifyChanges, notifyScope } from '../../notify-changes';
import { latestSettledRuns, mapNotifications, mapReleases, mapRepoStats, mapRuns, parseRepo, runsPath, type RepoResponse } from './more';
import { buildQuery, mapIssues, mapPullRequests, nextRefreshMs, PR_REFRESH_MS, type Node as PrNodeFull, type PrItem, type RequiredChecks, type SearchResponse } from './map';

import { BOT_LOGIN, parseBotComments, type BotComment } from './bot';
import { isRcComment, parseRcComment } from './rc';
import { mapThreads, type ThreadNode } from './threads';

const RATE ='rateLimit { remaining limit resetAt }';

const PR_ITEM_FIELDS = `number title url isDraft state headRefName headRefOid baseRefName updatedAt createdAt reviewDecision
        latestOpinionatedReviews(first: 20) { nodes { state author { login } commit { oid } } }
        additions deletions changedFiles mergeable
        autoMergeRequest { enabledAt }
        comments(first: 100) { nodes { author { login __typename } } }
        reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { author { login __typename } } } } }
        author { login }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes { __typename ... on CheckRun { name status conclusion startedAt completedAt detailsUrl title summary checkSuite { workflowRun { workflow { name } } } } ... on StatusContext { context state targetUrl description } } } } } } }`;

const PR_QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    issueCount
    nodes {
      ... on PullRequest {
        ${PR_ITEM_FIELDS}
      }
    }
  }
  ${RATE}
}`;

const ONE_PR_QUERY = `query($o: String!, $n: String!, $p: Int!) {
  repository(owner: $o, name: $n) { pullRequest(number: $p) { ${PR_ITEM_FIELDS} } }
}`;

const REQUIRED_TTL_MS = 10 * 60_000;
const requiredCache = new Map<string, { at: number; contexts: string[] }>();

/** Required status contexts per `repo@base` of the given PRs, from the branch rules (cached; empty when unreadable). */
async function requiredChecks(conn: ResolvedConnection, nodes: readonly (PrNodeFull | null | undefined)[], signal?: AbortSignal): Promise<RequiredChecks> {
  const keys = new Set<string>();
  for (const n of nodes) if (n?.repository?.nameWithOwner && n.baseRefName) keys.add(`${n.repository.nameWithOwner}@${n.baseRefName}`);
  const out = new Map<string, string[]>();
  await mapLimit([...keys], 4, async (key) => {
    const cacheKey = `${conn.baseUrl}|${key}`;
    const hit = requiredCache.get(cacheKey);
    if (hit && Date.now() - hit.at < REQUIRED_TTL_MS) return void out.set(key, hit.contexts);
    const [repo, base] = key.split('@') as [string, string];
    let contexts: string[] = [];
    try {
      const rules = await rest<{ type?: string; parameters?: { required_status_checks?: { context?: string }[] } }[]>(conn, `/repos/${repo}/rules/branches/${encodeURIComponent(base)}`, signal);
      contexts = rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context ?? '')).filter(Boolean);
    } catch {
      contexts = [];
    }
    requiredCache.set(cacheKey, { at: Date.now(), contexts });
    out.set(key, contexts);
  });
  return out;
}

/** One PR with everything the PR side panel shows; null when it no longer resolves. */
export async function fetchPrItem(conn: ResolvedConnection, repo: string, number: number, ticketPattern: string, signal?: AbortSignal): Promise<PrItem | null> {
  const [owner, name] = repo.split('/');
  const res = await graphql<{ repository?: { pullRequest?: PrNodeFull | null } | null }>(conn, ONE_PR_QUERY, { o: owner, n: name, p: number }, signal);
  const node = res.repository?.pullRequest;
  return node ? (mapPullRequests({ search: { nodes: [node] } }, ticketPattern, await requiredChecks(conn, [node], signal)).items[0] ?? null) : null;
}

const THREADS_QUERY = `query($o: String!, $n: String!, $p: Int!) {
  repository(owner: $o, name: $n) { pullRequest(number: $p) {
    reviewThreads(first: 100) { nodes { isResolved isOutdated path line originalLine comments(first: 30) { totalCount nodes { author { login } body createdAt url } } } }
  } }
}`;

/** The RC build comment, the bot comments and the unresolved review threads of one PR. */
export async function fetchPrExtra(conn: ResolvedConnection, repo: string, number: number, signal?: AbortSignal) {
  let found: string | null = null;
  const botComments: BotComment[] = [];
  for (let page = 1; page <= 5; page++) {
    const list = await rest<{ body?: string | null; user?: { login?: string } | null; updated_at?: string; html_url?: string }[]>(conn, `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, signal);
    for (const c of list) {
      if (!c.body || c.user?.login !== BOT_LOGIN) continue;
      const rc = isRcComment(c.body);
      if (rc) found = c.body;
      botComments.push({ body: c.body, updatedAt: c.updated_at ?? '', url: c.html_url ?? '', rc });
    }
    if (list.length < 100) break;
  }
  let threads = mapThreads([]);
  try {
    const [owner, name] = repo.split('/');
    const res = await graphql<{ repository?: { pullRequest?: { reviewThreads?: { nodes?: (ThreadNode | null)[] } } | null } | null }>(conn, THREADS_QUERY, { o: owner, n: name, p: number }, signal);
    threads = mapThreads(res.repository?.pullRequest?.reviewThreads?.nodes ?? []);
  } catch {
    // the threads are optional; the rest of the extra still shows
  }
  return { rc: found ? parseRcComment(found) : null, bot: parseBotComments(botComments), threads };
}

const ISSUE_QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    issueCount
    nodes {
      ... on Issue {
        number title url state updatedAt
        author { login }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name } }
        assignees(first: 5) { nodes { login } }
        comments { totalCount }
        milestone { title }
      }
    }
  }
  ${RATE}
}`;

interface SearchConfig {
  connection: string;
  mode: string;
  repo: string;
  query: string;
  max: number;
  ticketPattern?: string;
  [key: string]: unknown;
}

const backoff = new Map<string, number>();

const TRACKED_CI = { failed: 'fail', passed: 'pass', pending: 'pending', none: 'none' } as const;

function prStatus(state: string, ci: 'pass' | 'fail' | 'pending' | 'policy' | 'none'): string {
  if (state === 'merged') return 'Merged';
  if (state === 'closed') return 'Closed';
  switch (ci) {
    case 'pass':
      return 'Passed';
    case 'fail':
      return 'Failed';
    case 'pending':
      return 'Running';
    case 'policy':
      return 'Policy-bot pending';
    default:
      return 'No checks';
  }
}

async function search(kind: 'pr' | 'issue', config: SearchConfig, ctx: Parameters<DataSource['fetch']>[1]): Promise<{ res: SearchResponse; nextRefreshMs?: number }> {
  const q = buildQuery(kind, config.mode, config.repo, config.query);
  if (!q) throw SourceError('not-configured', kind === 'pr' ? 'The pull request search is not set up.' : 'The issue search is not set up.');
  const conn = await ctx.connection(config.connection, 'github');
  const res = await graphql<SearchResponse>(conn, kind === 'pr' ? PR_QUERY : ISSUE_QUERY, { q, n: config.max }, ctx.signal);
  const next = nextRefreshMs(res.rateLimit && { remaining: res.rateLimit.remaining ?? 0, limit: res.rateLimit.limit ?? 0 }, PR_REFRESH_MS, backoff.get(conn.baseUrl));
  if (next) backoff.set(conn.baseUrl, next);
  else backoff.delete(conn.baseUrl);
  return { res, nextRefreshMs: next };
}

/** The PR list of a panel. */
async function fetchPrList(scope: string, config: SearchConfig, ctx: Parameters<DataSource['fetch']>[1]) {
  const { res, nextRefreshMs } = await search('pr', config, ctx);
  const conn = await ctx.connection(config.connection, 'github');
  const data = mapPullRequests(res, config.ticketPattern ?? '', await requiredChecks(conn, res.search?.nodes ?? [], ctx.signal));
  let board: Set<string> | null = null;
  try {
    const { ticketsStore } = await import('../tickets/server');
    board = new Set((await ticketsStore(ctx.dataDir).read()).tickets.map((t) => t.key.toUpperCase()));
  } catch {
    board = null;
  }
  const items = board ? data.items.map((pr) => ({ ...pr, linked: !!pr.ticket && board.has(pr.ticket.toUpperCase()) })) : data.items;
  if (config.notify !== false) {
    notifyChanges(ctx, notifyScope(scope, config), items, {
      key: (pr) => pr.id,
      sig: (pr) => [pr.state, pr.review, pr.ci, `${pr.checks.passed}/${pr.checks.total}`].join('|'),
      title: 'Pull requests',
      line: (pr) => pr.title,
      heading: (pr, isNew) => (isNew ? 'New PR added' : prStatus(pr.state, pr.ci)),
    });
  }
  return { ...data, items, ...(nextRefreshMs ? { nextRefreshMs } : {}) };
}

export const githubPrQuerySource = defineSource<SearchConfig>({
  id: 'github-pr-query',
  fields: PR_QUERY_SOURCE_FIELDS,
  fetch: (config, ctx) => fetchPrList('github-pr-query', { ...config, mode: 'custom' }, ctx),
});

export const githubPrsSource = defineSource<SearchConfig>({
  id: 'github-prs',
  fields: PR_SOURCE_FIELDS,
  fetch: (config, ctx) => fetchPrList('github-prs', config, ctx),
  actions: {
    async pr(payload, config, ctx) {
      const p = payload as { repo?: unknown; number?: unknown } | null;
      const ref = typeof p?.repo === 'string' ? parseRepo(p.repo) : null;
      const number = Number(p?.number);
      if (!ref || !Number.isInteger(number) || number <= 0) throw invalid('pr-ref', 'A pull request is required.');
      const item = await fetchPrItem(await ctx.connection(config.connection, 'github'), ref, number, config.ticketPattern ?? '', ctx.signal);
      if (!item) throw invalid('pr-not-found', 'The pull request was not found.');
      return item;
    },
    async rc(payload, config, ctx) {
      const p = payload as { repo?: unknown; number?: unknown } | null;
      const ref = typeof p?.repo === 'string' ? parseRepo(p.repo) : null;
      const number = Number(p?.number);
      if (!ref || !Number.isInteger(number) || number <= 0) throw invalid('rc-pr-ref', 'A pull request is required.');
      const conn = await ctx.connection(config.connection, 'github');
      return fetchPrExtra(conn, ref, number, ctx.signal);
    },
  },
});

export const githubIssuesSource = defineSource<SearchConfig>({
  id: 'github-issues',
  fields: ISSUE_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const { res, nextRefreshMs } = await search('issue', config, ctx);
    const data = mapIssues(res);
    if (config.notify !== false) {
      notifyChanges(ctx, notifyScope('github-issues', config), data.items, {
        key: (i) => i.id,
        sig: (i) => [i.state, i.assignees.join(','), i.title].join('|'),
        title: 'Issues',
        line: (i) => `${i.repo}#${i.number} ${i.title} (${i.state})`,
      });
    }
    return { ...data, ...(nextRefreshMs ? { nextRefreshMs } : {}) };
  },
});

interface RepoConfig {
  connection: string;
  repo: string;
  max: number;
  [key: string]: unknown;
}

function needRepo(repo: string): string {
  const r = parseRepo(repo);
  if (!r) throw SourceError('not-configured', 'Set a repository as owner/name.');
  return r;
}

export const githubActionsSource = defineSource<RepoConfig & { branch: string; workflow: string }>({
  id: 'github-actions',
  fields: ACTIONS_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const repo = needRepo(config.repo);
    const conn = await ctx.connection(config.connection, 'github');
    const raw = await rest<Parameters<typeof mapRuns>[0]>(conn, runsPath(repo, config.branch ?? '', config.workflow ?? '', config.max), ctx.signal);
    const data = mapRuns(raw, config.max);
    if (config.notify !== false) {
      notifyChanges(ctx, notifyScope('github-actions', config), latestSettledRuns(data.items), {
        key: (r) => r.workflow || r.title,
        sig: (r) => r.status,
        title: 'Workflow runs',
        line: (r) => `${r.workflow || r.title} ${r.status === 'failure' ? 'failed' : 'recovered'}${r.branch ? ` on ${r.branch}` : ''}`,
      });
    }
    return data;
  },
});

export const githubNotificationsSource = defineSource<{ connection: string; participatingOnly: boolean; max: number; [key: string]: unknown }>({
  id: 'github-notifications',
  fields: NOTIFICATIONS_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const conn = await ctx.connection(config.connection, 'github');
    const q = new URLSearchParams({ per_page: String(config.max) });
    if (config.participatingOnly) q.set('participating', 'true');
    const raw = await rest<Parameters<typeof mapNotifications>[0]>(conn, `/notifications?${q}`, ctx.signal);
    const data = mapNotifications(raw, config.max);
    if (config.notify !== false) {
      notifyChanges(ctx, notifyScope('github-notifications', config), data.items, {
        key: (n) => n.id,
        sig: () => '',
        title: 'GitHub notifications',
        line: (n) => `${n.repo}: ${n.title}`,
      });
    }
    return data;
  },
});

export const githubReleasesSource = defineSource<RepoConfig & { includePrereleases: boolean }>({
  id: 'github-releases',
  fields: RELEASES_FIELDS,
  async fetch(config, ctx) {
    const repo = needRepo(config.repo);
    const conn = await ctx.connection(config.connection, 'github');
    const raw = await rest<Parameters<typeof mapReleases>[0]>(conn, `/repos/${repo}/releases?per_page=${Math.min(100, config.max * 2)}`, ctx.signal);
    const data = mapReleases(raw, config.max, !!config.includePrereleases);
    if (config.notify !== false) {
      notifyChanges(ctx, notifyScope('github-releases', config), data.items, {
        key: (r) => r.id,
        sig: () => '',
        title: `New release in ${repo}`,
        line: (r) => r.name,
      });
    }
    return data;
  },
});

const OVERVIEW_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    url stargazerCount forkCount
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
    watchers { totalCount }
    pushedAt
    defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
  }
}`;

export const githubOverviewSource = defineSource<{ connection: string; repo: string; [key: string]: unknown }>({
  id: 'github-overview',
  fields: OVERVIEW_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const [owner, name] = needRepo(config.repo).split('/');
    const conn = await ctx.connection(config.connection, 'github');
    const res = await graphql<RepoResponse>(conn, OVERVIEW_QUERY, { owner, name }, ctx.signal);
    const stats = mapRepoStats(res);
    if (!stats) throw SourceError('upstream', 'Repository not found.');
    return stats;
  },
});

const PR_FIELDS = `number title url isDraft state merged headRefName
  labels(first: 30) { nodes { name } }
  mergeStateStatus reviewDecision
  latestReviews(first: 50) { nodes { state } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename ... on CheckRun { name status conclusion startedAt completedAt detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }`;

const CHUNK = 5;
/** Concurrent GraphQL requests per lookup; GitHub penalizes many at once. */
const CONCURRENCY = 4;
export const MAX_TRACKED = 50;

export interface TrackedOptions {
  readyLabel: string | string[];
  rcLabel: string | string[];
}

const DEFAULT_LABELS: TrackedOptions = { readyLabel: 'ready to merge', rcLabel: 'rc' };

/** The PRs of `refs` (chunks of 5 per GraphQL request), in the order of `refs`; PRs that no longer resolve are left out. */
export async function fetchPrs(conn: ResolvedConnection, refs: readonly PrRef[], signal?: AbortSignal, opts: TrackedOptions = DEFAULT_LABELS): Promise<TrackedPr[]> {
  const out: (TrackedPr | undefined)[] = new Array(refs.length);
  const starts = Array.from({ length: Math.ceil(refs.length / CHUNK) }, (_, c) => c * CHUNK);
  await mapLimit(starts, CONCURRENCY, async (i) => {
    const chunk = refs.slice(i, i + CHUNK);
    const query = `query(${chunk.map((_, k) => `$o${k}: String!, $n${k}: String!, $p${k}: Int!`).join(', ')}) {
${chunk.map((_, k) => `  t${k}: repository(owner: $o${k}, name: $n${k}) { pullRequest(number: $p${k}) { ${PR_FIELDS} } }`).join('\n')}
}`;
    const vars: Record<string, unknown> = {};
    chunk.forEach((r, k) => Object.assign(vars, { [`o${k}`]: r.owner, [`n${k}`]: r.repo, [`p${k}`]: r.number }));
    const res = await graphql<Record<string, { pullRequest: PrNode | null } | null>>(conn, query, vars, signal);
    chunk.forEach((ref, k) => {
      const node = res[`t${k}`]?.pullRequest;
      if (node) out[i + k] = toTrackedPr(node, ref, opts);
    });
  });
  return out.filter((p): p is TrackedPr => !!p);
}

const POOL_QUERY = `query($mine: String!, $review: String!) {
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ... on PullRequest { number repository { nameWithOwner } } } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ... on PullRequest { number repository { nameWithOwner } } } }
}`;

type PoolNode = { number: number; repository?: { nameWithOwner: string } };

const KEY_CHUNK = 10;
const KEY_PRS = 10;
const KEY_CACHE_MS = 5 * 60_000;
const KEY_CACHE_MAX = 500;
const keyCache = new Map<string, { refs: PrRef[]; expires: number }>();

/** Refs of PRs (any state, any author) whose title or branch mentions one of `keys`, found by one light search per key; results are cached per key for `KEY_CACHE_MS`. */
async function findKeyPrRefs(conn: ResolvedConnection, keys: readonly string[], signal?: AbortSignal): Promise<PrRef[]> {
  const now = Date.now();
  for (const [k, v] of keyCache) if (v.expires <= now) keyCache.delete(k);
  const prefix = `${conn.baseUrl}|${conn.user ?? ''}|${Bun.hash(conn.token).toString(36)}|`;
  const cached: PrRef[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const hit = keyCache.get(prefix + key.toUpperCase());
    if (hit) cached.push(...hit.refs);
    else missing.push(key);
  }
  const starts = Array.from({ length: Math.ceil(missing.length / KEY_CHUNK) }, (_, c) => c * KEY_CHUNK);
  const parts = await mapLimit(starts, CONCURRENCY, async (i) => {
    const out: PrRef[] = [];
    const chunk = missing.slice(i, i + KEY_CHUNK);
    const query = `query(${chunk.map((_, k) => `$q${k}: String!`).join(', ')}) {
${chunk.map((_, k) => `  k${k}: search(query: $q${k}, type: ISSUE, first: ${KEY_PRS}) { nodes { ... on PullRequest { number title headRefName repository { nameWithOwner } } } }`).join('\n')}
}`;
    const vars: Record<string, unknown> = {};
    chunk.forEach((key, k) => Object.assign(vars, { [`q${k}`]: `is:pr in:title,body "${key.replace(/"/g, '')}" sort:updated-desc` }));
    const res = await graphql<Record<string, { nodes: ({ number: number; title: string; headRefName?: string; repository?: { nameWithOwner: string } } | null)[] }>>(conn, query, vars, signal);
    chunk.forEach((key, k) => {
      const whole = new RegExp(`(?<![A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`, 'i');
      const found: PrRef[] = [];
      for (const node of res[`k${k}`]?.nodes ?? []) {
        const [owner, repo] = node?.repository?.nameWithOwner.split('/') ?? [];
        if (node && owner && repo && (whole.test(node.title) || whole.test(node.headRefName ?? ''))) found.push({ owner, repo, number: node.number });
      }
      while (keyCache.size >= KEY_CACHE_MAX) {
        const oldest = keyCache.keys().next().value;
        if (oldest === undefined) break;
        keyCache.delete(oldest);
      }
      keyCache.set(prefix + key.toUpperCase(), { refs: found, expires: Date.now() + KEY_CACHE_MS });
      out.push(...found);
    });
    return out;
  });
  return [...cached, ...parts.flat()];
}

/** Open PRs of the user (`mine`), those awaiting their review (`review`), the tracked ones and, when `keys` is given, any PR titled with one of them; each but the last tagged with its `scope`. */
export async function fetchPrPool(conn: ResolvedConnection, { tracked, keys = [], signal, ...opts }: { tracked: readonly PrRef[]; keys?: readonly string[]; signal?: AbortSignal } & Partial<TrackedOptions>): Promise<TrackedPr[]> {
  const labels = { ...DEFAULT_LABELS, ...opts };
  const uniqueKeys = [...new Map(keys.filter(Boolean).map((k) => [k.toUpperCase(), k])).values()];
  const [res, trackedPrs, keyRefs] = await Promise.all([
    graphql<Record<'mine' | 'review', { nodes: (PoolNode | null)[] }>>(conn, POOL_QUERY, { mine: 'is:pr is:open author:@me', review: 'is:pr is:open review-requested:@me' }, signal),
    fetchPrs(conn, tracked, signal, labels),
    uniqueKeys.length ? findKeyPrRefs(conn, uniqueKeys, signal).catch((): PrRef[] | null => null) : Promise.resolve<PrRef[] | null>([]),
  ]);
  const refKey = (r: PrRef) => `${r.owner}/${r.repo}#${r.number}`;
  const scoped = (['mine', 'review'] as const).flatMap((scope) =>
    res[scope].nodes.flatMap((node) => {
      const [owner, repo] = node?.repository?.nameWithOwner.split('/') ?? [];
      return node && owner && repo ? [{ scope, ref: { owner, repo, number: node.number } }] : [];
    }),
  );
  const unique = [...new Map(scoped.map((s) => [refKey(s.ref), s.ref])).values()];
  const byKey = new Map((await fetchPrs(conn, unique, signal, labels)).map((p) => [refKey(p), p]));
  const out: TrackedPr[] = [];
  for (const { scope, ref } of scoped) {
    const pr = byKey.get(refKey(ref));
    if (pr) out.push({ ...pr, scope });
  }
  for (const pr of trackedPrs) out.push({ ...pr, scope: 'tracked' });
  if (keyRefs?.length) {
    try {
      const seen = new Set(out.map(refKey));
      const refs = keyRefs.filter((r) => !seen.has(refKey(r)));
      out.push(...(await fetchPrs(conn, refs, signal, labels)));
    } catch {
      // the lookup by key is best-effort; keep the PRs already found
    }
  }
  return out;
}

interface TrackedStore {
  refs: PrRef[];
}

const parseStore = (raw: unknown): TrackedStore => {
  const list = (raw as { refs?: unknown })?.refs;
  const refs = Array.isArray(list)
    ? list.filter((r): r is PrRef => !!r && typeof r.owner === 'string' && typeof r.repo === 'string' && Number.isInteger(r.number))
    : [];
  return { refs: refs.slice(0, MAX_TRACKED).map(({ owner, repo, number }) => ({ owner, repo, number })) };
};

const stores = new Map<string, JsonStore<TrackedStore>>();
/** The `tracked-prs` store of a data dir. */
export function trackedStore(dataDir: string): JsonStore<TrackedStore> {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore({ dataDir, name: 'tracked-prs', parse: parseStore, empty: () => ({ refs: [] }) });
    stores.set(dataDir, s);
  }
  return s;
}

const sameRef = (a: PrRef, b: PrRef) => a.number === b.number && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();

interface TrackedConfig {
  connection: string;
  readyLabel: string | string[];
  rcLabel: string | string[];
  [key: string]: unknown;
}

export const githubTrackedSource = defineSource<TrackedConfig>({
  id: 'github-tracked',
  fields: TRACKED_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const { refs } = await trackedStore(ctx.dataDir).read();
    if (!refs.length) return { items: [] as TrackedPr[] };
    const conn = await ctx.connection(config.connection, 'github');
    const items = await fetchPrs(conn, refs, ctx.signal, config);
    if (config.notify !== false) {
      notifyChanges(ctx, notifyScope('github-tracked', config), items, {
        key: (p) => `${p.owner}/${p.repo}#${p.number}`,
        sig: (p) => [p.state, p.reviewDecision ?? '', p.changesRequested, p.checks.state, `${p.checks.passed}/${p.checks.total}`].join('|'),
        title: 'Tracked pull requests',
        line: (p) => p.title,
        heading: (p, isNew) => (isNew ? 'New PR added' : prStatus(p.state, TRACKED_CI[p.checks.state])),
      });
    }
    return { items };
  },
  actions: {
    async track(payload, _config, ctx) {
      const input = (payload as { ref?: unknown } | null)?.ref;
      const ref = typeof input === 'string' ? parseTrackedPrRef(input) : null;
      if (!ref) throw invalid('tracked-pr-ref', 'Paste a GitHub pull request link or owner/repo#123.');
      await trackedStore(ctx.dataDir).update((s) =>
        s.refs.some((r) => sameRef(r, ref)) || s.refs.length >= MAX_TRACKED ? s : { refs: [...s.refs, ref] },
      );
      return null;
    },
    async untrack(payload, _config, ctx) {
      const ref = payload as PrRef;
      await trackedStore(ctx.dataDir).update((s) => ({ refs: s.refs.filter((r) => !sameRef(r, ref)) }));
      return null;
    },
  },
});

const LABEL_POOL_QUERY = `query {
  mine: search(query: "is:pr is:open author:@me", type: ISSUE, first: 50) { nodes { ... on PullRequest { repository { nameWithOwner } } } }
  review: search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 50) { nodes { ... on PullRequest { repository { nameWithOwner } } } }
}`;
const LABEL_REPOS = 12;

/** The labels of the repositories behind the user's open and review-requested PRs, sorted and unique. */
export async function fetchPrLabels(conn: ResolvedConnection, signal?: AbortSignal): Promise<string[]> {
  const pool = await graphql<Record<'mine' | 'review', { nodes: ({ repository?: { nameWithOwner: string } } | null)[] }>>(conn, LABEL_POOL_QUERY, {}, signal);
  const repos = [...new Set([...pool.mine.nodes, ...pool.review.nodes].flatMap((n) => (n?.repository?.nameWithOwner ? [n.repository.nameWithOwner] : [])))].slice(0, LABEL_REPOS);
  if (!repos.length) return [];
  const parts = repos.map((r, i) => {
    const [owner, name] = r.split('/');
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { labels(first: 100) { nodes { name } } }`;
  });
  const res = await graphql<Record<string, { labels?: { nodes?: ({ name: string } | null)[] } } | null>>(conn, `query { ${parts.join(' ')} }`, {}, signal);
  const names = new Set<string>();
  for (const v of Object.values(res)) for (const l of v?.labels?.nodes ?? []) if (l?.name) names.add(l.name);
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export const githubLabelsSource = defineSource<{ connection: string; [key: string]: unknown }>({
  id: 'github-labels',
  fields: LABELS_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const conn = await ctx.connection(config.connection, 'github');
    return { labels: await fetchPrLabels(conn, ctx.signal) };
  },
});

/** Server specs and data sources of the github panels (no React). */
export const specs: GridPanelSpec[] = [
  { kind: 'github-prs', fields: fields['github-prs'], allowMultiple: true },
  { kind: 'github-pr-query', fields: fields['github-pr-query'], allowMultiple: true },
  { kind: 'github-issues', fields: fields['github-issues'], allowMultiple: true },
  { kind: 'github-actions', fields: fields['github-actions'], allowMultiple: true },
  { kind: 'github-notifications', fields: fields['github-notifications'], allowMultiple: true },
  { kind: 'github-releases', fields: fields['github-releases'], allowMultiple: true },
  { kind: 'github-overview', fields: fields['github-overview'], allowMultiple: true },
  { kind: 'github-tracked', fields: fields['github-tracked'], allowMultiple: false },
];
export const sources: DataSource<any>[] = [
  githubPrsSource,
  githubPrQuerySource,
  githubIssuesSource,
  githubActionsSource,
  githubNotificationsSource,
  githubReleasesSource,
  githubOverviewSource,
  githubTrackedSource,
  githubLabelsSource,
];
