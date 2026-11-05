import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { FormattersPanel } from './FormattersPanel';

const formattersPanel = definePanel({
  kind: 'formatters',
  title: 'dash.fmt.panel',
  description: 'dash.fmt.panel.description',
  icon: 'braces',
  category: 'dash.category.misc',
  size: { w: 8, h: 16, minW: 4, minH: 8 },
  config: { fields: [] },
  allowMultiple: true,
  render: () => createElement(FormattersPanel),
});

/** The JSON and XML formatters panel kind. */
export const panels: AnyPanelKind[] = [formattersPanel];
