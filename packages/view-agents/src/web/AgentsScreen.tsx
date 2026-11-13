import { type UsageSettings } from './UsageView';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveKeys, errorOf, setTitleBadge, useDialogs, setViewTitle, useCommand, useKeybindings, useRunCommand, useViewSidePanel, useViewToast, ViewSidePanel } from '@kedalion/ui';
import { terminalAppKeys } from '@kedalion/terminal';
import { closeSession, listSessions } from '@kedalion/terminal/session';
import { agentsCommands } from '../commands';
import { t } from '../i18n';
import { type AgentAccount, type AgentsCapWarn, CapDeclined, lastResponse, type AgentProject, type AgentRunning, type AgentSessionView, dismissRecovery, listAccounts, listAgentProjects, listRecovery, loadUiState, markSeen, removeAgentProject, reportShown, restartSession, setActiveAccount, startInBackground, startSession, stopSession, terminalOf } from './api';
import { AddProject } from './AddProject';
import { AlertsPanel } from './AlertsPanel';
import { categoryOf } from './filters';
import { clampWidth, focusMemory, type FocusRegion, parseWidths, type PaneWidths, regionOf, SIDEBAR_W, WIDTHS_KEY } from './navigation';
import { displayName, needsYouCount, nextWaiting } from './attention';
import { StatusStrip } from './StatusStrip';
import { NewSession } from './NewSession';
import { activeDirOf } from './AccountPicker';
import { GroupSummary } from './GroupSummary';
import { EmptyState } from './EmptyState';
import { Sidebar } from './Sidebar';
import { skillsSideContent } from './SkillsPanel';
import { useAgentsFeed } from './useAgentSessions';
import { type AgentsHost, AgentsHostProvider, type TerminalInput } from './workspace/host';
import { projectPathOf, sameFolder } from './workspace/project-path';
import { ProjectWorkspace, type WorkspaceHandle } from './workspace/ProjectWorkspace';
import type { PanelKind, PanelParams } from './workspace/types';
import { SHARED_SCOPE } from './workspace/right-side-store';
import { getUiState, setUiState, UI_STATE_EVENT, uiStateLoaded } from './ui-state';
import { useRightSide } from './workspace/use-right-side';
import '../styles.css';
import './ui.css';
import './chrome.css';
import './islands.css';

const SIDEBAR_KEY = 'kedalion.agents.sidebarHidden';
const ACTIVE_PROJECT_KEY = 'kedalion.agents.activeProject';
/** Project workspaces kept mounted (hidden) so switching back is instant; older ones detach and are rebuilt from the saved layout. */
const MAX_MOUNTED = 4;

const readHidden = () => getUiState(SIDEBAR_KEY)?.hidden === true;

const readActiveProject = (): string | undefined => {
  const p = getUiState(ACTIVE_PROJECT_KEY)?.path;
  return typeof p === 'string' && p ? p : undefined;
};

/** The session id (and owner account id, if given) of an `#agents/<id>[/<account id>]` app link. */
const linkedSession = (): { id: string; owner?: string } | undefined => {
  const m = /^#\/?agents\/([\w.-]+)(?:\/([\w.-]+))?\/?$/.exec(window.location.hash);
  return m ? { id: m[1]!, owner: m[2] } : undefined;
};

const readWidths = (): PaneWidths => parseWidths(getUiState(WIDTHS_KEY));

/**
 * Invisible 8px drag strip between two regions (dashed line, accent on hover or drag). `edge` is the side of the
 * resized region it sits on: 'end' grows the region to its left when dragged right, 'start' the region to its right.
 */
function Sash({ edge, width, onWidth, onDone, onReset }: { edge: 'start' | 'end'; width: () => number; onWidth: (w: number) => void; onDone: () => void; onReset: () => void }) {
  const [dragging, setDragging] = useState(false);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width();
    setDragging(true);
    const move = (ev: PointerEvent) => onWidth(w0 + (edge === 'end' ? ev.clientX - x0 : x0 - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      onDone();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return <div className={`agents-sash${dragging ? ' dragging' : ''}`} aria-hidden="true" onPointerDown={down} onDoubleClick={onReset} />;
}

/** Agents screen: the sessions sidebar and the dock workspace of the selected project (the selected session, or a tool opened over it). */
export function AgentsScreen({ usageSettings, rightSidebarOpen = false, rightSidebarPerProject = false, taskSkill = '', summaryLimit, perProject, dnd = false, onDnd }: { usageSettings?: UsageSettings; summaryLimit?: number; perProject?: number;taskSkill?: string; rightSidebarOpen?: boolean; rightSidebarPerProject?: boolean; dnd?: boolean; onDnd?: (on: boolean) => void }) {
  const { sessions, usage, git } = useAgentsFeed();
  const toast = useViewToast('home');
  const dialogs = useDialogs();
  const [region, setRegion] = useState<FocusRegion | undefined>(focusMemory.region);
  const onFocusRegion = useCallback((e: { target: EventTarget | null }) => {
    const r = regionOf(e.target instanceof Element ? e.target : null);
    if (!r) return;
    focusMemory.region = r;
    setRegion(r);
  }, []);
  const [widths, setWidths] = useState(readWidths);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const saveWidths = useCallback(() => {
    setUiState(WIDTHS_KEY, { ...widthsRef.current });
  }, []);
  const screenRef = useRef<HTMLDivElement>(null);
  const keys = useKeybindings();
  const runCommand = useRunCommand();
  const [hidden, setHidden] = useState(readHidden);
  const [selectedId, setSelectedId] = useState<string>();
  const [newFor, setNewFor] = useState<string>();
  /** Project row selected in the tree (its workspace is the shown one); cleared when a session gets selected. */
  const [summaryFor, setSummaryFor] = useState<string>();
  const [visible, setVisible] = useState<AgentSessionView[]>();
  /** Folder row whose summary fills the main pane (exclusive with a project workspace). */
  const [folderFor, setFolderFor] = useState<{ id: string; name: string; projectIds: string[] }>();
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [accounts, setAccounts] = useState<AgentAccount[]>([]);
  const [adding, setAdding] = useState(false);
  const [addedProject, setAddedProject] = useState<AgentProject>();
  const [alertsOpen, setAlertsOpen] = useState(false);
  /** Sessions the user stopped (exit bar reads "Session stopped") and sessions whose resume bar was dismissed. */
  const [userStopped, setUserStopped] = useState<ReadonlySet<string>>(new Set());
  const [resumeDismissed, setResumeDismissed] = useState<ReadonlySet<string>>(new Set());

  // The shown project's workspace, and the last MAX_MOUNTED ones used (all mounted, the others hidden).
  const [activeProject, setActiveProject] = useState(readActiveProject);
  const [mounted, setMounted] = useState<string[]>(() => {
    const first = readActiveProject();
    return first ? [first] : [];
  });
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  // The saved UI state (widths, sidebar, last project) arrives after the first paint; first paint used the in-memory values.
  useEffect(() => {
    const apply = () => {
      setWidths(readWidths());
      setHidden(readHidden());
      const p = readActiveProject();
      if (p && mountedRef.current.length === 0) {
        mountedRef.current = [p];
        setMounted([p]);
        setActiveProject(p);
      }
    };
    window.addEventListener(UI_STATE_EVENT, apply);
    if (!uiStateLoaded()) void loadUiState();
    return () => window.removeEventListener(UI_STATE_EVENT, apply);
  }, []);
  const handles = useRef(new Map<string, WorkspaceHandle>());
  const queue = useRef(new Map<string, Array<(h: WorkspaceHandle) => void>>());

  /** Shows the project's workspace, mounting it (and detaching the least recently used beyond the limit); returns the path as mounted. */
  const activate = useCallback((path: string): string => {
    const known = mountedRef.current.find((p) => sameFolder(p, path)) ?? path;
    const next = [known, ...mountedRef.current.filter((p) => p !== known)].slice(0, MAX_MOUNTED);
    mountedRef.current = next;
    setMounted(next);
    setActiveProject(known);
    setUiState(ACTIVE_PROJECT_KEY, { path: known });
    return known;
  }, []);
  const registerWorkspace = useCallback((project: string, handle: WorkspaceHandle | null) => {
    if (!handle) {
      handles.current.delete(project);
      return;
    }
    handles.current.set(project, handle);
    const waiting = queue.current.get(project);
    queue.current.delete(project);
    for (const fn of waiting ?? []) fn(handle);
  }, []);
  /** Runs `fn` on the project's workspace now, or once it has loaded its layout. */
  const withWorkspace = useCallback((project: string, fn: (h: WorkspaceHandle) => void) => {
    const handle = handles.current.get(project);
    if (handle) fn(handle);
    else queue.current.set(project, [...(queue.current.get(project) ?? []), fn]);
  }, []);
  const handleOf = useCallback((path: string) => [...handles.current].find(([k]) => sameFolder(k, path))?.[1], []);
  const pathOf = useCallback((s: Pick<AgentSessionView, 'project' | 'cwd'>) => projectPathOf(s, projects), [projects]);
  /** Shows the session in its project's workspace. */
  const showAgent = useCallback(
    (path: string, sessionId: string, opts?: { terminal?: string; trajectory?: boolean }) => {
      const project = activate(path);
      withWorkspace(project, (h) => h.openAgent(sessionId, opts));
    },
    [activate, withWorkspace],
  );
  const onFocusedAgent = useCallback((_project: string, sessionId: string | undefined) => setSelectedId((cur) => (cur === sessionId ? cur : sessionId)), []);

  const autoResume = useRef<(items: AgentRunning[]) => Promise<void>>();
  useEffect(() => {
    void listRecovery().then((items) => {
      if (items.length > 0 && items.every((x) => x.auto)) void autoResume.current?.(items);
      else void dismissRecovery().catch(() => undefined);
    }, () => undefined);
  }, []);
  const dismissBanner = useCallback(() => {
    void dismissRecovery().catch(() => undefined);
  }, []);

  useEffect(() => {
    void listAgentProjects().then(setProjects, (e) => setError(errorOf(e).message));
    void listAccounts().then(setAccounts, () => undefined);
  }, []);
  const removeProject = useCallback((id: string) => {
    void removeAgentProject(id).then(() => setProjects((p) => p.filter((x) => x.id !== id)), (e) => setError(errorOf(e).message));
  }, []);

  const selectProject = useCallback(
    (projectId: string) => {
      setNewFor(undefined);
      setFolderFor(undefined);
      setSelectedId(undefined);
      setSummaryFor(projectId);
      const path = projects.find((p) => p.id === projectId)?.path;
      if (path) activate(path);
    },
    [projects, activate],
  );
  const selectFolder = useCallback((folder: { id: string; name: string; projectIds: string[] }) => {
    setNewFor(undefined);
    setSelectedId(undefined);
    setSummaryFor(undefined);
    setFolderFor(folder);
  }, []);

  const toggleSidebar = useCallback(() => {
    setHidden((h) => {
      setUiState(SIDEBAR_KEY, { hidden: !h });
      return !h;
    });
  }, []);
  useCommand(agentsCommands()[0]!, toggleSidebar);

  const selected = sessions.find((s) => s.id === selectedId);
  const activeFolder = activeProject ?? (selected ? pathOf(selected) : undefined);
  /** Opens a tool panel in the shown project's workspace (the selected session's, else the first project's). */
  const openTool = useCallback(
    (kind: PanelKind, params?: PanelParams) => {
      const path = activeFolder ?? projects[0]?.path;
      if (!path) return;
      setNewFor(undefined);
      setFolderFor(undefined);
      setSummaryFor(undefined);
      const project = activate(path);
      withWorkspace(project, (h) => void h.api.open(kind, params));
    },
    [activeFolder, projects, activate, withWorkspace],
  );
  useCommand(agentsCommands()[1]!, () => openTool('changes'));
  useCommand(agentsCommands()[22]!, () => openTool('trajectory', selectedId ? { sessionId: selectedId } : undefined));

  const waiting = needsYouCount(sessions);
  useEffect(() => {
    setTitleBadge(waiting);
  }, [waiting]);
  useEffect(() => () => setTitleBadge(0), []);

  const lastAccount = useCallback((projectId: string) => sessions.find((s) => s.project === projectId)?.account, [sessions]);

  const select = useCallback(
    (sessionId: string) => {
      setNewFor(undefined);
      setFolderFor(undefined);
      setSummaryFor(undefined);
      setSelectedId(sessionId);
      setError('');
      void markSeen(sessionId).catch(() => undefined);
      const s = sessions.find((x) => x.id === sessionId);
      // Trajectory shown: the picked session opens on its own Trajectory.
      const trajectory = activeProject !== undefined && handleOf(activeProject)?.tool() === 'trajectory';
      if (s) showAgent(pathOf(s), sessionId, trajectory ? { trajectory } : undefined);
    },
    [sessions, showAgent, pathOf, activeProject, handleOf],
  );

  const jumpWaiting = useCallback(() => {
    const next = nextWaiting(sessions);
    if (next) select(next.id);
    else toast({ message: t('agents.noneWaiting') });
  }, [sessions, select, toast]);
  useCommand(agentsCommands()[2]!, jumpWaiting);
  const toggleDnd = useCallback(() => onDnd?.(!dnd), [onDnd, dnd]);
  useCommand(agentsCommands().find((c) => c.id === 'agents.toggleDnd')!, toggleDnd);
  useCommand(agentsCommands()[3]!, () => setAlertsOpen(true));
  useCommand(agentsCommands()[20]!, () => openTool('usage'));
  const side = useViewSidePanel('agents');
  /** Folder whose skills and agents the side panel lists: the project in focus; none for a group such as Personal. */
  const skillsFolder = useRef<string | undefined>(undefined);
  useCommand(agentsCommands()[23]!, () => side.open(skillsSideContent(() => skillsFolder.current)));

  /** The project folder a running session record belongs to. */
  const pathOfRecord = useCallback(
    (x: AgentRunning) => {
      const s = sessions.find((y) => y.id === x.id);
      return s ? pathOf(s) : (projects.find((p) => sameFolder(p.path, x.cwd))?.path ?? x.cwd);
    },
    [sessions, projects, pathOf],
  );

  const resume = useCallback(
    async (items: AgentRunning[]) => {
      dismissBanner();
      setError('');
      for (const [n, x] of items.entries()) {
        if (n > 0 && x.auto) await new Promise((r) => setTimeout(r, 100));
        try {
          const live = await terminalOf(x.id);
          const terminal = live ?? (await startSession({ account: x.account, dir: x.cwd, sessionId: x.id })).session;
          showAgent(pathOfRecord(x), x.id, { terminal });
        } catch (e) {
          setError(errorOf(e).message);
        }
      }
      const first = items[0];
      if (first) {
        activate(pathOfRecord(first));
        setSelectedId(first.id);
      }
    },
    [dismissBanner, showAgent, activate, pathOfRecord],
  );
  autoResume.current = resume;

  const stop = useCallback(
    async (s: AgentSessionView) => {
      setError('');
      try {
        const r = await stopSession(s.id);
        setUserStopped((u) => new Set(u).add(s.id));
        if (r.removed) {
          handleOf(pathOf(s))?.closeAgent(s.id);
          setSelectedId((cur) => (cur === s.id ? undefined : cur));
        }
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [pathOf, handleOf],
  );

  const restart = useCallback(
    async (s: AgentSessionView) => {
      setNewFor(undefined);
      setError('');
      try {
        const r = await restartSession(s.id);
        setUserStopped((u) => {
          const n = new Set(u);
          n.delete(s.id);
          return n;
        });
        showAgent(pathOf(s), r.sessionId, { terminal: r.session });
        setSelectedId(r.sessionId);
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [showAgent, pathOf],
  );

  const startBackground = useCallback(async (s: AgentSessionView) => {
    setError('');
    try {
      await startInBackground({ account: s.account, dir: s.cwd, sessionId: s.id });
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, []);

  /** Starts (resumes) the session and shows it in its workspace. */
  const startHere = useCallback(
    async (s: AgentSessionView) => {
      setError('');
      try {
        const r = await startSession({ account: s.account, dir: s.cwd, sessionId: s.id });
        showAgent(pathOf(s), s.id, { terminal: r.session });
        void focusSoon();
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [showAgent, pathOf],
  );

  /** Clears an exited session: closes its ended terminal so it reads as stopped. */
  const clearExited = useCallback(async (sessionId: string) => {
    setError('');
    setUserStopped((u) => {
      const n = new Set(u);
      n.delete(sessionId);
      return n;
    });
    try {
      const all = await listSessions();
      for (const x of all) if (x.exited && x.meta?.agentSession === sessionId) await closeSession(x.id);
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, []);

  // Tells the server which session is on screen (none while the window is unfocused), so it does not toast for it.
  useEffect(() => {
    const report = () => void reportShown(selectedId && document.hasFocus() && !document.hidden ? selectedId : null).catch(() => undefined);
    report();
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      document.removeEventListener('visibilitychange', report);
      void reportShown(null).catch(() => undefined);
    };
  }, [selectedId]);

  // A toast click opens `#agents/<session id>`: select that session once the list has it.
  const [linked, setLinked] = useState(linkedSession);
  useEffect(() => {
    const onHash = () => setLinked(linkedSession());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const switchedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!linked) return;
    if (sessions.some((x) => x.id === linked.id)) {
      setLinked(undefined);
      window.history.replaceState(null, '', '#/agents');
      select(linked.id);
      return;
    }
    // Hidden (showAllSessions off, another owner): make its owner the active account; the feed then lists it and the branch above selects it.
    if (!linked.owner || switchedFor.current === linked.id) return;
    switchedFor.current = linked.id;
    void listAccounts()
      .then((accs) => {
        const owner = accs.find((a) => a.id === linked.owner);
        return owner && !owner.active ? setActiveAccount(activeDirOf(owner)) : undefined;
      })
      .catch(() => undefined);
  }, [linked, sessions, select]);

  // Per session id: how to insert text into its terminal (the Notes panel's Send to session, /clear).
  const inputs = useRef(new Map<string, TerminalInput>());
  const registerTerminal = useCallback((sessionId: string, input: TerminalInput | null) => {
    if (input) inputs.current.set(sessionId, input);
    else inputs.current.delete(sessionId);
  }, []);
  const sendToSession = useCallback((sessionId: string, text: string) => inputs.current.get(sessionId)?.insert(text), []);

  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(id);
  }, [notice]);

  const copyResponse = useCallback(
    async (sessionId: string | undefined = selectedId) => {
      if (!sessionId) return setNotice(t('agents.copy.none'));
      try {
        const { text } = await lastResponse(sessionId);
        if (!text) return setNotice(t('agents.copy.none'));
        await navigator.clipboard.writeText(text);
        setNotice(t('agents.copy.done', { n: text.length }));
      } catch (e) {
        setError(errorOf(e).message);
      }
    },
    [selectedId],
  );
  useCommand(agentsCommands()[4]!, () => void copyResponse());

  const clearContext = useCallback(() => {
    const s = sessions.find((x) => x.id === selectedId);
    if (!selectedId || !s) return setNotice(t('agents.clear.noSelection'));
    if (s.external) return setNotice(t('agents.clear.elsewhere'));
    if (!s.live) return setNotice(t('agents.clear.notRunning'));
    if (s.status !== 'idle' && s.status !== 'done' && s.status !== 'error') return setNotice(t('agents.clear.busy'));
    const input = inputs.current.get(selectedId);
    if (!input) return setNotice(t('agents.clear.notRunning'));
    input.submit('/clear');
    setNotice(t('agents.clear.done'));
  }, [sessions, selectedId]);
  useCommand(agentsCommands()[5]!, clearContext);

  const focusInput = useCallback(() => {
    const els = document.querySelectorAll<HTMLElement>('.agents-main .xterm-helper-textarea');
    const target = [...els].find((el) => el.offsetParent !== null && !(el as HTMLTextAreaElement).disabled);
    target?.focus();
    return target !== undefined && document.activeElement === target;
  }, []);
  const focusSoon = useCallback(async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 50));
      if (focusInput()) return;
    }
  }, [focusInput]);
  useEffect(() => {
    if (focusMemory.region === 'main') void focusSoon();
    else focusMemory.region ??= 'tree';
  }, []);
  const interact = useCallback(async () => {
    if (!selectedId) return setNotice(t('agents.interact.none'));
    if (selected && !selected.external && categoryOf(selected) === 'stopped') await startHere(selected);
    for (let i = 0; i < 40; i++) {
      if (focusInput()) return;
      await new Promise((res) => setTimeout(res, 50));
    }
    setNotice(t('agents.interact.none'));
  }, [selectedId, selected, startHere, focusInput]);
  useCommand(agentsCommands()[24]!, () => void interact());
  const newSessionHere = useCallback(() => {
    const project = selected?.project ?? summaryFor ?? folderFor?.projectIds[0] ?? projects.find((p) => activeProject !== undefined && sameFolder(p.path, activeProject))?.id;
    if (!project) return;
    setNewFor(project);
  }, [selected, summaryFor, folderFor, projects, activeProject]);
  useCommand(agentsCommands()[26]!, newSessionHere);
  useCommand(agentsCommands()[27]!, () => setAdding(true));
  useCommand(agentsCommands()[29]!, () => {
    if (selected && !selected.live && !selected.external) void startHere(selected);
  });
  useCommand(agentsCommands()[30]!, () => {
    if (selected) void stop(selected);
  });
  useCommand(agentsCommands()[31]!, () => {
    if (selected) void restart(selected);
  });
  useCommand(agentsCommands()[32]!, () => {
    void listAgentProjects().then(setProjects, (e) => setError(errorOf(e).message));
  });
  useCommand(agentsCommands()[48]!, () => void runCommand('app.keybindings'));
  useCommand(agentsCommands()[49]!, () => void runCommand('app.settings'));

  /** Starts a new Claude session in the project folder: with `account` right away, else through the start flow (active account). */
  const newSession = useCallback(
    (path: string, account?: string) => {
      const project = projects.find((p) => sameFolder(p.path, path));
      if (!account) {
        if (project) setNewFor(project.id);
        else setError(t('workspace.noProject'));
        return;
      }
      const confirmCap = (w: AgentsCapWarn) => dialogs.confirm({ title: t('agents.cap.warn', { live: w.live, cap: w.cap }), okLabel: t('agents.cap.confirm') });
      setError('');
      void startSession({ account, dir: path, confirmCap }).then(
        (r) => {
          showAgent(path, r.sessionId, { terminal: r.session });
          setSelectedId(r.sessionId);
          void focusSoon();
        },
        (e) => {
          if (!(e instanceof CapDeclined)) setError(errorOf(e).message);
        },
      );
    },
    [projects, dialogs, showAgent, focusSoon],
  );

  const newKey = useMemo(() => (keys ? effectiveKeys(keys.defs, keys.keymap).get('agents.newSession')?.[0] : undefined), [keys]);
  const projectName = selected ? (projects.find((p) => p.id === selected.project)?.name ?? selected.cwd.split(/[\\/]/).filter(Boolean).pop() ?? selected.cwd) : '';
  const appKeys = useMemo(() => terminalAppKeys('agents', keys?.defs ?? [], ['agents.toggleSidebar', 'agents.togglePanel', 'agents.focusList']), [keys?.defs]);

  // Window title "<project> — <session>" for the selected session; cleared with no selection and on unmount.
  const viewTitle = selected ? `${projectName} — ${displayName(selected)}` : undefined;
  useEffect(() => setViewTitle(viewTitle), [viewTitle]);
  useEffect(() => () => setViewTitle(undefined), []);

  const sizeVars = { '--agents-sidebar-w': `${widths.sidebar}px` } as CSSProperties;

  const { list: sharedSideList, setList: setSharedSideList, open: sharedSideOpen, setOpen: setSharedSideOpen, folded: sharedFolded, setFolded: setSharedFolded } = useRightSide(SHARED_SCOPE, rightSidebarOpen);
  const host: AgentsHost = {
    sessions,
    git,
    usage,
    usageSettings,
    rightSidebarOpen,
    taskSkill,
    rightSidebarPerProject,
    sharedSide: { side: sharedSideList, setSide: setSharedSideList, open: sharedSideOpen, setOpen: setSharedSideOpen, folded: sharedFolded, setFolded: setSharedFolded },
    projects,
    accounts,
    appKeys,
    selectedId,
    userStopped,
    resumeDismissed,
    dismissResume: (id) => setResumeDismissed((d) => new Set(d).add(id)),
    stop: (s) => void stop(s),
    restart: (s) => void restart(s),
    startBackground: (s) => void startBackground(s),
    clearExited: (id) => void clearExited(id),
    copyResponse: (id) => void copyResponse(id),
    projectIdOf: (path) => projects.find((p) => sameFolder(p.path, path))?.id,
    newSession,
    setError,
    registerTerminal,
    sendToSession,
    focusSoon: () => void focusSoon(),
  };

  const summaryProject = summaryFor === undefined ? undefined : projects.find((p) => p.id === summaryFor);
  skillsFolder.current = folderFor ? undefined : summaryProject?.path ?? activeFolder;
  const showWorkspaces = newFor === undefined && folderFor === undefined && summaryProject === undefined;

  return (
    <AgentsHostProvider value={host}>
      <div ref={screenRef} className={`view-agents agents-screen${hidden ? ' sidebar-hidden' : ''}${region ? ` focus-${region}` : ''}`} style={sizeVars} onFocusCapture={onFocusRegion}>
        <div className="agents-body">
          {!hidden && (
            <Sidebar
              projects={projects}
              addedProject={addedProject}
              sessions={sessions}
              perProject={perProject !== undefined && perProject >= 1 ? Math.floor(perProject) : 10}
              usage={usage}
              usageSettings={usageSettings}
              onOpenUsage={() => openTool('usage')}
              getWorkspace={() => {
                const path = activeProject ?? projects[0]?.path;
                const h = path === undefined ? undefined : handleOf(path);
                return path !== undefined && h ? { project: path, api: h.api, sessionId: selectedId } : undefined;
              }}
              selectedId={selectedId}
              onSelect={select}
              selectedProjectId={summaryFor}
              onSelectProject={selectProject}
              selectedFolderId={folderFor?.id}
              onSelectFolder={selectFolder}
              onVisibleChange={setVisible}
              onNewSession={setNewFor}
              onQuickNew={setNewFor}
              onRemoveProject={removeProject}
              onStop={(s) => void stop(s)}
              onRestart={(s) => void restart(s)}
              onStartBackground={(s) => void startBackground(s)}
            />
          )}
          {!hidden && (
            <Sash
              edge="end"
              width={() => widthsRef.current.sidebar}
              onWidth={(w) => setWidths((v) => ({ ...v, sidebar: clampWidth('sidebar', w) }))}
              onDone={saveWidths}
              onReset={() => {
                setWidths((v) => ({ ...v, sidebar: SIDEBAR_W.def }));
                setTimeout(saveWidths);
              }}
            />
          )}
          {alertsOpen && <AlertsPanel projects={projects} onClose={() => setAlertsOpen(false)} />}
          {adding && <AddProject added={projects} onAdded={(p) => { setProjects((l) => [...l, p]); setAddedProject(p); }} onClose={() => setAdding(false)} />}
          <ViewSidePanel side={side}>
          <section className={`agents-main${region === 'main' ? ' focused' : ''}`}>
            {error && <div role="alert" className="agents-error">{error}</div>}
            {notice && <div role="status" className="agents-notice">{notice}</div>}
            {newFor !== undefined && (
              <NewSession
                key={newFor}
                projects={projects}
                projectId={newFor}
                lastAccount={lastAccount}
                onCancel={() => setNewFor(undefined)}
                onStarted={(r) => {
                  setNewFor(undefined);
                  setSelectedId(r.sessionId);
                  const path = projects.find((p) => p.id === r.projectId)?.path;
                  if (path) showAgent(path, r.sessionId, { terminal: r.terminal });
                  void focusSoon();
                }}
              />
            )}
            <div className="agents-workspaces" hidden={!showWorkspaces}>
              {mounted.map((path) => (
                <ProjectWorkspace key={path} project={path} hidden={activeProject === undefined || !sameFolder(path, activeProject)} register={registerWorkspace} onFocusedAgent={onFocusedAgent} />
              ))}
              {activeProject === undefined && <EmptyState newKey={newKey} onNewSession={projects[0] ? () => setNewFor(projects[0]!.id) : () => setAdding(true)} />}
            </div>
            {summaryProject && newFor === undefined && (
              <div className="agents-panes">
                <div className="agents-pane">
                  <GroupSummary
                    kind="project"
                    limit={summaryLimit}
                    name={summaryProject.name}
                    path={summaryProject.path}
                    sessions={(hidden || !visible ? sessions.filter((s) => !s.archived) : visible).filter((s) => s.project === summaryProject.id)}
                    onSelect={select}
                    onNewSession={() => setNewFor(summaryProject.id)}
                  />
                </div>
              </div>
            )}
            {folderFor && newFor === undefined && (
              <div className="agents-panes">
                <div className="agents-pane">
                  <GroupSummary
                    kind="folder"
                    name={folderFor.name}
                    projectCount={folderFor.projectIds.length}
                    sessions={(hidden || !visible ? sessions.filter((s) => !s.archived) : visible).filter((s) => s.project !== undefined && folderFor.projectIds.includes(s.project))}
                    onSelect={select}
                  />
                </div>
              </div>
            )}
          </section>
          </ViewSidePanel>
        </div>
        <StatusStrip sessions={sessions} dnd={dnd} onJumpWaiting={jumpWaiting} onToggleDnd={toggleDnd} />
        {dialogs.element}
      </div>
    </AgentsHostProvider>
  );
}
