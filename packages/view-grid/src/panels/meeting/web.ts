import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { MeetingActions } from './MeetingActions';
import { MeetingPanel, type MeetingConfig } from './MeetingPanel';
import type { Meeting } from './model';

const meetingPanel = definePanel<MeetingConfig, Meeting>({
  kind: 'meeting',
  title: 'dash.meeting.panel',
  description: 'dash.meeting.panel.description',
  icon: 'check',
  category: 'dash.category.daily',
  size: { w: 6, h: 10, minW: 3, minH: 4 },
  load: (config, ctx) => fetchSource<Meeting>('meeting', config, ctx.signal),
  refreshMs: 60_000,
  allowMultiple: false,
  headerActions: MeetingActions,
  render: ({ config, data, refresh }) => createElement(MeetingPanel, { config, data, refresh }),
});

export const panels: AnyPanelKind[] = [meetingPanel];
