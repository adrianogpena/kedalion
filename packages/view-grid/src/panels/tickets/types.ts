import type { TrackedPr } from '../github/tracked';
import type { Pod } from '../pods/model';
import type { JiraInfo } from './jira-info';
import type { Ticket } from './model';

export type Stage = 'none' | 'ok' | 'pending' | 'warn' | 'fail';

/** What the linker knows about a ticket: its branch, PRs, and pods. */
export interface TicketLink {
  stages: { branch: Stage; pr: Stage; pods: Stage };
  branches: string[];
  prs: TrackedPr[];
  pods: Pod[];
  /** Ids (`podId`) of the pods linked by hand. */
  manualPods: string[];
}

/** A key found in PRs or pods that is not on the board. */
export interface UnlinkedKey {
  key: string;
  scopes: string[];
  prs: TrackedPr[];
  pods: Pod[];
}

export interface TicketsData {
  statuses: string[];
  tickets: Ticket[];
  links?: Record<string, TicketLink>;
  unlinked?: UnlinkedKey[];
  /** Hidden unlinked keys that still show up in PRs or pods. */
  ignored?: string[];
  /** Every pod tracked in the Pods panels, for linking by hand. */
  pods?: Pod[];
  /** Jira info per ticket key; empty without a Jira connection or when the fetch failed. */
  jira?: Record<string, JiraInfo>;
  /** The PR fetch failed: links carry no PRs. */
  prError?: boolean;
}
