import type { ComponentType } from 'react';
import type { IconName } from '@kedalion/ui';
import type { AgentsMessageKey } from '../../i18n';

/** Every tool of the Agents view; each has a folder `panels/<kind>/` exporting a `PanelModule` named `panel`. */
export const PANEL_KINDS = ['agent', 'changes', 'diff', 'review', 'usage', 'run', 'scratchpad', 'code', 'task', 'notes', 'trajectory', 'output', 'activity'] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** The params of a panel (agent session id and terminal hint; diff path; tool params). */
export type PanelParams = Record<string, unknown>;

export type Placement = 'center' | 'sidebar' | 'both';

export interface OpenOptions {
  /** Where the panel docks; default: the panel's own (`center` for `both`). */
  placement?: 'center' | 'sidebar';
}

/** What a panel (and a command) can do to the workspace of its project. */
export interface WorkspaceApi {
  /**
   * Shows a panel in the center and returns its id (the kind). A tool replaces the center content until it is closed or
   * a session is selected; opening an `agent` shows that session. With `placement: 'sidebar'` the sidebar card is shown.
   */
  open(kind: PanelKind, params?: PanelParams, opts?: OpenOptions): string;
  /** Shows or hides the Changes panel docked at the right of the session view. */
  toggleSide(): void;
  /** Docks a panel in the right column (added if not there). */
  moveToSide(kind: PanelKind): void;
  /** Closes the tool with that id (its kind), going back to the previous tool or the session. */
  close(id: string): void;
  /** Inserts text into the Claude session's terminal (no Enter). */
  sendToSession(sessionId: string, text: string): void;
  /** Folder of the project the workspace belongs to; undefined when none is selected. */
  activeProject: string | undefined;
}

export interface PanelProps {
  /** Folder of the project this workspace belongs to. */
  project: string;
  params: PanelParams;
  api: WorkspaceApi;
  /** Id of the panel (its kind): `api.close(tabId)` closes itself. */
  tabId: string;
  /** The panel is the one shown in the center and its workspace is the shown one. */
  visible: boolean;
  /** Same as `visible`. */
  focused: boolean;
  /** Merges `patch` into the panel's params (a `undefined` value removes the key). */
  update(patch: PanelParams): void;
  /** Id of the Claude session the workspace shows; undefined when none. */
  sessionId?: string;
}

export interface SectionProps {
  /** Folder of the selected project; undefined when none. */
  project: string | undefined;
  api: WorkspaceApi;
  /** Id of the Claude session shown (selected); undefined when none. */
  sessionId?: string;
}

/** A shortcut a panel adds: `key` is the default chord (e.g. `Ctrl+Shift+G`). */
export interface PanelCommand {
  id: string;
  key: string;
  run(api: WorkspaceApi): void;
}

export interface PanelModule {
  kind: PanelKind;
  /** Message key of the panel title. */
  titleKey: AgentsMessageKey;
  icon: IconName;
  /** The center component. */
  Panel: ComponentType<PanelProps>;
  /** Body of the sidebar card (placement `sidebar` or `both`). */
  Section?: ComponentType<SectionProps>;
  placement: Placement;
  /** One instance anywhere: opening it again focuses the open one. */
  single?: boolean;
  commands?: PanelCommand[];
  /** Not built yet. Drop it when the panel is real. */
  comingSoon?: boolean;
}
