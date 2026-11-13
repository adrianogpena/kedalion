import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ContextMenu, type ContextMenuItem, Icon } from '@kedalion/ui';
import { t } from '../../i18n';
import { EmptyCard } from './EmptyCard';
import { useAgentsHost } from './host';
import { MissingPanel } from './MissingPanel';
import { PanelBoundary } from './PanelBoundary';
import { SectionButton } from '../SidebarSection';
import { isDockable, setDocked } from '../sidebar-sections';
import { PANELS, panelOf } from './registry';
import { useRightSide } from './use-right-side';
import type { OpenOptions, PanelKind, PanelParams, PanelProps, WorkspaceApi } from './types';

/** What the screen can do to one project's workspace. */
export interface WorkspaceHandle {
  api: WorkspaceApi;
  /** Shows the session's agent panel (replacing any open tool); `terminal` hints the pty to attach to; `trajectory` then shows its Trajectory over it. */
  openAgent(sessionId: string, opts?: { terminal?: string; trajectory?: boolean }): void;
  /** Kind of the tool shown over the session, if any. */
  tool(): PanelKind | undefined;
  /** Drops the session's agent panel, if it is the shown one. */
  closeAgent(sessionId: string): void;
}

export interface ProjectWorkspaceProps {
  /** Folder of the project. */
  project: string;
  /** Another project's workspace is shown; this one stays mounted. */
  hidden: boolean;
  /** Told when the handle is ready and null when the workspace goes. */
  register(project: string, handle: WorkspaceHandle | null): void;
  /** Told, while shown, the Claude session the workspace shows (undefined: none). */
  onFocusedAgent(project: string, sessionId: string | undefined): void;
}

interface AgentView {
  sessionId: string;
  terminal?: string;
  /** "Show on session" request from the Trajectory (see `StepFocus`). */
  focus?: PanelParams;
  /** Changes when another session is shown, so the panel remounts; a `/clear` follow keeps it. */
  nonce: number;
}

interface Tool {
  kind: PanelKind;
  params: PanelParams;
}

/** One project's center: the selected session's agent panel, or a tool opened over it until the next selection. */
export function ProjectWorkspace({ project, hidden, register, onFocusedAgent }: ProjectWorkspaceProps) {
  const host = useAgentsHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const [agent, setAgent] = useState<AgentView>();
  const [tools, setTools] = useState<Tool[]>([]);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const { list: localSide, setList: setLocalSide, open: localSideOpen, setOpen: setLocalSideOpen, folded: localFolded, setFolded: setLocalFolded } = useRightSide(project, host.rightSidebarOpen === true);
  const shared = host.rightSidebarPerProject !== true;
  const side = shared ? host.sharedSide.side : localSide;
  const sideOpen = shared ? host.sharedSide.open : localSideOpen;
  const setSide = shared ? host.sharedSide.setSide : setLocalSide;
  const setSideOpen = shared ? host.sharedSide.setOpen : setLocalSideOpen;
  const [sideMenu, setSideMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] }>();
  const folded = shared ? host.sharedSide.folded : localFolded;
  const setFolded = shared ? host.sharedSide.setFolded : setLocalFolded;
  const toggleFolded = (kind: PanelKind) => setFolded((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]));
  const nonce = useRef(0);
  const tool = tools[tools.length - 1];

  const open = useCallback((kind: PanelKind, params: PanelParams = {}, opts?: OpenOptions): string => {
    const mod = panelOf(kind);
    if (opts?.placement === 'sidebar' && mod && isDockable(mod)) {
      setDocked(kind, true);
      return '';
    }
    if (kind === 'agent') {
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
      const terminal = typeof params.terminal === 'string' ? params.terminal : undefined;
      if (sessionId) {
        const focus = params.focus && typeof params.focus === 'object' ? (params.focus as PanelParams) : undefined;
        setAgent((cur) => (cur?.sessionId === sessionId ? { ...cur, ...(terminal ? { terminal } : {}), focus } : { sessionId, terminal, focus, nonce: ++nonce.current }));
        setTools([]);
      }
      return kind;
    }
    setTools((cur) => {
      const top = cur[cur.length - 1];
      const replace = top && top.kind === kind;
      return [...(replace ? cur.slice(0, -1) : cur), { kind, params }];
    });
    return kind;
  }, []);

  const api = useMemo<WorkspaceApi>(
    () => ({
      open,
      close: (id) => setTools((cur) => cur.filter((x) => x.kind !== id)),
      toggleSide: () => setSideOpen((o) => !o),
      moveToSide: (kind) => {
        setSideOpen(true);
        setSide((cur) => (cur.includes(kind) ? cur : [...cur, kind]));
      },
      sendToSession: (sessionId, text) => hostRef.current.sendToSession(sessionId, text),
      activeProject: project,
    }),
    [open, project],
  );

  const handle = useMemo<WorkspaceHandle>(
    () => ({
      api,
      openAgent: (sessionId, opts) => {
        open('agent', { sessionId, ...(opts?.terminal ? { terminal: opts.terminal } : {}) });
        if (opts?.trajectory) open('trajectory', { sessionId });
      },
      tool: () => toolsRef.current[toolsRef.current.length - 1]?.kind,
      closeAgent: (sessionId) => setAgent((cur) => (cur?.sessionId === sessionId ? undefined : cur)),
    }),
    [api, open],
  );

  useEffect(() => {
    register(project, handle);
    return () => register(project, null);
  }, [handle, project, register]);

  const shown = agent?.sessionId;
  useEffect(() => {
    if (!hidden) onFocusedAgent(project, shown);
  }, [hidden, shown, project, onFocusedAgent]);

  const updateAgent = useCallback((patch: PanelParams) => {
    if (typeof patch.sessionId === 'string') setAgent((cur) => cur && { ...cur, sessionId: patch.sessionId as string });
  }, []);
  const updateTool = useCallback((patch: PanelParams) => {
    setTools((cur) => {
      const top = cur[cur.length - 1];
      if (!top) return cur;
      const params = { ...top.params, ...patch };
      for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
      return [...cur.slice(0, -1), { ...top, params }];
    });
  }, []);

  const panelProps = (kind: string, params: PanelParams, active: boolean, update: PanelProps['update']): PanelProps => ({ project, params, api, tabId: kind, visible: active && !hidden, focused: active && !hidden, update, sessionId: agent?.sessionId });
  const agentMod = panelOf('agent');
  const toolMod = tool ? panelOf(tool.kind) : undefined;
  const addToSide = (kind: PanelKind) => {
    setDocked(kind, false);
    setSide((cur) => (cur.includes(kind) ? cur : [...cur, kind]));
  };
  const addMenu = (e: MouseEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items = PANELS.filter((p) => isDockable(p) && !side.includes(p.kind)).map((p): ContextMenuItem => ({ id: `add-${p.kind}`, label: t(p.titleKey), icon: p.icon, run: () => addToSide(p.kind) }));
    setSideMenu({ at: { x: box.left, y: box.bottom }, items });
  };
  const moveInSide = (kind: PanelKind, to: number) => {
    setSide((cur) => {
      const at = cur.indexOf(kind);
      if (at < 0 || to < 0 || to >= cur.length) return cur;
      const next = cur.filter((k) => k !== kind);
      next.splice(to, 0, kind);
      return next;
    });
  };
  const moveToLeft = (kind: PanelKind) => {
    setSide((cur) => cur.filter((k) => k !== kind));
    setDocked(kind, true);
  };

  return (
    <div className="agents-dock" hidden={hidden}>
      <div className="agents-dock-main">
      <div className="agents-dock-view" hidden={tool !== undefined}>
        <PanelBoundary>
          {agent && agentMod ? (
            <agentMod.Panel key={agent.nonce} {...panelProps('agent', { sessionId: agent.sessionId, terminal: agent.terminal, focus: agent.focus }, !tool, updateAgent)} />
          ) : (
            <EmptyCard onNewSession={() => host.newSession(project)} />
          )}
        </PanelBoundary>
      </div>
      {tool && (
        <div className="agents-dock-view">
          <PanelBoundary key={tool.kind}>
            {toolMod ? <toolMod.Panel {...panelProps(tool.kind, tool.params, true, updateTool)} /> : <MissingPanel kind={tool.kind} />}
          </PanelBoundary>
        </div>
      )}
      </div>
      {sideOpen && (
        <aside className="agents-dock-side">
          <Button variant="ghost" size="sm" icon="plus" className="agents-dock-side-add" title={t('agents.section.add')} aria-label={t('agents.section.add')} aria-haspopup="menu" onClick={addMenu}>
            <span className="agents-label">{t('agents.section.add')}</span>
          </Button>
          <div className="agents-dock-side-list">
          {side.map((kind, at) => {
            const mod = panelOf(kind);
            const isFolded = folded.includes(kind);
            const toggleLabel = isFolded ? t('agents.section.expand') : t('agents.section.collapse');
            return (
              <section key={kind} className={`agents-dock-side-item${isFolded ? ' collapsed' : ''}`}>
                <div className="agents-section-head agents-dock-side-head" onContextMenu={(e) => { e.preventDefault(); setSideMenu({ at: { x: e.clientX, y: e.clientY }, items: [
                { id: 'moveUp', label: t('agents.tree.moveUp'), disabled: at === 0, run: () => moveInSide(kind, at - 1) },
                { id: 'moveDown', label: t('agents.tree.moveDown'), disabled: at === side.length - 1, run: () => moveInSide(kind, at + 1) },
                { id: 'toLeft', label: t('agents.section.toLeft'), run: () => moveToLeft(kind) },
              ] }); }}><button type="button" className="agents-section-toggle" aria-expanded={!isFolded} title={toggleLabel} onClick={() => toggleFolded(kind)}><span className="agents-section-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span><span className="agents-label">{mod ? t(mod.titleKey) : kind}</span></button><span className="agents-section-actions"><SectionButton icon="close" label={t('agents.section.hide')} onClick={() => setSide((cur) => cur.filter((k) => k !== kind))} /></span></div>
                <div className="agents-dock-side-body" hidden={isFolded}>
                  <PanelBoundary>{mod ? <mod.Panel {...panelProps(kind, { side: true }, !isFolded, () => undefined)} /> : <MissingPanel kind={kind} />}</PanelBoundary>
                </div>
              </section>
            );
          })}
          </div>
        </aside>
      )}
      {sideMenu && <ContextMenu at={sideMenu.at} items={sideMenu.items} onClose={() => setSideMenu(undefined)} />}
    </div>
  );
}
