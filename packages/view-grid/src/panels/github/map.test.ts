import { describe, expect, test } from 'bun:test';
import { buildQuery, ciLabelKey, countChecks, mergeReadiness, mapApprovals, mapCheckList, mapIssues, mapPullRequests, nextRefreshMs, reduceChecks, searchRefreshMs, ticketKey, withExpected } from './map';

describe('buildQuery', () => {
  test('fixed modes', () => {
    expect(buildQuery('pr', 'mine', '', '')).toBe('is:pr is:open author:@me');
    expect(buildQuery('pr', 'closed', '', '')).toBe('is:pr is:closed author:@me sort:updated-desc');
    expect(buildQuery('issue', 'assigned', '', '')).toBe('is:issue is:open assignee:@me');
  });
  test('repo mode needs owner/name', () => {
    expect(buildQuery('pr', 'repo', 'a/b', '')).toBe('is:pr is:open repo:a/b');
    expect(buildQuery('issue', 'repo', 'a/b', '')).toBe('is:issue is:open repo:a/b');
    expect(buildQuery('pr', 'repo', '', '')).toBeNull();
    expect(buildQuery('pr', 'repo', 'nope', '')).toBeNull();
  });
  test('custom query gets the type prefix once', () => {
    expect(buildQuery('pr', 'custom', '', 'org:x label:bug')).toBe('is:pr org:x label:bug');
    expect(buildQuery('pr', 'custom', '', 'is:pr org:x')).toBe('is:pr org:x');
    expect(buildQuery('pr', 'custom', '', ' ')).toBeNull();
  });
});

describe('reduceChecks', () => {
  test('states', () => {
    expect(reduceChecks(null)).toEqual({ state: 'none', failing: [] });
    expect(reduceChecks({ state: 'SUCCESS' })).toEqual({ state: 'pass', failing: [] });
    expect(reduceChecks({ state: 'PENDING' }).state).toBe('pending');
  });
  test('failing names', () => {
    const r = reduceChecks({
      state: 'FAILURE',
      contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }, { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci/x', state: 'ERROR' }] },
    });
    expect(r).toEqual({ state: 'fail', failing: ['build', 'ci/x'] });
  });
  test('a failure is pending while a check runs, ignoring policy-bot', () => {
    const failed = { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' } as const;
    const policy = { __typename: 'StatusContext', context: 'policy-bot: master', state: 'PENDING' } as const;
    const running = { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' } as const;
    expect(reduceChecks({ state: 'FAILURE', contexts: { nodes: [failed, running, policy] } }).state).toBe('pending');
    expect(reduceChecks({ state: 'FAILURE', contexts: { nodes: [failed, policy] } }).state).toBe('fail');
  });
  test('only policy-bot pending gives the policy state', () => {
    const policy = { __typename: 'StatusContext', context: 'policy-bot: master', state: 'PENDING' } as const;
    const ok = { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' } as const;
    const running = { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' } as const;
    expect(reduceChecks({ state: 'PENDING', contexts: { nodes: [ok, policy] } }).state).toBe('policy');
    expect(reduceChecks({ state: 'PENDING', contexts: { nodes: [ok, policy, running] } }).state).toBe('pending');
  });
});

describe('countChecks', () => {
  test('counts by outcome', () => {
    const done = { status: 'COMPLETED' };
    const r = countChecks({
      state: 'PENDING',
      contexts: {
        nodes: [
          { __typename: 'CheckRun', name: 'a', ...done, conclusion: 'SUCCESS', completedAt: '1' },
          { __typename: 'CheckRun', name: 'a', ...done, conclusion: 'SUCCESS', completedAt: '2' },
          { __typename: 'CheckRun', name: 's', ...done, conclusion: 'SKIPPED' },
          { __typename: 'CheckRun', name: 'b', status: 'IN_PROGRESS', conclusion: null },
          { __typename: 'CheckRun', name: 'c', ...done, conclusion: 'FAILURE' },
          { __typename: 'StatusContext', context: 'x', state: 'PENDING' },
        ],
      },
    });
    expect(r).toEqual({ passed: 2, failed: 1, pending: 2, total: 5 });
    expect(countChecks(null).total).toBe(0);
  });
});

describe('mapCheckList', () => {
  test('latest run per name, failures first, with workflow, times and note', () => {
    const wf = (name: string) => ({ workflowRun: { workflow: { name } } });
    const list = mapCheckList({
      contexts: {
        nodes: [
          { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', detailsUrl: 'u1', checkSuite: wf('CI') },
          { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-01-01T01:00:00Z', completedAt: '2026-01-01T01:02:00Z', detailsUrl: 'u2', checkSuite: wf('CI'), title: 'Tests failed', summary: 'x' },
          { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', startedAt: '2026-01-01T01:00:00Z' },
          { __typename: 'StatusContext', context: 'ci/x', state: 'SUCCESS', targetUrl: 'u3', description: 'ok' },
          null,
        ],
      },
    });
    expect(list.map((c) => [c.name, c.state])).toEqual([['build', 'failure'], ['lint', 'pending'], ['ci/x', 'success']]);
    expect(list[0]).toMatchObject({ workflow: 'CI', url: 'u2', startedAt: '2026-01-01T01:00:00Z', completedAt: '2026-01-01T01:02:00Z', note: 'Tests failed' });
    expect(list[2]).toMatchObject({ url: 'u3', note: 'ok' });
    expect(mapCheckList(null)).toEqual([]);
  });
});

describe('mapApprovals', () => {
  const reviews = [
    { state: 'APPROVED', author: { login: 'levi' }, commit: { oid: 'old' } },
    { state: 'APPROVED', author: { login: 'ann' }, commit: { oid: 'head' } },
    { state: 'CHANGES_REQUESTED', author: { login: 'bob' }, commit: { oid: 'head' } },
  ];

  test('splits approvals by the head commit', () => {
    expect(mapApprovals(reviews, 'head', 'sofico-codebase/miles-vwde-ubc')).toEqual({ current: ['ann'], outdated: ['levi'] });
  });

  test('approvals never go outdated in miles-core, miles-ria and miles-mmc', () => {
    for (const repo of ['miles-core', 'miles-ria', 'miles-mmc']) {
      expect(mapApprovals(reviews, 'head', `sofico-codebase/${repo}`)).toEqual({ current: ['levi', 'ann'], outdated: [] });
    }
  });
});

describe('withExpected', () => {
  test('adds a required context the rollup lacks as policy pending', () => {
    const rollup = { state: 'PENDING', contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] } };
    const list = mapCheckList(withExpected(rollup, ['build', 'policy-bot: master']));
    expect(list.map((d) => `${d.name}:${d.state}`).sort()).toEqual(['build:success', 'policy-bot: master:pending']);
    expect(reduceChecks(withExpected(rollup, ['build', 'policy-bot: master'])).state).toBe('policy');
  });
});

describe('ticketKey', () => {
  test('title first, then branch', () => {
    expect(ticketKey('ABC-12 fix', 'feat/XYZ-3', '')).toBe('ABC-12');
    expect(ticketKey('fix', 'feat/XYZ-3-thing', '')).toBe('XYZ-3');
    expect(ticketKey('fix', 'main', '')).toBe('');
  });
  test('bad pattern falls back to the default', () => {
    expect(ticketKey('ABC-1', '', '(')).toBe('ABC-1');
  });
});

describe('nextRefreshMs', () => {
  test('ok quota gives nothing', () => expect(nextRefreshMs({ remaining: 500, limit: 5000 }, 300_000)).toBeUndefined());
  test('low quota doubles up to 15 min', () => {
    expect(nextRefreshMs({ remaining: 10, limit: 5000 }, 300_000)).toBe(600_000);
    expect(nextRefreshMs({ remaining: 10, limit: 5000 }, 300_000, 600_000)).toBe(900_000);
    expect(nextRefreshMs({ remaining: 10, limit: 5000 }, 300_000, 900_000)).toBe(900_000);
  });
});

describe('mapping', () => {
  test('pull requests', () => {
    const d = mapPullRequests(
      {
        search: {
          issueCount: 7,
          nodes: [
            null,
            { number: 3, url: 'u3', title: 'ABC-9 x', isDraft: true, state: 'OPEN', headRefName: 'b', reviewDecision: 'APPROVED', author: { login: 'me' }, repository: { nameWithOwner: 'a/b' }, labels: { nodes: [{ name: 'bug' }] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, updatedAt: 't', createdAt: 'c', additions: 5, deletions: 2, changedFiles: 3, mergeable: 'CONFLICTING', baseRefName: 'main', autoMergeRequest: { enabledAt: 'x' }, comments: { nodes: [{ author: { login: 'bot', __typename: 'Bot' } }, { author: { login: 'copilot-pull-request-reviewer', __typename: 'Bot' } }] }, reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: 'rev', __typename: 'User' } }] } }, { isResolved: true, comments: { nodes: [{ author: { login: 'me', __typename: 'User' } }] } }] } },
          ],
        },
      },
      '',
    );
    expect(d.total).toBe(7);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ draft: true, review: 'approved', ci: 'pass', ticket: 'ABC-9', labels: ['bug'], repo: 'a/b' });
    expect(d.items[0]).toMatchObject({ createdAt: 'c', additions: 5, deletions: 2, files: 3, conflicts: true, base: 'main', autoMerge: true, comments: 2, threads: 1, linked: true, checkList: [] });
  });
  test('issues', () => {
    const d = mapIssues({ search: { nodes: [{ number: 1, url: 'u', title: 't', comments: { totalCount: 4 }, assignees: { nodes: [{ login: 'z' }] }, milestone: { title: 'M' } }] } });
    expect(d.items[0]).toMatchObject({ comments: 4, assignees: ['z'], milestone: 'M' });
  });
});

describe('searchRefreshMs', () => {
  test('5 min, 60 s while pending, never below 60 s', () => {
    expect(searchRefreshMs({ items: [{ ci: 'pass' }] })).toBe(300_000);
    expect(searchRefreshMs({ items: [{ ci: 'pending' }] })).toBe(60_000);
    expect(searchRefreshMs({ items: [{ ci: 'pending' }], nextRefreshMs: 600_000 })).toBe(600_000);
  });
});

describe('merge readiness label', () => {
  const pr = (ci: 'pass' | 'fail' | 'pending' | 'policy', status: string) => ({ ci, merge: mergeReadiness(status), state: 'open', draft: false });
  test('checks state wins, then Blocked, then Ready to Merge', () => {
    expect(ciLabelKey(pr('pending', 'BLOCKED'))).toBe('pending');
    expect(ciLabelKey(pr('fail', 'BLOCKED'))).toBe('fail');
    expect(ciLabelKey(pr('policy', 'BLOCKED'))).toBe('policy');
    expect(ciLabelKey(pr('pass', 'BLOCKED'))).toBe('blocked');
    expect(ciLabelKey(pr('pass', 'CLEAN'))).toBe('ready');
    expect(ciLabelKey(pr('pass', 'BEHIND'))).toBe('pass');
  });
});
