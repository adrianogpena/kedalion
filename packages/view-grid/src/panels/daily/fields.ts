import type { PanelField } from '@kedalion/ui/grid';

export const TODO_FIELDS: readonly PanelField[] = [
  { key: 'filter', kind: 'string', default: '', label: 'dash.daily.todo.filter', description: 'dash.daily.todo.filter.hint', placeholder: 'today | overdue', maxLength: 200 },
];
