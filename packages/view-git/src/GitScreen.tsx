import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { DiffMode, DiffViewHandle } from '@kedalion/editor';
import type { GitFile, GitRepoInfo, GitStatus } from '@kedalion/server-core/protocol';
import { type ApiError, ContextMenu, type ContextMenuItem, copyNotify, copyText, useShortcutTip, Empty, ErrorBanner, errorMessage, errorOf, Explorer, fileIconOf, Icon, IconButton, ProjectPicker, statusOf, useCommand, useDebouncedSave, useFileIconVersion, useRovingList, useToast, useViewLayout, useViewCompact, useViewLink, useViewRequest } from '@kedalion/ui';
import { type GitProject as Project, gitApi as api } from './client';
import { gitCommands } from './commands';
import { t } from './i18n';
import type { GitSection, GitViewSettings, GitViewState } from './settings';
import { type ChangeFolder, changeTree, folderPaths } from './git/change-tree';
import { type GitDiffSource, GitDiffPane } from './git/GitDiffPane';
import { HistoryPanel } from './git/HistoryPanel';
import { ReadThroughView } from './git/ReadThroughView';
import './git.css';

const commandById = (id: string) => gitCommands().find((c) => c.id === id)!;

/** A working-tree change or a file of a commit in the History panel. */
type Selection = { root: string } & GitDiffSource;

interface View {
  project?: string;
  sizes: [number, number];
  collapsed: boolean;
  view: 'list' | 'tree';
  closed: GitSection[];
  historyOpen: boolean;
  historySize: number;
}

/** VS Code's Source Control groups: untracked files sit in Changes with the letter U. */
const SECTIONS: { id: GitSection; groups: GitFile['group'][] }[] = [
  { id: 'merge', groups: ['conflict'] },
  { id: 'staged', groups: ['staged'] },
  { id: 'changes', groups: ['unstaged', 'untracked'] },
];
const DEFAULT_SIZES: [number, number] = [0.25, 0.75];
const INDENT = 16;

const DEFAULT_HISTORY_SIZE = 0.4;

const keyOf = (file: GitFile) => `${file.group}\0${file.path}`;
const selectionKey = (sel: Selection) => (sel.commit === undefined ? keyOf(sel.file) : `${sel.commit}\0${sel.file.path}`);
const isDeleted = (sel: Selection) =>
  sel.commit !== undefined ? sel.file.status === 'D' : sel.file.group === 'staged' ? sel.file.index === 'D' : sel.file.worktree === 'D';

function initialView(saved: GitViewState | undefined): View {
  return {
    project: saved?.project,
    sizes: saved?.sizes ?? DEFAULT_SIZES,
    collapsed: saved?.collapsed ?? false,
    view: saved?.view ?? 'list',
    closed: saved?.closedSections ?? [],
    historyOpen: saved?.historyOpen ?? false,
    historySize: saved?.historySize ?? DEFAULT_HISTORY_SIZE,
  };
}

/** The saved project when it still exists, else the first project that is a repository, else the first. */
function focusOf(saved: string | undefined, projects: Project[], infos: GitRepoInfo[]): string | undefined {
  if (saved && projects.some((p) => p.id === saved)) return saved;
  const repos = new Set(infos.filter((i) => i.repo).map((i) => i.root));
  return (projects.find((p) => repos.has(p.id)) ?? projects[0])?.id;
}

/** Changed files of one project with the diff of the selected one, laid out like VS Code's Source Control view. Read-only. */
/** A file for the Explorer view to show (same shape it reads with `useViewRequest`). */
interface ExplorerRequest {
  project: string;
  path: string;
  open: boolean;
}

/** A commit for the Git view to show (same shape it reads with `useViewRequest`). */
interface GitCommitRequest {
  project: string;
  /** Full hash. */
  commit: string;
}

export function GitScreen({ settings, onSave }: { settings: GitViewSettings; onSave: (patch: Partial<GitViewSettings>) => void }) {
  const [view, setView] = useState(() => initialView(settings.gitView));
  const latest = useRef(view);
  const [projects, setProjects] = useState<Project[]>();
  const [info, setInfo] = useState<GitRepoInfo>();
  const [root, setRoot] = useState<string>();
  useFileIconVersion();
  const [status, setStatus] = useState<GitStatus>();
  const [statusError, setStatusError] = useState<ApiError>();
  const [loadError, setLoadError] = useState<ApiError>();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selection>();
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<DiffMode>(settings.git?.diffMode ?? 'split');
  const diff = useRef<DiffViewHandle>(null);
  const list = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const toast = useToast();
  const tip = useShortcutTip();
  useRovingList(list, '.git-row');
  const compact = useViewCompact();
  const readThrough = !compact && useViewLayout('git') === 'read-through';

  const persist = useDebouncedSave((v: View) =>
    onSave({
      gitView: {
        ...(v.project && { project: v.project }),
        sizes: v.sizes,
        collapsed: v.collapsed,
        view: v.view,
        closedSections: v.closed,
        historyOpen: v.historyOpen,
        historySize: v.historySize,
      },
    }),
  );
  const update = (fn: (v: View) => View) => {
    const next = fn(latest.current);
    latest.current = next;
    setView(next);
    persist(next);
  };

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const [projectList, infos] = await Promise.all([api.projects(), api.gitRepos()]);
      const id = focusOf(latest.current.project, projectList, infos);
      const repo = infos.find((i) => i.root === id);
      let next: GitStatus | undefined;
      let error: ApiError | undefined;
      if (id && repo?.repo) {
        try {
          next = await api.gitStatus(id);
        } catch (e) {
          error = errorOf(e);
        }
      }
      if (mine !== seq.current) return;
      setProjects(projectList);
      setRoot(id);
      setInfo(repo);
      setStatus(next);
      setStatusError(error);
      setLoadError(undefined);
      setSelected((sel) => {
        if (!sel || sel.root !== id) return undefined;
        if (sel.commit !== undefined) return sel;
        const file = next?.files.find((f) => keyOf(f) === keyOf(sel.file));
        return file ? { root: sel.root, file } : undefined;
      });
      setTick((n) => n + 1);
    } catch (e) {
      if (mine === seq.current) setLoadError(errorOf(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // On screen show and whenever the window gets the focus back; no polling.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useCommand(commandById('git.refresh'), () => void refresh());
  useCommand(commandById('git.nextChange'), () => void diff.current?.next(), { enabled: !!selected });
  useCommand(commandById('git.prevChange'), () => void diff.current?.prev(), { enabled: !!selected });

  const pick = (project: Project) => {
    if (project.id === root) return;
    update((v) => ({ ...v, project: project.id }));
    setSelected(undefined);
    setStatus(undefined);
    setStatusError(undefined);
    setClosedFolders(new Set());
    void refresh();
  };

  // A commit sent by another screen (Agents): switch to its project, open History and reveal it.
  const { request: pendingCommit, take: takeCommit } = useViewRequest<GitCommitRequest>('git');
  const [reveal, setReveal] = useState<string>();
  useEffect(() => {
    if (!projects || !pendingCommit) return;
    const request = takeCommit();
    if (!request) return;
    const norm = (p: string) => p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    const target = projects.find((p) => norm(p.path) === norm(request.project));
    if (!target) {
      toast({ message: t('git.projectMissing'), kind: 'error' });
      return;
    }
    pick(target);
    update((v) => ({ ...v, historyOpen: true }));
    setReveal(request.commit);
  }, [projects, pendingCommit]);

  const copyPatch = async () => {
    if (!selected) return;
    try {
      const patch = await api.gitDiff(selected.root, selected.file.path, selected.commit === undefined && selected.file.group === 'staged', selected.commit);
      if (!patch.text) return toast({ message: t('git.noPatch') });
      await copyText(patch.text);
      toast({ message: t(patch.truncated ? 'git.patchTruncated' : 'git.patchCopied') });
    } catch (e) {
      toast({ message: errorMessage(errorOf(e)), kind: 'error' });
    }
  };

  const linkExplorer = useViewLink<ExplorerRequest>('explorer');
  const toExplorer = (sel: Selection | undefined, open: boolean) => {
    if (!sel || isDeleted(sel) || !linkExplorer) return;
    linkExplorer({ project: sel.root, path: sel.file.path, open });
  };
  const deleted = !!selected && isDeleted(selected);

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => {
        const files = status?.files.filter((f) => s.groups.includes(f.group)) ?? [];
        return { ...s, files, tree: view.view === 'tree' ? changeTree(files) : undefined };
      }).filter((s) => s.files.length > 0),
    [status, view.view],
  );

  const allFolders = () => sections.flatMap((s) => (s.tree ? folderPaths(s.tree).map((p) => `${s.id}\0${p}`) : []));
  const anyOpen = allFolders().some((k) => !closedFolders.has(k));
  const toggleAll = () => setClosedFolders(anyOpen ? new Set(allFolders()) : new Set());
  const toggleSection = (id: GitSection) => update((v) => ({ ...v, closed: v.closed.includes(id) ? v.closed.filter((x) => x !== id) : [...v.closed, id] }));
  const toggleFolder = (key: string) =>
    setClosedFolders((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** Left / Right close and open a section or folder row, like a tree. */
  const openKeys = (open: boolean, toggle: () => void) => (e: KeyboardEvent) => {
    if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) {
      e.preventDefault();
      toggle();
    }
  };

  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] }>();
  const openMenu = (e: ReactMouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: { x: e.clientX, y: e.clientY }, items });
  };

  const fileRow = (file: GitFile, depth: number, inTree: boolean) => {
    const key = keyOf(file);
    const active = !!selected && selected.root === root && selected.commit === undefined && keyOf(selected.file) === key;
    const { letter, tone } = statusOf(file);
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const dir = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
    const icon = fileIconOf(name);
    const sel = root ? { root, file } : undefined;
    return (
      <button
        key={key}
        type="button"
        className={`tree-row git-row git-${tone}${active ? ' selected' : ''}`}
        style={{ paddingLeft: 4 + INDENT * (depth + 1) }}
        title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        onClick={() => setSelected(sel)}
        onFocus={() => setSelected(sel)}
        onDoubleClick={() => toExplorer(sel, true)}
        onContextMenu={(e) =>
          openMenu(e, [
            { id: 'select', label: t('git.select'), icon: 'file', run: () => setSelected(sel) },
            { id: 'open', label: t('git.openFile'), icon: 'file', disabled: !sel || isDeleted(sel), run: () => toExplorer(sel, true) },
            { id: 'path', label: t('git.copyPath'), icon: 'copy', run: () => void copyNotify(file.path) },
          ])
        }
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          toExplorer(sel, true);
        }}
      >
        {inTree && <span className="git-spacer" />}
        <span className={`tree-icon${icon.tone ? ` tone-${icon.tone}` : ''}`}><Icon name={icon.icon} size={14} /></span>
        <span className="tree-label">
          {name}
          {!inTree && dir && <span className="git-dir">{dir}</span>}
        </span>
        <span className="tree-badge">{letter}</span>
      </button>
    );
  };

  const folderRows = (section: GitSection, folder: ChangeFolder, depth: number): ReactNode[] =>
    folder.folders.flatMap((f) => {
      const key = `${section}\0${f.path}`;
      const open = !closedFolders.has(key);
      return [
        <button
          key={`d:${key}`}
          type="button"
          className="tree-row git-row"
          style={{ paddingLeft: 4 + INDENT * (depth + 1) }}
          title={f.path}
          aria-expanded={open}
          onClick={() => toggleFolder(key)}
          onContextMenu={(e) =>
            openMenu(e, [
              { id: 'toggle', label: t(open ? 'git.collapse' : 'git.expand'), icon: 'chevron', run: () => toggleFolder(key) },
              { id: 'path', label: t('git.copyPath'), icon: 'copy', run: () => void copyNotify(f.path) },
            ])
          }
          onKeyDown={openKeys(open, () => toggleFolder(key))}
        >
          <span className={`tree-chevron${open ? ' open' : ''}`}><Icon name="chevron" size={12} /></span>
          <span className="tree-icon"><Icon name="folder" size={14} /></span>
          <span className="tree-label">{f.name}</span>
        </button>,
        ...(open ? [...folderRows(section, f, depth + 1), ...f.files.map((file) => fileRow(file, depth + 1, true))] : []),
      ];
    });

  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrap = useRef<HTMLDivElement>(null);
  const [moreBox, setMoreBox] = useState<{ top: number; right: number; maxHeight: number }>();
  useEffect(() => {
    if (!moreOpen || !moreWrap.current) return setMoreBox(undefined);
    const r = moreWrap.current.getBoundingClientRect();
    setMoreBox({ top: r.bottom + 4, right: window.innerWidth - r.right, maxHeight: Math.max(120, window.innerHeight - r.bottom - 12) });
  }, [moreOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const away = (e: MouseEvent) => {
      if (!moreWrap.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [moreOpen]);
  const item = (icon: 'copy' | 'file' | 'locate', label: string, act: () => void, disabled: boolean) => (
    <button title={label}
      type="button"
      className="menu-item"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        setMoreOpen(false);
        act();
      }}
    >
      <span className="menu-icon"><Icon name={icon} size={14} /></span>
      <span className="menu-label">{label}</span>
    </button>
  );

  const tree = view.view === 'tree';
  const iconButton = (icon: 'refresh' | 'list-flat' | 'list-tree' | 'collapse-all' | 'expand-all', label: string, act: () => void, disabled = false, commandId?: string) => (
    <IconButton icon={icon} onClick={act} disabled={disabled} title={tip(label, commandId)} label={label} />
  );
  const actions = (
    <>
      {iconButton('refresh', t('git.refresh'), () => void refresh(), loading, 'git.refresh')}
      {tree
        ? iconButton('list-flat', t('git.viewList'), () => update((v) => ({ ...v, view: 'list' })))
        : iconButton('list-tree', t('git.viewTree'), () => update((v) => ({ ...v, view: 'tree' })))}
      {tree && iconButton(anyOpen ? 'collapse-all' : 'expand-all', t(anyOpen ? 'git.collapseAll' : 'git.expandAll'), toggleAll)}
      <div className="menu-wrap" ref={moreWrap} onKeyDown={(e) => e.key === 'Escape' && setMoreOpen(false)}>
        <IconButton icon="more" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-haspopup="menu" label={t('git.more')} />
        {moreOpen && moreBox && (
          <div className="menu" role="menu" style={{ position: 'fixed', overflowY: 'auto', ...moreBox }}>
            {item('copy', t('git.copyPatch'), () => void copyPatch(), !selected)}
            {linkExplorer && item('file', t('git.openFile'), () => toExplorer(selected, true), !selected || deleted)}
            {linkExplorer && item('locate', t('git.reveal'), () => toExplorer(selected, false), !selected || deleted)}
          </div>
        )}
      </div>
    </>
  );

  const reorderProjects = (ids: string[]) => {
    setProjects((list) => list && ids.flatMap((id) => list.find((p) => p.id === id) ?? []));
    api.reorderProjects(ids).catch((e) => toast({ message: errorMessage(errorOf(e)), kind: 'error' }));
  };

  const project = projects?.find((p) => p.id === root);
  const errorBanner = loadError && <ErrorBanner error={loadError} onRetry={() => void refresh()} compact />;
  const branchLine = status && (
        <div className="git-branch-line" title={info?.upstream}>
          <Icon name="git-branch" size={14} />
          <span className="git-branch-name">{status.branch}</span>
          {!!status.ahead && <span title={t('git.ahead')}>↑{status.ahead}</span>}
          {!!status.behind && <span title={t('git.behind')}>↓{status.behind}</span>}
        </div>
  );
  const changes = (
      <div className="xp-pane-body">
        <div className="tree git-list" ref={list}>
          {projects?.length === 0 && <p className="git-reason">{t('git.noProjects')}</p>}
          {info && !info.repo && <p className="git-reason">{info.error ?? t('git.notRepo')}</p>}
          {statusError && <ErrorBanner error={statusError} compact />}
          {status && status.files.length === 0 && <p className="git-reason">{t('git.clean')}</p>}
          {sections.map((s) => {
            const open = !view.closed.includes(s.id);
            return (
              <div key={s.id} className="git-section" role="group">
                <button title={t(`git.section.${s.id}`)} type="button" className="tree-row git-row git-section-head" aria-expanded={open} onClick={() => toggleSection(s.id)} onKeyDown={openKeys(open, () => toggleSection(s.id))}>
                  <span className={`tree-chevron${open ? ' open' : ''}`}><Icon name="chevron" size={12} /></span>
                  <span className="tree-label">{t(`git.section.${s.id}`)}</span>
                  <span className="git-count">{s.files.length}</span>
                </button>
                {open && (s.tree ? [...folderRows(s.id, s.tree, 0), ...s.tree.files.map((f) => fileRow(f, 0, true))] : s.files.map((f) => fileRow(f, 0, false)))}
              </div>
            );
          })}
        </div>
        {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} />}
      </div>
  );
  /** The History panel. */
  const historyPanel = (main: boolean) => (
      <HistoryPanel
        root={info?.repo ? root : undefined}
        tick={tick}
        open={main || view.historyOpen}
        size={main ? 1 : view.historySize}
        onToggle={main ? () => {} : () => update((v) => ({ ...v, historyOpen: !v.historyOpen }))}
        onResize={main ? () => {} : (historySize) => update((v) => ({ ...v, historySize }))}
        reveal={reveal}
        onRevealed={() => setReveal(undefined)}
        selected={selected?.commit !== undefined ? { commit: selected.commit, path: selected.file.path } : undefined}
        onSelect={(commit, file) => root && setSelected({ root, commit: commit.hash, file })}
        onOpen={(file) => root && file.status !== 'D' && toExplorer({ root, commit: '', file }, true)}
      />
  );
  const sidebar = (
    <div className="xp-pane">
      <ProjectPicker projects={projects ?? []} current={project} onPick={pick} onReorder={reorderProjects} actions={actions} />
      {errorBanner}
      {branchLine}
      {changes}
      {historyPanel(false)}
    </div>
  );
  const diffPane = (
      <div className="git-diff">
        {selected ? (
          <GitDiffPane key={`${selected.root}\0${selectionKey(selected)}`} ref={diff} root={selected.root} source={selected} tick={tick} mode={mode} onModeChange={setMode} />
        ) : (
          <Empty title={t('git.pick')} />
        )}
      </div>
  );

  if (compact) return <div className="git-compact">{sidebar}</div>;

  if (readThrough && root) {
    return (
      <ReadThroughView
        root={root}
        branch={status?.branch}
        files={status?.files ?? []}
        openKey={selected && selected.root === root && selected.commit === undefined ? keyOf(selected.file) : undefined}
        commitOpen={selected?.commit !== undefined}
        onSelect={(file) => setSelected({ root, file })}
        onOpenFile={(file) => toExplorer({ root, file }, true)}
        diffPane={diffPane}
        drawer={
          <div className="xp-pane">
            <ProjectPicker projects={projects ?? []} current={project} onPick={pick} onReorder={reorderProjects} actions={actions} />
            {errorBanner}
            {branchLine}
            {historyPanel(true)}
          </div>
        }
        empty={
          <>
            {info && !info.repo && <p className="git-reason">{info.error ?? t('git.notRepo')}</p>}
            {statusError && <ErrorBanner error={statusError} compact />}
            {status && status.files.length === 0 && <p className="git-reason">{t('git.clean')}</p>}
          </>
        }
      />
    );
  }

  const screen = (
    <Explorer
      side={settings.window?.sidebarSide ?? 'left'}
      sidebar={sidebar}
      sizes={view.sizes}
      onResize={(sizes) => update((v) => ({ ...v, sizes }))}
      collapsed={view.collapsed}
      onCollapsedChange={(collapsed) => update((v) => ({ ...v, collapsed }))}
      scope="git"
      className="screen-edges"
    >
      {diffPane}
    </Explorer>
  );
  return screen;
}
