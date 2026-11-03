import { defineView, DossierPage } from '@kedalion/ui';
import { en as gridEn, ptBR as gridPtBR } from '../i18n';
import type { AnyPanelKind } from '../panel';
import { en as calendarEn, ptBR as calendarPtBR } from '../panels/calendar/i18n';
import { en as feedsEn, ptBR as feedsPtBR } from '../panels/feeds/i18n';
import { en as githubEn, ptBR as githubPtBR } from '../panels/github/i18n';
import { en as jiraEn, ptBR as jiraPtBR } from '../panels/jira/i18n';
import { en as miscEn, ptBR as miscPtBR } from '../panels/misc/i18n';
import { en as containersEn, ptBR as containersPtBR } from '../panels/containers/i18n';
import { en as meetingEn, ptBR as meetingPtBR } from '../panels/meeting/i18n';
import { en as dailyEn, ptBR as dailyPtBR } from '../panels/daily/i18n';
import { en as spotifyEn, ptBR as spotifyPtBR } from '../panels/spotify/i18n';
import { en as spellEn, ptBR as spellPtBR } from '../panels/spellcheck/i18n';
import { en as podsEn, ptBR as podsPtBR } from '../panels/pods/i18n';
import { en as ticketsEn, ptBR as ticketsPtBR } from '../panels/tickets/i18n';
import { en as timesheetEn, ptBR as timesheetPtBR } from '../panels/timesheet/i18n';
import { dashboardCommands } from './commands';
import { DashboardScreen, type DashboardViewSettings } from './DashboardScreen';
import { en, ptBR } from './i18n';

export interface DashboardViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The panel kinds the user can add (`dashboardPanels`). */
  panels: readonly AnyPanelKind[];
}

export function dashboardView({ group, order, panels }: DashboardViewOptions) {
  return defineView<'dashboard', DashboardViewSettings, 'nav.dashboard'>({
    id: 'dashboard',
    nav: { group, icon: 'cube', label: 'nav.dashboard', order },
    render: ({ settings, onSave, go }) => (
      <DossierPage chapter="cover" go={go}>
        <DashboardScreen settings={settings} onSave={onSave} panels={panels} />
      </DossierPage>
    ),
    commands: dashboardCommands,
    messages: {
      en: { ...gridEn, ...en, ...githubEn, ...jiraEn, ...calendarEn, ...feedsEn, ...miscEn, ...ticketsEn, ...podsEn, ...containersEn, ...timesheetEn, ...meetingEn, ...dailyEn, ...spotifyEn, ...spellEn },
      'pt-BR': { ...gridPtBR, ...ptBR, ...githubPtBR, ...jiraPtBR, ...calendarPtBR, ...feedsPtBR, ...miscPtBR, ...ticketsPtBR, ...podsPtBR, ...containersPtBR, ...timesheetPtBR, ...meetingPtBR, ...dailyPtBR, ...spotifyPtBR, ...spellPtBR },
    },
  });
}
