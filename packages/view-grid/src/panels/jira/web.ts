import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { CountPanel, type CountConfig } from './Count';
import { IssuesPanel, type IssuesConfig } from './Issues';
import { SprintBoardPanel, type BoardConfig } from './SprintBoard';
import { BOARD_FIELDS, COUNT_FIELDS, ISSUES_FIELDS } from './fields';
import { refreshMs, type SprintData } from './map';
import type { CountData, IssuesData } from './server';

const issuesPanel = definePanel<IssuesConfig, IssuesData>({
  kind: 'jira-issues',
  title: 'dash.jira.panel.issues',
  description: 'dash.jira.panel.issues.description',
  icon: 'log',
  category: 'dash.category.jira',
  size: { w: 6, h: 14, minW: 4, minH: 6 },
  config: { fields: ISSUES_FIELDS },
  load: (config, ctx) => fetchSource<IssuesData>('jira-issues', config, ctx.signal),
  refreshMs: (config) => refreshMs(config.refreshMin),
  render: ({ id, config, data, side }) => createElement(IssuesPanel, { id, side, config, data }),
});

const countPanel = definePanel<CountConfig, CountData>({
  kind: 'jira-count',
  title: 'dash.jira.panel.count',
  description: 'dash.jira.panel.count.description',
  icon: 'search',
  category: 'dash.category.jira',
  size: { w: 4, h: 8, minW: 3, minH: 4 },
  config: { fields: COUNT_FIELDS },
  load: (config, ctx) => fetchSource<CountData>('jira-count', config, ctx.signal),
  refreshMs: (config) => refreshMs(config.refreshMin),
  render: ({ config, data }) => createElement(CountPanel, { config, data }),
});

const sprintPanel = definePanel<BoardConfig, SprintData | null>({
  kind: 'jira-sprint',
  title: 'dash.jira.panel.sprint',
  description: 'dash.jira.panel.sprint.description',
  icon: 'bookmark',
  category: 'dash.category.jira',
  size: { w: 10, h: 14, minW: 6, minH: 8 },
  config: { fields: BOARD_FIELDS },
  load: (config, ctx) => (config.boardId ? fetchSource<SprintData | null>('jira-sprint', config, ctx.signal) : Promise.resolve(null)),
  refreshMs: (config) => refreshMs(config.refreshMin),
  render: ({ id, config, data, configure, side }) => createElement(SprintBoardPanel, { id, side, config, data, configure }),
});

/** The jira panel kinds. */
export const panels: AnyPanelKind[] = [issuesPanel, countPanel, sprintPanel];
