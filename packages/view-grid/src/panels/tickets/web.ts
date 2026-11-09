import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { backoffMs, nextUnchanged } from '../pods/refresh';
import { TICKETS_FIELDS } from './fields';
import { TicketsActions } from './TicketsActions';
import { TicketsPanel, type TicketsConfig } from './TicketsPanel';
import type { TicketsData } from './types';

/** Refreshes in a row that found the same data, and the last data. */
let unchanged = 0;
let lastSig = '';

const ticketsPanel = definePanel<TicketsConfig, TicketsData>({
  kind: 'tickets',
  title: 'dash.tickets.panel',
  description: 'dash.tickets.panel.description',
  icon: 'table',
  category: 'dash.category.core',
  size: { w: 16, h: 12, minW: 6, minH: 5 },
  config: { fields: TICKETS_FIELDS },
  load: async (config, ctx) => {
    const data = await fetchSource<TicketsData>('tickets', config, ctx.signal);
    const sig = JSON.stringify(data);
    unchanged = nextUnchanged(unchanged, lastSig === sig, ctx.auto);
    lastSig = sig;
    return data;
  },
  refreshMs: () => backoffMs(60_000, unchanged),
  pauseOffscreen: true,
  persist: true,
  allowMultiple: false,
  headerActions: TicketsActions,
  render: ({ id, config, data, refresh, side }) => createElement(TicketsPanel, { id, side, config, data, refresh }),
});

export const panels: AnyPanelKind[] = [ticketsPanel];
