import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { IssuesPanel, type IssuesConfig } from './Issues';
import { PullRequestsPanel, type PullRequestsConfig } from './PullRequests';
import { ActionsRunsPanel, type ActionsConfig } from './ActionsRuns';
import { NotificationsPanel, type NotificationsConfig } from './Notifications';
import { ReleasesPanel, type ReleasesConfig } from './Releases';
import { RepoOverviewPanel, type OverviewConfig } from './RepoOverview';
import { TrackedPrsPanel, type TrackedConfig } from './TrackedPrsPanel';
import type { TrackedPr } from './tracked';
import { ACTIONS_FIELDS, ISSUES_FIELDS, NOTIFICATIONS_FIELDS, OVERVIEW_FIELDS, PULL_REQUESTS_FIELDS, PR_QUERY_FIELDS, RELEASES_FIELDS, TRACKED_FIELDS } from './fields';
import { runsRefreshMs, type NotificationItem, type ReleaseItem, type RepoStats, type RunsData } from './more';
import { PR_REFRESH_MS, searchRefreshMs,type IssueItem, type PrItem, type SearchData } from './map';

const prsPanel = definePanel<PullRequestsConfig, SearchData<PrItem>>({
  kind: 'github-prs',
  persist: true,
  title: 'dash.github.panel.prs',
  description: 'dash.github.panel.prs.description',
  icon: 'link',
  category: 'dash.category.github',
  size: { w: 8, h: 14, minW: 4, minH: 6 },
  config: { fields: PULL_REQUESTS_FIELDS },
  load: (config, ctx) => fetchSource<SearchData<PrItem>>('github-prs', config, ctx.signal),
  refreshMs: (_config, data) => searchRefreshMs(data),
  render: ({ id, config, data, side }) => createElement(PullRequestsPanel, { id, config, data, side }),
});

const prQueryPanel = definePanel<PullRequestsConfig, SearchData<PrItem>>({
  kind: 'github-pr-query',
  persist: true,
  title: 'dash.github.panel.prq',
  description: 'dash.github.panel.prq.description',
  icon: 'link',
  category: 'dash.category.github',
  size: { w: 8, h: 14, minW: 4, minH: 6 },
  config: { fields: PR_QUERY_FIELDS },
  load: (config, ctx) => fetchSource<SearchData<PrItem>>('github-pr-query', config, ctx.signal),
  refreshMs: (_config, data) => searchRefreshMs(data),
  render: ({ id, config, data, side }) => createElement(PullRequestsPanel, { id, config, data, side }),
});

const issuesPanel =definePanel<IssuesConfig, SearchData<IssueItem>>({
  kind: 'github-issues',
  title: 'dash.github.panel.issues',
  description: 'dash.github.panel.issues.description',
  icon: 'log',
  category: 'dash.category.github',
  size: { w: 8, h: 14, minW: 4, minH: 6 },
  config: { fields: ISSUES_FIELDS },
  load: (config, ctx) => fetchSource<SearchData<IssueItem>>('github-issues', config, ctx.signal),
  refreshMs: (_config, data) => searchRefreshMs(data),
  render: ({ config, data }) => createElement(IssuesPanel, { config, data }),
});

const actionsPanel = definePanel<ActionsConfig, RunsData>({
  kind: 'github-actions',
  title: 'dash.github.panel.actions',
  description: 'dash.github.panel.actions.description',
  icon: 'play',
  category: 'dash.category.github',
  size: { w: 8, h: 12, minW: 4, minH: 5 },
  config: { fields: ACTIONS_FIELDS },
  load: (config, ctx) => fetchSource<RunsData>('github-actions', config, ctx.signal),
  refreshMs: (_config, data) => runsRefreshMs(data),
  render: ({ config, data }) => createElement(ActionsRunsPanel, { config, data }),
});

const notificationsPanel = definePanel<NotificationsConfig, { items: NotificationItem[] }>({
  kind: 'github-notifications',
  title: 'dash.github.panel.notifications',
  description: 'dash.github.panel.notifications.description',
  icon: 'bell',
  category: 'dash.category.github',
  size: { w: 6, h: 12, minW: 4, minH: 5 },
  config: { fields: NOTIFICATIONS_FIELDS },
  load: (config, ctx) => fetchSource<{ items: NotificationItem[] }>('github-notifications', config, ctx.signal),
  refreshMs: 5 * 60_000,
  render: ({ config, data }) => createElement(NotificationsPanel, { config, data }),
});

const releasesPanel = definePanel<ReleasesConfig, { items: ReleaseItem[] }>({
  kind: 'github-releases',
  title: 'dash.github.panel.releases',
  description: 'dash.github.panel.releases.description',
  icon: 'download',
  category: 'dash.category.github',
  size: { w: 6, h: 10, minW: 4, minH: 5 },
  config: { fields: RELEASES_FIELDS },
  load: (config, ctx) => fetchSource<{ items: ReleaseItem[] }>('github-releases', config, ctx.signal),
  refreshMs: 30 * 60_000,
  render: ({ data }) => createElement(ReleasesPanel, { data }),
});

const overviewPanel = definePanel<OverviewConfig, RepoStats>({
  kind: 'github-overview',
  title: 'dash.github.panel.overview',
  description: 'dash.github.panel.overview.description',
  icon: 'folder-git',
  category: 'dash.category.github',
  size: { w: 8, h: 6, minW: 4, minH: 4 },
  config: { fields: OVERVIEW_FIELDS },
  load: (config, ctx) => fetchSource<RepoStats>('github-overview', config, ctx.signal),
  refreshMs: 10 * 60_000,
  render: ({ config, data }) => createElement(RepoOverviewPanel, { config, data }),
});

const trackedPanel = definePanel<TrackedConfig, { items: TrackedPr[] }>({
  kind: 'github-tracked',
  persist: true,
  title: 'dash.github.panel.tracked',
  description: 'dash.github.panel.tracked.description',
  icon: 'pin',
  category: 'dash.category.github',
  allowMultiple: false,
  size: { w: 8, h: 12, minW: 4, minH: 5 },
  config: { fields: TRACKED_FIELDS },
  load: (config, ctx) => fetchSource<{ items: TrackedPr[] }>('github-tracked', config, ctx.signal),
  refreshMs: PR_REFRESH_MS,
  render: ({ config, data, refresh }) => createElement(TrackedPrsPanel, { config, data, refresh }),
});

/** The github panel kinds. */
export const panels: AnyPanelKind[] = [prsPanel, prQueryPanel, issuesPanel, actionsPanel, notificationsPanel, releasesPanel, overviewPanel, trackedPanel];
