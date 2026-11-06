import { copyNotify, IconButton, type SidePanelContent } from '@kedalion/ui';
import { tKey } from '../../i18n';
import type { JiraInfo } from './jira-info';
import type { TrackedPr } from '../github/tracked';
import type { Pod } from '../pods/model';
import type { Ticket } from './model';
import { jiraUrl } from './TicketCard';
import { TicketNotesTabs } from './TicketNotesTabs';
import { TicketOverview } from './TicketOverview';
import type { TicketLink, TicketsData } from './types';
import type { PanelSide } from '../../panel';
import { trackedPrSideContent } from '../github/PrSide';
import type { PodsConfig } from '../pods/PodsPanel';
import { podSideContent } from '../pods/PodSide';

export interface TicketSideInput {
  instanceId: string;
  ticket: Ticket;
  link?: TicketLink;
  jira?: JiraInfo;
  allPods: Pod[];
  config: Record<string, unknown> & { jiraBaseUrl: string };
  onChanged(): void;
  onOpenPr(pr: TrackedPr): void;
  onOpenPod(pod: Pod): void;
}

/**
 * The side content of a board ticket with its PR and pod drill-downs, for the Tickets panel and for panels that
 * open a board ticket (Timesheet). `instanceId` is the opening panel's id: the dashboard closes side content of
 * panels that are not on the shown layout.
 */
export function boardTicketSide({ instanceId, ticket, data, config, side, onChanged }: {
  instanceId: string;
  ticket: Ticket;
  data: TicketsData;
  config: TicketSideInput['config'];
  side?: PanelSide;
  onChanged(): void;
}): SidePanelContent {
  return ticketSideContent({ instanceId, ticket, link: data.links?.[ticket.key], jira: data.jira?.[ticket.key], allPods: data.pods ?? [], config, onChanged,
    onOpenPr: (pr) => side?.push(trackedPrSideContent({ instanceId, pr, config })),
    onOpenPod: (pod) => side?.push(podSideContent({ instanceId, pod, config: { clusters: `${pod.context} ${pod.namespace} *` } as PodsConfig })),
  });
}

/** What the Tickets panel opens in the Dashboard side panel for one ticket. */
export function ticketSideContent({ instanceId, ticket, link, jira, allPods, config, onChanged, onOpenPr, onOpenPod }: TicketSideInput): SidePanelContent {
  const url = jiraUrl(config.jiraBaseUrl, ticket.key);
  return {
    id: `${instanceId}:${ticket.id}`,
    title: ticket.key,
    subtitle: ticket.status,
    icon: 'table',
    tabs: [
      {
        id: 'overview',
        label: tKey('dash.pods.tab.overview'),
        render: () => <TicketOverview ticket={ticket} link={link} jira={jira} allPods={allPods} config={config} onChanged={onChanged} onOpenPr={onOpenPr} onOpenPod={onOpenPod} />,
      },
      { id: 'notes', label: tKey('dash.tickets.tab.notes'), render: () => <TicketNotesTabs ticketId={ticket.id} config={config} vars={{ key: ticket.key, title: jira?.summary ?? '', url }} /> },
    ],
    actions: (
      <>
        <IconButton icon="copy" label={tKey('dash.tickets.copyKey')} onClick={() => void copyNotify(ticket.key)} />
        {url && <IconButton icon="link" label={tKey('dash.tickets.openJira')} onClick={() => window.open(url, '_blank', 'noreferrer')} />}
      </>
    ),
  };
}
