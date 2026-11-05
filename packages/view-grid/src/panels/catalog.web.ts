import type { AnyPanelKind } from '../panel';
import { clockPanel } from './clock';
import { panels as calendar } from './calendar/web';
import { panels as daily } from './daily/web';
import { panels as containers } from './containers/web';
import { panels as feeds } from './feeds/web';
import { panels as formatters } from './formatters/web';
import { panels as github } from './github/web';
import { panels as jira } from './jira/web';
import { panels as meeting } from './meeting/web';
import { panels as misc } from './misc/web';
import { panels as pods } from './pods/web';
import { panels as tickets } from './tickets/web';
import { panels as spellcheck } from './spellcheck/web';
import { panels as spotify } from './spotify/web';
import { panels as timesheet } from './timesheet/web';

/** Every panel kind of the Dashboard view. */
export const dashboardPanels: readonly AnyPanelKind[] = [
  clockPanel, ...github, ...jira, ...calendar, ...feeds, ...misc,
  ...tickets, ...pods, ...containers, ...timesheet, ...meeting, ...daily, ...spotify, ...spellcheck, ...formatters,
];
