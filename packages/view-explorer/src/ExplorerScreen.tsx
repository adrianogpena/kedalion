import './explorer.css';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { editorSettingsOf, type ExplorerSettings, type ExplorerViewSettings as Settings, generalSettingsOf, windowSettingsOf } from './settings';
import { gitSettingsOf, setZen, useZen } from '@kedalion/ui';
import { openEditorSearch } from '@kedalion/editor';
import {
  activate,
  activeTab,
  addTab,
  focusedPane,
  pinTab,
  closeTab,
  type ContextMenuItem,
  dialogs,
  Empty,
  errorOf,
  ErrorBanner,
  Explorer,
  type ApiError,
  type FieldSpec,
  Modal,
  navigate,
  newTab,
  openBeside,
  PageHead,
  PanelLoading,
  ResourceForm,
  restore,
  serialize,
  setPreview,
  singlePane,
  Spinner,
  SplitView,
  TabWorkspace,
  useAsync,
  useCommand,
  useDebouncedSave,
  useKeybindings,
  useViewRequest,
  type Layout,
  type QuickOpenFile,
  useProvideQuickOpen,
  fileIconOf,
  useFileIconVersion,
  fileSettingsOf,
  relPath,
  type SortState,
  ProjectPicker,
} from '@kedalion/ui';
import { closeSession } from '@kedalion/terminal/session';
import { explorerApi as api, type LogSettings, type Project } from './client';
import { terminalAppKeys } from '@kedalion/terminal';
import { explorerCommandById as commandById } from './commands';
import { fullPath, nodeId } from './explorer-paths';
import { t } from './i18n';
import { useCopyPath } from './explorer/copy-path';
import { useFileUndo } from './explorer/file-undo';
import { useNameIndex } from './explorer/name-index';
import type { ProjectTreeApi } from './explorer/ProjectTree';
import type { ExplorerSqlProps } from './explorer/SqlPanel';
import { useChordOf } from './explorer/tab-actions';
import { TreePane } from './explorer/TreePane';
import { relativeInside, untitledName } from './explorer/untitled';

// The editor and viewers are large; they load when the first file opens.
const FileTab = lazy(() => import('./explorer/FileTab').then((m) => ({ default: m.FileTab })));
const TerminalPane = lazy(() => import('@kedalion/terminal').then((m) => ({ default: m.TerminalPane })));
const CompareTab = lazy(() => import('./explorer/CompareTab').then((m) => ({ default: m.CompareTab })));
const UntitledTab = lazy(() => import('./explorer/UntitledTab').then((m) => ({ default: m.UntitledTab })));
const DetailsTab = lazy(() => import('./explorer/DetailsTab').then((m) => ({ default: m.DetailsTab })));

type FileRef = { project: string; path: string };
type Route =
  | { kind: 'welcome' }
  /** A new tab's editor; `target` is the absolute file a save outside every project wrote, `saved` that the text matches it. */
  | { kind: 'untitled'; lang: string; text: string; target?: string; saved?: boolean }
  | { kind: 'file'; project: string; path: string }
  | { kind: 'terminal'; project: string; path: string; session?: string }
  | { kind: 'diff'; left: FileRef; right: FileRef }
  | { kind: 'details'; project: string; path: string; sort?: SortState | null };

const isFileRef = (x: unknown): x is FileRef => {
  const r = x as { project?: unknown; path?: unknown } | null;
  return !!r && typeof r === 'object' && typeof r.project === 'string' && typeof r.path === 'string';
};
/** `ref` after a rename or move of `from` to `to` in `project`. */
const movedRef = (ref: FileRef, project: string, from: string, to: string): FileRef =>
  ref.project === project && relPath.isUnder(ref.path, from) ? { ...ref, path: relPath.moved(ref.path, from, to) } : ref;
const refUnder = (ref: FileRef, project: string, path: string) => ref.project === project && relPath.isUnder(ref.path, path);

const UNTITLED: Route = { kind: 'untitled', lang: 'text', text: '' };
/** A tab a newly opened file, terminal or view takes over: the welcome page or an untouched untitled tab. */
const isBlank = (r: Route) => r.kind === 'welcome' || (r.kind === 'untitled' && !r.text && !r.target);
/** Under the server's 64 KB `tabs` limit, leaving room for the JSON the server measures. */
const MAX_TABS_BYTES = 60 * 1024;
/** The saved tab layout; untitled text is left out when the layout would exceed the budget, and the tabs too when that is not enough. */
function tabsToSave(layout: Layout<Route>): unknown {
  const full = serialize(layout);
  if (JSON.stringify(full).length < MAX_TABS_BYTES) return full;
  const trimmed = serialize({
    ...layout,
    panes: layout.panes.map((p) => ({
      ...p,
      tabs: p.tabs.map((t) =>
        t.route.kind === 'untitled' ? { ...t, route: { kind: 'untitled' as const, lang: t.route.lang, text: '', ...(t.route.target !== undefined && { target: t.route.target }) } } : t,
      ),
    })),
  });
  return JSON.stringify(trimmed).length < MAX_TABS_BYTES ? trimmed : undefined;
}
const MAX_EXPANDED = 2000;
const MAX_RECENT = 50;
const RECENT_KEY = 'kedalion.recentFiles';

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function storeRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch { /* recent files are a convenience */ }
}

const isRoute = (x: unknown): x is Route => {
  const r = x as { kind?: unknown; project?: unknown; path?: unknown; session?: unknown } | null;
  if (!r || typeof r !== 'object') return false;
  if (r.kind === 'welcome') return true;
  if (r.kind === 'untitled') {
    const u = x as { lang?: unknown; text?: unknown; target?: unknown; saved?: unknown };
    return typeof u.lang === 'string' && typeof u.text === 'string' && (u.target === undefined || typeof u.target === 'string') && (u.saved === undefined || typeof u.saved === 'boolean');
  }
  if (r.kind === 'diff') return isFileRef((x as { left?: unknown }).left) && isFileRef((x as { right?: unknown }).right);
  if (typeof r.project !== 'string' || typeof r.path !== 'string') return false;
  if (r.kind === 'details') {
    const sort = (x as { sort?: { column?: unknown; dir?: unknown } | null }).sort;
    return sort === undefined || sort === null || (typeof sort === 'object' && typeof sort.column === 'string' && (sort.dir === 'asc' || sort.dir === 'desc'));
  }
  return r.kind === 'file' || (r.kind === 'terminal' && (r.session === undefined || typeof r.session === 'string'));
};

interface State {
  sizes: [number, number];
  collapsed: boolean;
  expanded: Record<string, string[]>;
  /** Saved project ids shown in the sidebar; `shownIds` resolves them against the project list. */
  trees: string[];
  treeSizes?: [number, number];
  wrapLines: boolean;
  sqlSizes?: [number, number];
  connections?: Record<string, string>;
  layout: Layout<Route>;
}

function initialState(saved: ExplorerSettings | undefined, defaultWrap: boolean, restoreTabs: boolean): State {
  const expanded: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(saved?.expanded ?? {})) {
    if (Array.isArray(ids)) expanded[id] = ids.filter((x): x is string => typeof x === 'string');
  }
  const sizes = saved?.sizes;
  return {
    sizes: Array.isArray(sizes) && sizes.length === 2 && sizes.every((n) => typeof n === 'number') ? [sizes[0], sizes[1]] : [0.25, 0.75],
    collapsed: saved?.collapsed === true,
    expanded,
    trees: Array.isArray(saved?.trees) ? saved.trees.filter((x): x is string => typeof x === 'string').slice(0, 2) : [],
    treeSizes: saved?.treeSizes,
    wrapLines: saved?.wrapLines ?? defaultWrap,
    sqlSizes: saved?.sqlSizes,
    connections: saved?.connections,
    layout: (restoreTabs ? restore(saved?.tabs, isRoute) : undefined) ?? singlePane(newTab<Route>(UNTITLED)),
  };
}

/** Id of the project the sidebar shows: the saved one, else the first with expanded folders, else the first project. */
function shownId(state: State, list: Project[]): string | undefined {
  const saved = list.find((p) => p.id === state.trees[0]);
  return (saved ?? list.find((p) => state.expanded[p.id]) ?? list[0])?.id;
}

/** Projects shown in the sidebar, 1 or 2: the first as `shownId`, the second when saved and still listed. */
function shownIds(state: State, list: Project[]): string[] {
  const first = shownId(state, list);
  if (!first) return [];
  const second = list.find((p) => p.id === state.trees[1]);
  return second ? [first, second.id] : [first];
}

const sessionIds = (layout: Layout<Route>) =>
  new Set(layout.panes.flatMap((p) => p.tabs.flatMap((tab) => (tab.route.kind === 'terminal' && tab.route.session ? [tab.route.session] : []))));

const fresh = () => newTab<Route>(UNTITLED);

/** The route tab `tabId` shows now, if it is still open. */
const activeRoute = (layout: Layout<Route>, tabId: string) => layout.panes.flatMap((p) => p.tabs).find((x) => x.id === tabId)?.route;

/** `fn` applied to the route of every tab and to its history. */
function mapRoutes(layout: Layout<Route>, fn: (route: Route) => Route): Layout<Route> {
  return {
    ...layout,
    panes: layout.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => ({ ...tab, route: fn(tab.route), back: tab.back.map(fn), forward: tab.forward.map(fn) })),
    })),
  };
}

function closeTabsWhere(layout: Layout<Route>, matches: (route: Route) => boolean): Layout<Route> {
  let next = layout;
  for (const pane of layout.panes) {
    for (const tab of pane.tabs) if (matches(tab.route)) next = closeTab(next, tab.id, fresh);
  }
  return next;
}

/** Ids of `project` under `path`, the folder itself included. */
const idsUnder = (project: string, path: string) => (id: string) => id.startsWith(`${project}:`) && relPath.isUnder(id.slice(project.length + 1), path);

/** A file another view wants the Explorer to show: revealed in the tree, and opened when `open` (sent with `useViewLink('explorer')`). */
export interface ExplorerRequest {
  project: string;
  path: string;
  open: boolean;
}

export function ExplorerScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const projects = useAsync(() => api.projects(), []);
  const keys = useKeybindings();
  useFileIconVersion();
  const list = projects.data ?? [];
  const [state, setState] = useState(() => initialState(settings.explorer, editorSettingsOf(settings).wordWrap, fileSettingsOf(settings.files).restoreTabs));
  const latest = useRef(state);
  const [form, setForm] = useState<{ project?: Project }>();
  const [formError, setFormError] = useState<ApiError>();
  const [actionError, setActionError] = useState<ApiError>();
  const [focusedTree, setFocusedTree] = useState<0 | 1>(0);
  const zen = useZen();
  const [maximized, setMaximized] = useState(false);
  useCommand(commandById('explorer.zen'), () => setZen(!zen));
  useEffect(() => () => setZen(false), []);
  // Esc twice leaves Zen, as in VS Code; the first Esc still reaches whatever has the focus.
  useEffect(() => {
    if (!zen) return;
    let last = -Infinity;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.timeStamp - last < 800) setZen(false);
      last = e.timeStamp;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zen]);
  // Ctrl+F outside an editor or input would hit the webview's find (tree names included); search the open file instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.xp-pane, .cm-editor, input, textarea, .code-view')) return;
      if (openEditorSearch(t?.closest('.pane') ?? document)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const copyPath = useCopyPath();
  const undo = useFileUndo();

  const persist = useDebouncedSave((s: State) => {
    const tabs = tabsToSave(s.layout);
    onSave({
      explorer: {
        sizes: s.sizes,
        collapsed: s.collapsed,
        expanded: s.expanded,
        ...(s.trees.length > 0 && { trees: s.trees }),
        ...(s.treeSizes && { treeSizes: s.treeSizes }),
        wrapLines: s.wrapLines,
        ...(s.sqlSizes && { sqlSizes: s.sqlSizes }),
        ...(s.connections && { connections: s.connections }),
        ...(tabs !== undefined && { tabs }),
      },
    });
  });
  const files = fileSettingsOf(settings.files);
  const sql: ExplorerSqlProps = {
    workbench: settings.workbench,
    onWorkbenchChange: (workbench) => onSave({ workbench }),
    connections: state.connections,
    onConnectionsChange: (connections) => update((s) => ({ ...s, connections })),
    sizes: state.sqlSizes,
    onSizesChange: (sqlSizes) => update((s) => ({ ...s, sqlSizes })),
    restEnvironment: settings.rest?.environment ?? '',
  };
  const [logs, setLogs] = useState<LogSettings | undefined>(settings.logs);
  const saveLogs = useDebouncedSave((l: LogSettings) => onSave({ logs: l }));
  const changeLogs = (next: LogSettings) => {
    setLogs(next);
    saveLogs(next);
  };
  const update = (fn: (s: State) => State) => {
    const next = fn(latest.current);
    const kept = sessionIds(next.layout);
    for (const id of sessionIds(latest.current.layout)) if (!kept.has(id)) void closeSession(id).catch(() => {});
    latest.current = next;
    setState(next);
    persist(next);
  };
  const setExpanded = (project: string, ids: string[]) =>
    update((s) => ({ ...s, expanded: { ...s.expanded, [project]: ids.slice(-MAX_EXPANDED) } }));

  /** Shows `id` in tree `at`, expanding its root the first time. */
  const pickProject = (id: string, at = 0) =>
    update((s) => {
      const shown = shownIds(s, list);
      return {
        ...s,
        trees: at === 0 ? [id, ...shown.slice(1)] : [shown[0] ?? id, id],
        expanded: s.expanded[id] ? s.expanded : { ...s.expanded, [id]: [nodeId(id, '')] },
      };
    });


  /** Shows a second tree below, on the project after the first (the same one when it is the only one). */
  const splitTree = () =>
    update((s) => {
      const shown = shownIds(s, list);
      if (shown.length !== 1) return s;
      const next = list[(list.findIndex((p) => p.id === shown[0]) + 1) % list.length];
      return { ...s, trees: [shown[0], next.id], expanded: s.expanded[next.id] ? s.expanded : { ...s.expanded, [next.id]: [nodeId(next.id, '')] } };
    });

  const closeSecondTree = () => {
    setFocusedTree(0);
    update((s) => ({ ...s, trees: shownIds(s, list).slice(0, 1) }));
  };

  /** Opens a file; `preview` opens it in the pane's preview tab, which a later preview replaces. An already open file is only shown (and kept open unless `preview`). */
  const openFile = (project: string, path: string, preview = false) =>
    update((s) => {
      const target: Route = { kind: 'file', project, path };
      for (const pane of s.layout.panes) {
        const same = pane.tabs.find((x) => x.route.kind === 'file' && x.route.project === project && x.route.path === path);
        if (same) {
          const shown = activate(s.layout, pane.id, same.id);
          return { ...s, layout: preview ? shown : pinTab(shown, same.id) };
        }
      }
      const pane = focusedPane(s.layout);
      const slot = preview ? pane.tabs.find((x) => x.preview) : undefined;
      if (slot) return { ...s, layout: activate(navigate(s.layout, slot.id, target, { replace: true }), pane.id, slot.id) };
      const current = activeTab(s.layout);
      if (isBlank(current.route)) {
        const layout = navigate(s.layout, current.id, target, { replace: true });
        return { ...s, layout: preview ? setPreview(layout, current.id, true) : layout };
      }
      const tab = newTab(target);
      return { ...s, layout: addTab(s.layout, preview ? { ...tab, preview: true } : tab) };
    });

  const openFileToSide = (project: string, path: string) =>
    update((s) => ({ ...s, layout: openBeside(s.layout, newTab<Route>({ kind: 'file', project, path })) }));

  const openTerminal = (project: string, path: string) =>
    update((s) => {
      const target: Route = { kind: 'terminal', project, path };
      const current = activeTab(s.layout);
      const layout = isBlank(current.route) ? navigate(s.layout, current.id, target, { replace: true }) : addTab(s.layout, newTab(target));
      return { ...s, layout };
    });

  const [compareWith, setCompareWith] = useState<FileRef>();
  const openCompare = (left: FileRef, right: FileRef) =>
    update((s) => {
      const target: Route = { kind: 'diff', left, right };
      const current = activeTab(s.layout);
      const layout = isBlank(current.route) ? navigate(s.layout, current.id, target, { replace: true }) : addTab(s.layout, newTab(target));
      return { ...s, layout };
    });

  const openDetails = (project: string, path: string) =>
    update((s) => {
      const target: Route = { kind: 'details', project, path };
      const current = activeTab(s.layout);
      const layout = isBlank(current.route) ? navigate(s.layout, current.id, target, { replace: true }) : addTab(s.layout, newTab(target));
      return { ...s, layout };
    });

  const onSession = (tabId: string, session: string) => {
    const tab = latest.current.layout.panes.flatMap((p) => p.tabs).find((x) => x.id === tabId);
    if (!tab || tab.route.kind !== 'terminal' || tab.route.session === session) return;
    const route = tab.route;
    update((s) => ({ ...s, layout: navigate(s.layout, tabId, { ...route, session }, { replace: true }) }));
  };

  // Open tabs and expanded folders follow a rename or move.
  const moved = (project: string, from: string, to: string) => {
    setCompareWith((c) => c && movedRef(c, project, from, to));
    update((s) => ({
      ...s,
      layout: mapRoutes(s.layout, (r) =>
        (r.kind === 'file' || r.kind === 'details') && r.project === project && relPath.isUnder(r.path, from)
          ? { ...r, path: relPath.moved(r.path, from, to) }
          : r.kind === 'diff'
            ? { ...r, left: movedRef(r.left, project, from, to), right: movedRef(r.right, project, from, to) }
            : r,
      ),
      expanded: s.expanded[project]
        ? {
            ...s.expanded,
            [project]: s.expanded[project].map((id) => (idsUnder(project, from)(id) ? nodeId(project, relPath.moved(id.slice(project.length + 1), from, to)) : id)),
          }
        : s.expanded,
    }));
  };

  const dirtyCount = (project: string, paths: string[]) =>
    latest.current.layout.panes
      .flatMap((p) => p.tabs)
      .filter((x) => x.dirty && x.route.kind === 'file' && x.route.project === project && paths.some((path) => relPath.isUnder(x.route.kind === 'file' ? x.route.path : '', path))).length;

  const deleted = (project: string, path: string) => {
    setCompareWith((c) => (c && refUnder(c, project, path) ? undefined : c));
    update((s) => ({
      ...s,
      layout: closeTabsWhere(s.layout, (r) =>
        r.kind === 'file' || r.kind === 'details' ? r.project === project && relPath.isUnder(r.path, path) : r.kind === 'diff' && (refUnder(r.left, project, path) || refUnder(r.right, project, path)),
      ),
      expanded: s.expanded[project] ? { ...s.expanded, [project]: s.expanded[project].filter((id) => !idsUnder(project, path)(id)) } : s.expanded,
    }));
  };

  const removeProject = async (project: Project) => {
    setActionError(undefined);
    try {
      await api.deleteProject(project.id);
    } catch (err) {
      setActionError(errorOf(err));
      return;
    }
    const at = list.findIndex((p) => p.id === project.id);
    const next = list[at + 1] ?? list[at - 1];
    update((s) => {
      const { [project.id]: _removed, ...expanded } = s.expanded;
      const rest = s.trees.filter((x) => x !== project.id);
      const shownRemoved = s.trees[0] === project.id || (s.trees.length === 0 && shownId(s, list) === project.id);
      const trees = shownRemoved && next ? [next.id, ...rest] : rest;
      if (shownRemoved && next && !expanded[next.id]) expanded[next.id] = [nodeId(next.id, '')];
      return { ...s, expanded, trees, layout: closeTabsWhere(s.layout, (r) => (r.kind === 'diff' ? r.left.project === project.id || r.right.project === project.id : (r.kind === 'file' || r.kind === 'details') && r.project === project.id)) };
    });
    projects.reload();
  };

  const submitForm = async (values: Record<string, unknown>) => {
    if (!form) return;
    setFormError(undefined);
    try {
      const saved = form.project ? await api.updateProject(form.project.id, values) : await api.createProject(values);
      setForm(undefined);
      projects.reload();
      if (!form.project) pickProject(saved.id, focus);
    } catch (err) {
      setFormError(errorOf(err));
    }
  };

  const fields: FieldSpec[] = [
    { key: 'name', label: t('explorer.projectName'), kind: 'text', required: true },
    { key: 'path', label: t('explorer.projectPath'), kind: 'path', required: true },
  ];

  const nameOf = (id: string) => list.find((p) => p.id === id)?.name ?? id;
  const pathOf = (id: string) => list.find((p) => p.id === id)?.path;
  /** An untitled tab saved to `path`: inside a project it becomes that file's tab, elsewhere it keeps writing to `path`. */
  const savedUntitled = (tabId: string, path: string, text: string) =>
    update((s) => {
      const now = activeRoute(s.layout, tabId);
      if (now?.kind !== 'untitled') return s;
      for (const p of list) {
        const rel = relativeInside(p.path, path);
        if (rel) return { ...s, layout: navigate(s.layout, tabId, { kind: 'file', project: p.id, path: rel }, { replace: true }) };
      }
      return { ...s, layout: navigate(s.layout, tabId, { ...now, text, target: path, saved: true }, { replace: true }) };
    });
  const titleOf = (route: Route) =>
    route.kind === 'welcome'
      ? { title: t('explorer.welcome') }
      : route.kind === 'untitled'
        ? {
          title: route.target ? relPath.basename(route.target.replace(/\\/g, '/')) : t('explorer.untitled'),
          ...(route.target && { tooltip: route.target }),
          ...fileIconOf(untitledName(route.lang)),
        }
      : route.kind === 'terminal'
        ? { title: `${t('explorer.shared.terminalTab')} · ${relPath.basename(route.path) || nameOf(route.project)}`, icon: 'terminal' as const }
        : route.kind === 'diff'
          ? {
            title: `${relPath.basename(route.left.path)} ↔ ${relPath.basename(route.right.path)}`,
            tooltip: `${nameOf(route.left.project)}/${route.left.path} ↔ ${nameOf(route.right.project)}/${route.right.path}`,
            ...fileIconOf(relPath.basename(route.right.path)),
          }
          : route.kind === 'details'
            ? { title: relPath.basename(route.path) || nameOf(route.project), tooltip: `${nameOf(route.project)}/${route.path}`, icon: 'table' as const }
            : {
          title: relPath.basename(route.path),
          tooltip: `${nameOf(route.project)}/${route.path}`,
          location: [nameOf(route.project), relPath.dirname(route.path)].filter(Boolean).join('/'),
          ...fileIconOf(relPath.basename(route.path)),
        };

  const menuOf = (route: Route): ContextMenuItem[] => {
    const project = route.kind === 'file' ? list.find((p) => p.id === route.project) : undefined;
    if (route.kind !== 'file' || !project) return [];
    return [
      { id: 'revealInTree', label: t('explorer.revealInTree'), icon: 'locate', run: () => revealFile(route.project, route.path) },
      { id: 'copyFullPath', label: t('explorer.copyFullPath'), icon: 'copy', run: () => copyPath(fullPath(project.path, route.path)) },
      { id: 'copyPath', label: t('explorer.copyPath'), icon: 'copy', run: () => copyPath(route.path) },
    ];
  };

  const shown = shownIds(state, list).flatMap((id) => list.find((p) => p.id === id) ?? []);
  const focus = shown.length > 1 ? focusedTree : 0;

  const names = useNameIndex(list, files.exclude);
  const [recent, setRecent] = useState(loadRecent);
  const quickFiles = useMemo<QuickOpenFile[]>(
    () => shown.flatMap((p) => (names.entries[p.id] ?? []).filter((h) => h.kind === 'file').map((h) => ({ id: `${p.id}:${h.path}`, path: h.path, project: shown.length > 1 ? p.name : undefined }))),
    [shown.map((p) => p.id).join(','), names.entries],
  );
  useProvideQuickOpen(
    useMemo(
      () => ({
        files: quickFiles,
        loading: names.loading,
        recent,
        onOpen: () => names.ensure(shown.map((p) => p.id)),
        open: (file, side) => {
          const project = file.id.slice(0, file.id.length - file.path.length - 1);
          if (side) openFileToSide(project, file.path);
          else openFile(project, file.path, files.previewTabs);
        },
      }),
      [quickFiles, names.loading, names.ensure, recent, files.previewTabs],
    ),
  );

  const trees = useRef<Array<ProjectTreeApi | null>>([]);
  const revealRequest = useRef<{ project: string; path: string }>();
  const [revealTick, setRevealTick] = useState(0);
  const active = activeTab(state.layout).route;
  const activeFile = active.kind === 'file' ? active : undefined;
  const shownKey = shown.map((p) => p.id).join(',');
  const revealIn = (project: string, path: string, autoReveal = false) => {
    const at = shown.findIndex((p) => p.id === project);
    if (at < 0) return false;
    const tree = trees.current[at];
    if (autoReveal && tree?.finding()) tree.scrollTo(path);
    else tree?.reveal(path);
    return true;
  };
  const revealFile = (project: string, path: string) => {
    revealRequest.current = { project, path };
    if (!shown.some((p) => p.id === project)) pickProject(project, focus);
    setRevealTick((n) => n + 1);
  };
  // A file sent by another screen (Git): reveal it, and open it when asked.
  const { request: pendingRequest, take: takeRequest } = useViewRequest<ExplorerRequest>('explorer');
  useEffect(() => {
    if (!projects.data || !pendingRequest) return;
    const request = takeRequest();
    if (!request) return;
    if (request.open) openFile(request.project, request.path);
    revealFile(request.project, request.path);
  }, [projects.data, pendingRequest]);
  useCommand(commandById('explorer.revealInTree'), () => activeFile && revealFile(activeFile.project, activeFile.path), { enabled: !!activeFile });

  useEffect(() => {
    if (!activeFile) return;
    const id = `${activeFile.project}:${activeFile.path}`;
    setRecent((r) => {
      const next = [id, ...r.filter((x) => x !== id)].slice(0, MAX_RECENT);
      storeRecent(next);
      return next;
    });
  }, [activeFile?.project, activeFile?.path]);

  useEffect(() => {
    const request = revealRequest.current;
    if (request) {
      if (revealIn(request.project, request.path)) revealRequest.current = undefined;
      return;
    }
    if (!files.autoReveal || !activeFile || /(^|\/)(node_modules|\.git)(\/|$)/.test(activeFile.path)) return;
    revealIn(activeFile.project, activeFile.path, true);
  }, [activeFile?.project, activeFile?.path, shownKey, revealTick, files.autoReveal]);

  const pickerHandlers = {
    onAdd: () => {
      setFormError(undefined);
      setForm({});
    },
    onEdit: (p: Project) => {
      setFormError(undefined);
      setForm({ project: p });
    },
    onRemove: (p: Project) => void removeProject(p),
    onReorder: (ids: string[]) => {
      setActionError(undefined);
      api.reorderProjects(ids).then(projects.reload, (err) => setActionError(errorOf(err)));
    },
  };

  const sidebar = (
    <>
      {actionError && <ErrorBanner error={actionError} compact />}
      {projects.error && <ErrorBanner error={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data ? (
        <div className="xp-loading"><Spinner small /></div>
      ) : (
        <>
          {shown.length === 0 ? (
            <ProjectPicker projects={list} current={undefined} {...pickerHandlers} onPick={(p) => pickProject(p.id)} />
          ) : (
            <SplitView
              direction="column"
              sizes={shown.length > 1 ? (state.treeSizes ?? [0.5, 0.5]) : [1]}
              defaultSizes={[0.5, 0.5]}
              min={[120, 120]}
              onResize={(sizes) => shown.length > 1 && update((s) => ({ ...s, treeSizes: [sizes[0], sizes[1]] }))}
            >
              {shown.map((project, i) => (
                <TreePane
                  key={`${i}:${project.id}`}
                  project={project}
                  projects={list}
                  focused={focus === i}
                  exclude={files.exclude}
                  compact={files.compactFolders}
                  confirmDelete={files.confirmDelete}
                  confirmDragDrop={files.confirmDragDrop}
                  gitDecorations={gitSettingsOf(settings).explorerDecorations}
                  showHidden={files.showHidden}
                  nesting={files.fileNesting ? files.nestingPatterns : undefined}
                  sort={files.sortOrder}
                  names={names.entries[project.id]}
                  ensureNames={() => names.ensure([project.id], 30_000)}
                  onFocus={() => setFocusedTree(i as 0 | 1)}
                  onPick={(p) => pickProject(p.id, i)}
                  {...pickerHandlers}
                  expanded={state.expanded[project.id] ?? [nodeId(project.id, '')]}
                  onExpandedChange={(ids) => setExpanded(project.id, ids)}
                  onExpandedAdd={(id) =>
                    update((s) => {
                      const ids = s.expanded[project.id] ?? [nodeId(project.id, '')];
                      return ids.includes(id) ? s : { ...s, expanded: { ...s.expanded, [project.id]: [...ids, id].slice(-MAX_EXPANDED) } };
                    })
                  }
                  onOpenFile={(p, path) => openFile(p, path)}
                  apiRef={(h) => void (trees.current[i] = h)}
                  onOpenFileToSide={openFileToSide}
                  onPreviewFile={files.previewTabs ? (p, path) => openFile(p, path, true) : undefined}
                  onOpenTerminal={openTerminal}
                  compareWith={compareWith}
                  onSelectForCompare={(p, path) => setCompareWith({ project: p, path })}
                  onCompare={openCompare}
                  onOpenDetails={openDetails}
                  onMoved={moved}
                  onDeleted={deleted}
                  undo={undo}
                  dirtyCount={dirtyCount}
                  onGoToFile={activeFile ? () => revealFile(activeFile.project, activeFile.path) : undefined}
                  onSplit={i === 0 && shown.length === 1 ? splitTree : undefined}
                  onCloseTree={i === 1 ? closeSecondTree : undefined}
                />
              ))}
            </SplitView>
          )}
        </>
      )}
    </>
  );

  const screen = (
    <>
      <Explorer
        hidden={zen || maximized}
        side={windowSettingsOf(settings).sidebarSide}
        sidebar={sidebar}
        sizes={state.sizes}
        onResize={(sizes) => update((s) => ({ ...s, sizes }))}
        collapsed={state.collapsed}
        onCollapsedChange={(collapsed) => update((s) => ({ ...s, collapsed }))}
        scope="explorer"
      >
        <TabWorkspace
          confirmCloseDirty={generalSettingsOf(settings).confirmCloseDirty}
          layout={state.layout}
          onChange={(layout) => update((s) => ({ ...s, layout }))}
          titleOf={titleOf}
          menuOf={menuOf}
          newRoute={() => UNTITLED}
          scope="explorer"
          onMaximizedChange={setMaximized}
          renderTab={(tab, ctx) =>
            tab.route.kind === 'file' ? (
              <Suspense fallback={<PanelLoading />}>
                <FileTab key={`${tab.route.project}\0${tab.route.path}`} project={tab.route.project} projectName={nameOf(tab.route.project)} projectPath={pathOf(tab.route.project)} path={tab.route.path} focused={ctx.focused} preview={tab.preview} logs={logs} onLogsChange={changeLogs} onDirty={ctx.setDirty} onSaver={ctx.setSaver} onActions={ctx.setActions} sql={sql} wrapLines={state.wrapLines} onWrapLinesChange={(wrapLines) => update((s) => ({ ...s, wrapLines }))} files={files} onOpenPath={(p) => tab.route.kind === 'file' && openFile(tab.route.project, p, files.previewTabs)} />
              </Suspense>
            ) : tab.route.kind === 'untitled' ? (
              <Suspense fallback={<PanelLoading />}>
                {(() => {
                  const route = tab.route;
                  const home = shown[focus] ?? list[0];
                  return (
                    <UntitledTab
                      lang={route.lang}
                      text={route.text}
                      target={route.target}
                      saved={route.saved}
                      project={home?.id}
                      start={home?.path}
                      focused={ctx.focused}
                      wrapLines={state.wrapLines}
                      onWrapLinesChange={(wrapLines) => update((s) => ({ ...s, wrapLines }))}
                      files={files}
                      sql={sql}
                      onChange={(patch) => update((s) => {
                        const now = activeRoute(s.layout, tab.id);
                        return now?.kind === 'untitled' ? { ...s, layout: navigate(s.layout, tab.id, { ...now, ...patch }, { replace: true }) } : s;
                      })}
                      onSaved={(path, text) => savedUntitled(tab.id, path, text)}
                      onDirty={ctx.setDirty}
                      onSaver={ctx.setSaver}
                      onActions={ctx.setActions}
                    />
                  );
                })()}
              </Suspense>
            ) : tab.route.kind === 'terminal' ? (
              <Suspense fallback={<PanelLoading />}>
                <TerminalPane
                  session={tab.route.session}
                  cwd={{ root: tab.route.project, path: tab.route.path }}
                  onSession={(id) => onSession(tab.id, id)}
                  appKeys={terminalAppKeys('explorer', keys?.defs ?? [], ['explorer.zen'])}
                />
              </Suspense>
            ) : tab.route.kind === 'details' ? (
              <Suspense fallback={<PanelLoading />}>
                {(() => {
                  const route = tab.route;
                  const project = list.find((p) => p.id === route.project);
                  return project ? (
                    <DetailsTab
                      project={project}
                      path={route.path}
                      exclude={files.exclude}
                      showHidden={files.showHidden}
                      sort={route.sort ?? null}
                      onSortChange={(sort) => update((s) => ({ ...s, layout: navigate(s.layout, tab.id, { ...route, sort }, { replace: true }) }))}
                      onNavigate={(path) => update((s) => ({ ...s, layout: navigate(s.layout, tab.id, { ...route, path }) }))}
                      onOpenFile={(path) => openFile(route.project, path, files.previewTabs)}
                      onDeleted={deleted}
                      dirtyCount={dirtyCount}
                      confirmDelete={files.confirmDelete}
                    />
                  ) : <PanelLoading />;
                })()}
              </Suspense>
            ) : tab.route.kind === 'diff' ? (
              <Suspense fallback={<PanelLoading />}>
                <CompareTab left={tab.route.left} right={tab.route.right} mode={gitSettingsOf(settings).diffMode} />
              </Suspense>
            ) : (
              <Welcome projects={list} onOpen={pickProject} />
            )
          }
        />
      </Explorer>
      {form && (
        <Modal title={t(form.project ? 'explorer.projectEdit' : 'explorer.projectAdd')} onClose={() => setForm(undefined)}>
          <ResourceForm
            fields={fields}
            value={{ ...form.project }}
            error={formError}
            onCancel={() => setForm(undefined)}
            onBrowse={() => dialogs.pickFolder({ title: t('explorer.pickFolder'), purpose: 'project' })}
            onSubmit={(values) => void submitForm(values)}
          />
        </Modal>
      )}
    </>
  );
  return screen;
}

/** The commands an empty editor area lists, like VS Code's watermark; keys follow the user's keymap. */
const WATERMARK = [
  { id: 'palette.quickOpen', label: 'explorer.watermark.quickOpen' },
  { id: 'explorer.search', label: 'explorer.watermark.search' },
  { id: 'explorer.toggleSidebar', label: 'explorer.watermark.tree' },
  { id: 'palette.toggle', label: 'explorer.watermark.palette' },
  { id: 'explorer.zen', label: 'explorer.watermark.zen' },
] as const;

function Welcome({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const chordOf = useChordOf();
  const hints = WATERMARK.flatMap((w) => {
    const key = chordOf(w.id);
    return key ? [{ ...w, key }] : [];
  });
  return (
    <div className="content">
      <PageHead title={t('explorer.welcome')} />
      <div className="scroll">
        <Empty title={t('explorer.welcomeTitle')}>
          <p className="muted">{t('explorer.welcomeHint')}</p>
        </Empty>
        {projects.length > 0 && (
          <div className="chips">
            {projects.map((p) => (
              <button key={p.id} className="chip" onClick={() => onOpen(p.id)} title={p.name}>{p.name}</button>
            ))}
          </div>
        )}
        {hints.length > 0 && (
          <dl className="xp-watermark">
            {hints.map((h) => (
              <div key={h.id}>
                <dt>{t(h.label)}</dt>
                <dd><kbd>{h.key}</kbd></dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
