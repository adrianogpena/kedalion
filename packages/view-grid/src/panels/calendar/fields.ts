import type { PanelField } from '@kedalion/ui/grid';

const icsUrl: PanelField = { key: 'icsUrl', kind: 'string', label: 'dash.calendar.icsUrl', description: 'dash.calendar.icsUrl.hint', placeholder: 'dash.calendar.icsUrl.placeholder', default: '', maxLength: 2000 };

const sprintFields: readonly PanelField[] = [
  { key: 'sprintStart', kind: 'date', label: 'dash.calendar.sprintStart', description: 'dash.calendar.sprintStart.hint', default: '' },
  { key: 'sprintLengthDays', kind: 'number', label: 'dash.calendar.sprintLengthDays', default: 14, min: 1, max: 60 },
  { key: 'cutoffDays', kind: 'number', label: 'dash.calendar.cutoffDays', description: 'dash.calendar.cutoffDays.hint', default: 0, min: 0, max: 60 },
  { key: 'cutoffLabel', kind: 'string', label: 'dash.calendar.cutoffLabel', description: 'dash.calendar.cutoffLabel.hint', default: '', maxLength: 30 },
];

export const CALENDAR_FIELDS: readonly PanelField[] = [
  { key: 'layout', kind: 'enum', label: 'dash.calendar.layout', default: 'month', values: ['month', 'twoWeeks', 'week'], optionLabel: 'dash.calendar.layout' },
  { key: 'weekStart', kind: 'enum', label: 'dash.calendar.weekStart', default: 'mon', values: ['mon', 'sun'], optionLabel: 'dash.calendar.weekStart' },
  { key: 'showWeekNumbers', kind: 'boolean', label: 'dash.calendar.showWeekNumbers', default: false },
  icsUrl,
  { key: 'upcoming', kind: 'number', label: 'dash.calendar.upcoming', description: 'dash.calendar.upcoming.hint', default: 5, min: 0, max: 20 },
  ...sprintFields,
  { key: 'markedDates', kind: 'text', label: 'dash.calendar.markedDates', description: 'dash.calendar.datedLines.hint', default: '', rows: 4, placeholder: 'dash.calendar.datedLines.placeholder' },
];

export const SPRINT_FIELDS: readonly PanelField[] = [
  ...sprintFields,
  { key: 'namePattern', kind: 'string', label: 'dash.calendar.namePattern', description: 'dash.calendar.namePattern.hint', default: 'Sprint {n}', maxLength: 60 },
  { key: 'layout', kind: 'enum', label: 'dash.calendar.layout', default: 'row', values: ['row', 'weeks'], optionLabel: 'dash.calendar.layout' },
];

export const COUNTDOWNS_FIELDS: readonly PanelField[] = [
  { key: 'items', kind: 'text', label: 'dash.calendar.items', default: '', dated: true },
  { key: 'showPast', kind: 'boolean', label: 'dash.calendar.showPast', default: false },
  { key: 'layout', kind: 'enum', label: 'dash.calendar.layout', default: 'list', values: ['list', 'tiles'], optionLabel: 'dash.calendar.layout' },
];

export const AGENDA_FIELDS: readonly PanelField[] = [
  icsUrl,
  { key: 'days', kind: 'number', label: 'dash.calendar.days', description: 'dash.calendar.days.hint', default: 7, min: 1, max: 30 },
  { key: 'showLocation', kind: 'boolean', label: 'dash.calendar.showLocation', default: true },
  { key: 'layout', kind: 'enum', label: 'dash.calendar.layout', default: 'list', values: ['list', 'compact'], optionLabel: 'dash.calendar.layout' },
];

/** What a panel sends to the `calendar-ics` source: the URL and the window (`from` empty means today). */
export const ICS_SOURCE_FIELDS: readonly PanelField[] = [
  icsUrl,
  { key: 'from', kind: 'date', label: 'dash.calendar.from', default: '' },
  { key: 'days', kind: 'number', label: 'dash.calendar.days', default: 30, min: 1, max: 62 },
];

/** Config field lists of the calendar panels (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = {
  calendar: CALENDAR_FIELDS,
  sprint: SPRINT_FIELDS,
  countdowns: COUNTDOWNS_FIELDS,
  agenda: AGENDA_FIELDS,
};
