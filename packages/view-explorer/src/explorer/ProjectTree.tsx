import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { previewKind } from '@kedalion/editor/options';
import {
  ContextMenu,
  type ContextMenuItem,
  errorMessage,
  errorOf,
  fileIconOf,
  FileNesting,
  folderIconOf,
  type NestingPatterns,
  relPath,
  statusOf,
  TreeView,
  type TreeViewHandle,
  useAsync,
  useDialogs,
  useFileIconVersion,
  useViewToast,
} from '@kedalion/ui';
import { multiDeleteEnabled } from '../options';
import { explorerApi as api, type FsEntry, type Project } from '../client';
import { fullPath, nodeId } from '../explorer-paths';
import { t } from '../i18n';
import { useCopyPath } from './copy-path';
import { PropertiesDialog } from './PropertiesDialog';
import type { FileUndo, UndoOp } from './file-undo';
import type { FsArchiveFormat, GitFile } from '@kedalion/server-core/protocol';
import { entriesOf, freeName, walkEntry } from './os-drop';
import { archiveStem, commonParent, compressPaths, takenIn as takenInDir } from './fs-actions';
import type { FindResult } from './tree-find';

interface Node {
  project: string;
  path: string;
  name: string;
  kind: FsEntry['kind'];
  outside?: boolean;
  external?: boolean;
  readOnly?: boolean;
  target?: FsEntry['target'];
  excluded?: true;
  /** Files shown under this file (file nesting); they are in the same folder on disk. */
  nested?: Node[];
}

const isRoot = (node: Node) => node.path === '';
/** Nothing may be done to the entry itself: its link target is missing, or it is below an external link. */
const locked = (node: Node) => !!node.outside || !!node.readOnly;
/** Nothing may be written into or through the entry, nor its path handed to the server (reveal, open with, editors). */
const sealed = (node: Node) => locked(node) || !!node.external;
const isDir = (node: Node) => node.kind === 'dir' || node.target === 'dir';
/** Drops paths that sit under another path of the list (deleting the folder removes them). */
const topPaths = (paths: string[]) => {
  const unique = [...new Set(paths)];
  return unique.filter((p) => !unique.some((o) => o !== p && relPath.isUnder(p, o)));
};
const isArchive = (node: Node) => !isDir(node) && previewKind(node.name) === 'archive';

export interface ProjectTreeProps {
  project: Project;
  expanded: string[];
  onExpandedChange(ids: string[]): void;
  /** Adds one id to the latest expanded list (used after awaits, where `expanded` may be stale). */
  onExpandedAdd?(id: string): void;
  onOpenFile(project: string, path: string): void;
  /** A single click on a file; absent: a click only selects. */
  onPreviewFile?(project: string, path: string): void;
  /** Absent: no Open to the Side. */
  onOpenFileToSide?(project: string, path: string): void;
  onOpenTerminal(project: string, path: string): void;
  /** The file chosen with Select for Compare, in any project. */
  compareWith?: { project: string; path: string };
  onSelectForCompare?(project: string, path: string): void;
  /** Absent: no compare items in the menu. */
  onCompare?(left: { project: string; path: string }, right: { project: string; path: string }): void;
  /** Absent: no Open as Details in the menu. */
  onOpenDetails?(project: string, path: string): void;
  /** A file or folder was renamed or moved. */
  onMoved(project: string, from: string, to: string): void;
  onDeleted(project: string, path: string): void;
  apiRef?: Ref<ProjectTreeApi>;
  undo: FileUndo;
  /** How many of these project paths (or files under them) are open with unsaved changes. */
  dirtyCount?(project: string, paths: string[]): number;
  /** Which entries the tree lists and in what order; a change reloads the tree. */
  view?: TreeViewOptions;
  /** Folders holding a single folder share a row. */
  compact?: boolean;
  /** Ask before deleting (default true); the unsaved-changes warning stays. */
  confirmDelete?: boolean;
  /** Ask before a drag and drop move (default false). */
  confirmDragDrop?: boolean;
  /** File nesting patterns; absent: files are not nested. */
  nesting?: NestingPatterns;
  /** Find in the tree: `highlight` marks matches and counts them on folders, `filter` also hides everything else. */
  find?: { mode: 'highlight' | 'filter'; result: FindResult };
  /** Git status badges on changed files and a dot on folders holding them (only while the root is expanded). */
  gitDecorations?: boolean;
}

type Tone = 'ok' | 'warn' | 'err';
const RANK: Record<Tone, number> = { ok: 0, warn: 1, err: 2 };
interface GitMarks {
  files: Map<string, { letter: string; tone: Tone }>;
  dirs: Map<string, Tone>;
  /** Ignored paths; a folder's contents are ignored with it. */
  ignored: Set<string>;
}

/** Badge per changed file (a conflict wins over its other entries) and the strongest tone per folder above one. */
function gitMarksOf(list: GitFile[], ignored: string[] = []): GitMarks {
  const files = new Map<string, { letter: string; tone: Tone }>();
  const dirs = new Map<string, Tone>();
  for (const file of list) {
    const s = statusOf(file);
    const mark = { letter: file.group === 'conflict' ? 'C' : s.letter, tone: s.tone };
    const had = files.get(file.path);
    if (!had || RANK[mark.tone] > RANK[had.tone]) files.set(file.path, mark);
    for (let dir = relPath.dirname(file.path); dir !== '' && dir !== '.'; dir = relPath.dirname(dir)) {
      const tone = dirs.get(dir);
      if (!tone || RANK[mark.tone] > RANK[tone]) dirs.set(dir, mark.tone);
    }
  }
  return { files, dirs, ignored: new Set(ignored.map((p) => p.replace(/\/$/, ''))) };
}

function isIgnored(marks: GitMarks, path: string): boolean {
  for (let p = path; p !== '' && p !== '.'; p = relPath.dirname(p)) if (marks.ignored.has(p)) return true;
  return false;
}

export interface TreeViewOptions {
  exclude: string[];
  sort: string;
  showExcluded: boolean;
}

const DID: Record<UndoOp['kind'], 'explorer.did.create' | 'explorer.did.rename' | 'explorer.did.move' | 'explorer.did.copy'> = {
  create: 'explorer.did.create',
  rename: 'explorer.did.rename',
  move: 'explorer.did.move',
  copy: 'explorer.did.copy',
};
const MAX_LISTED = 10;
const MAX_FORCED = 400;
const UPLOAD_PARALLEL = 3;
const LINK_FRESH_MS = 50_000;

/** What the sidebar header and the commands can ask of a tree. */
export interface ProjectTreeApi {
  newFile(): void;
  newFolder(): void;
  refresh(): void;
  collapseAll(): void;
  /** Opens every folder loaded so far; the ones that load as a result open on the next call. */
  expandAll(): void;
  /** Some folder below the root is open. */
  canCollapse(): boolean;
  /** Expands the folders above `path` and selects it. */
  reveal(path: string): void;
  /** Scrolls to and selects `path` without changing which folders are expanded. */
  scrollTo(path: string): void;
  /** True while the tree's find box is open. */
  finding(): boolean;
  /** The selected folder, the folder of the selected file, or the root. */
  selectedFolder(): string;
}

/** The lazy tree of a project's folder, with the file actions. */
export function ProjectTree({ project, expanded, onExpandedChange, onExpandedAdd, onOpenFile, onPreviewFile, onOpenFileToSide, onOpenTerminal, compareWith, onSelectForCompare, onCompare, onOpenDetails, onMoved, onDeleted, apiRef, undo, dirtyCount, view, compact, confirmDelete = true, confirmDragDrop = false, nesting, find, gitDecorations = false }: ProjectTreeProps) {
  const tree = useRef<TreeViewHandle<Node>>(null);
  const clipboard = useRef<{ mode: 'copy' | 'cut'; paths: string[] }>();
  const { confirm, choose, prompt, element } = useDialogs();
  const [creating, setCreating] = useState<{ dir: string; kind: 'file' | 'dir' }>();
  useFileIconVersion();
  const toast = useViewToast('folder');
  const copyPath = useCopyPath();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; node: Node; selection: Node[] }>();
  const [properties, setProperties] = useState<string>();
  const editors = useAsync(() => api.editors(), []);

  const folderFiles = useRef(new Map<string, string[]>());
  const outLink = useRef<{ id: string; url: string; name: string; at: number }>();

  const roots = useMemo<Node[]>(() => [{ project: project.id, path: '', name: project.name, kind: 'dir' }], [project.id, project.name]);

  const forced = useMemo(
    () => (find?.mode === 'filter' ? new Set([...find.result.counts.keys()].slice(0, MAX_FORCED).map((dir) => nodeId(project.id, dir))) : undefined),
    [find, project.id],
  );
  const visibleOf = useMemo(() => {
    if (find?.mode !== 'filter') return undefined;
    const { matches, counts } = find.result;
    const shows = (n: Node): boolean => n.path === '' || matches.has(n.path) || counts.has(n.path) || !!n.nested?.some(shows);
    return shows;
  }, [find]);
  const markOf = useMemo(() => {
    if (!find) return undefined;
    const { matches, counts } = find.result;
    return (n: Node) => {
      const positions = matches.get(n.path);
      const count = isDir(n) ? counts.get(n.path) : undefined;
      return positions || count ? { positions: positions ?? [], count } : undefined;
    };
  }, [find]);

  const run = async (job: () => Promise<void>) => {
    try {
      await job();
    } catch (err) {
      toast({ message: errorMessage(errorOf(err)), kind: 'error' });
    }
  };

  const expand = (id: string) => {
    if (onExpandedAdd) onExpandedAdd(id);
    else if (!expanded.includes(id)) onExpandedChange([...expanded, id]);
  };

  const nester = useMemo(() => nesting && new FileNesting(nesting), [JSON.stringify(nesting)]);
  const nestedOf = useRef(new Map<string, Node[]>());
  const nestParent = useRef(new Map<string, string>());

  const loadChildren = async (node: Node): Promise<Node[]> => {
    if (!isDir(node)) return nestedOf.current.get(nodeId(project.id, node.path)) ?? [];
    const entries = await api.fsList(project.id, node.path, view && { exclude: view.exclude, sort: view.sort, all: view.showExcluded });
    folderFiles.current.set(
      nodeId(project.id, node.path),
      entries.filter((e) => e.kind !== 'dir' && e.target !== 'dir').map((e) => e.name),
    );
    const nodes = entries.map((e): Node => ({
      project: project.id,
      path: relPath.join(node.path, e.name),
      name: e.name,
      kind: e.kind,
      outside: e.outside,
      external: e.external,
      readOnly: e.readOnly,
      target: e.target,
      excluded: e.excluded,
    }));
    if (!nester) return nodes;
    const byName = new Map(nodes.filter((n) => !isDir(n)).map((n) => [n.name, n]));
    const groups = nester.nest([...byName.keys()], node.path ? relPath.basename(node.path) : project.name);
    const hidden = new Set<string>();
    const changed: string[] = [];
    for (const [parent, children] of groups) {
      const id = nodeId(project.id, relPath.join(node.path, parent));
      const list = [...children].map((c) => byName.get(c)!);
      for (const child of list) {
        hidden.add(child.name);
        nestParent.current.set(nodeId(project.id, child.path), id);
      }
      if (list.length) {
        byName.get(parent)!.nested = list;
        nestedOf.current.set(id, list);
        changed.push(id);
      } else {
        nestedOf.current.delete(id);
      }
    }
    // Nested files that were loaded before this reload show the new list.
    setTimeout(() => changed.forEach((id) => tree.current?.reload(id)), 0);
    return nodes.filter((n) => !hidden.has(n.name));
  };

  const iconOf = (n: Node) => {
    if (n.external) return 'link';
    if (!isDir(n)) return fileIconOf(n.name).icon;
    return n.kind === 'link' ? 'folder-link' : folderIconOf(n.name, folderFiles.current.get(nodeId(project.id, n.path)));
  };

  const [git, setGit] = useState<GitMarks>();
  const gitOn = useRef(false);
  gitOn.current = gitDecorations;
  const gitSeq = useRef(0);
  const gitKey = useRef('');
  const gitIgnored = useRef<string[]>();
  /** `withIgnored` false reuses the last ignored list (the ignored walk is the costly part). */
  const refreshGit = (withIgnored = true) => {
    const seq = ++gitSeq.current;
    const done = (files?: GitFile[], ignored?: string[]) => {
      if (seq !== gitSeq.current) return;
      const key = files ? JSON.stringify([files, ignored]) : '';
      if (key === gitKey.current) return;
      gitKey.current = key;
      setGit(files && gitMarksOf(files, ignored));
    };
    if (!gitOn.current) {
      gitIgnored.current = undefined;
      return done();
    }
    const fetchIgnored = withIgnored || !gitIgnored.current;
    api.gitStatus(project.id, fetchIgnored).then(
      (status) => {
        if (fetchIgnored && seq === gitSeq.current) gitIgnored.current = status.ignored ?? [];
        done(status.files, fetchIgnored ? status.ignored : gitIgnored.current);
      },
      () => done(),
    );
  };
  useEffect(() => refreshGit(), [project.id, gitOn.current]);

  const decorationOf = (n: Node) => {
    if (!git || sealed(n) || isRoot(n)) return undefined;
    const file = git.files.get(n.path);
    if (file) return { className: `git-${file.tone}`, badge: file.letter };
    if (isIgnored(git, n.path)) return { className: 'git-ignored' };
    const tone = isDir(n) ? git.dirs.get(n.path) : undefined;
    return tone && { className: `git-${tone} git-dir`, badge: '•' };
  };

  const reloadDir = (path: string) => {
    folderFiles.current.delete(nodeId(project.id, path));
    tree.current?.reload(nodeId(project.id, path));
    refreshGit();
  };

  useEffect(() => {
    let tick = 0;
    const refresh = (withIgnored: boolean) => {
      if (document.visibilityState !== 'visible') return;
      folderFiles.current.clear();
      tree.current?.reload();
      refreshGit(withIgnored);
    };
    // The ignored list is fetched on every 4th tick and on focus.
    const timer = setInterval(() => refresh(++tick % 4 === 0), 8000);
    const onFocus = () => refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [project.id]);

  const viewKey = JSON.stringify([view, nesting]);
  const firstView = useRef(viewKey);
  useEffect(() => {
    if (firstView.current === viewKey) return;
    firstView.current = viewKey;
    folderFiles.current.clear();
    tree.current?.reload();
  }, [viewKey]);

  const rootNode = roots[0]!;
  const expandAbove = (path: string) => {
    const missing: string[] = [];
    for (let dir = relPath.dirname(path); ; dir = relPath.dirname(dir)) {
      const id = nodeId(project.id, dir);
      if (!expanded.includes(id)) missing.push(id);
      if (dir === '') break;
    }
    const holder = nestParent.current.get(nodeId(project.id, path));
    if (holder && !expanded.includes(holder)) missing.push(holder);
    if (missing.length) onExpandedChange([...expanded, ...missing]);
  };
  const scrollTo = (path: string) => tree.current?.reveal(nodeId(project.id, path));
  const reveal = (path: string) => {
    expandAbove(path);
    scrollTo(path);
  };

  const open = (node: Node) => {
    if (node.outside) return;
    if (isDir(node)) {
      const id = nodeId(project.id, node.path);
      onExpandedChange(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]);
    } else {
      if (find) expandAbove(node.path);
      onOpenFile(project.id, node.path);
    }
  };

  const record = (op: UndoOp, name: string, key?: string) => {
    undo.push(op);
    toast({ key, message: t(DID[op.kind], { name }), action: { label: t('explorer.undo'), run: () => void undoOp(op) } });
  };
  const labelOf = (paths: string[]) => (paths.length === 1 ? relPath.basename(paths[0]!) : t('explorer.items', { count: paths.length }));

  const create = (kind: 'file' | 'dir', node: Node) => {
    if (sealed(node)) return;
    const dir = isDir(node) ? node.path : relPath.dirname(node.path);
    expand(nodeId(project.id, dir));
    setCreating({ dir, kind });
  };

  const submitNew = async (c: { dir: string; kind: 'file' | 'dir' }, raw: string): Promise<string | null> => {
    const parts = raw.replace(/\\/g, '/').split('/').map((x) => x.trim());
    if (parts.some((x) => !x || x === '.' || x === '..')) return t('explorer.nameInvalid');
    const path = relPath.join(c.dir, parts.join('/'));
    try {
      await api.fsCreate(project.id, path, c.kind);
    } catch (err) {
      reloadDir(c.dir);
      return errorMessage(errorOf(err));
    }
    setCreating(undefined);
    reloadDir(c.dir);
    reveal(path);
    if (c.kind === 'file') onOpenFile(project.id, path);
    record({ kind: 'create', project: project.id, paths: [path] }, relPath.basename(path));
    return null;
  };

  const rename = (node: Node, name: string) =>
    run(async () => {
      if (isRoot(node) || locked(node)) return;
      const to = relPath.join(relPath.dirname(node.path), name);
      await api.fsRename(project.id, node.path, name);
      onMoved(project.id, node.path, to);
      reloadDir(relPath.dirname(node.path));
      record({ kind: 'rename', project: project.id, moves: [{ from: node.path, to }] }, name);
    });

  const actionable = (nodes: Node[]) => nodes.filter((n) => !isRoot(n) && !locked(n));

  const remove = (nodes: Node[]) =>
    run(async () => {
      const targets = actionable(nodes);
      if (!targets.length) return;
      if (targets.length > 1 && !multiDeleteEnabled()) {
        toast({ message: t('explorer.deleteOne') });
        return;
      }
      const dirty = dirtyCount?.(project.id, targets.map((n) => n.path)) ?? 0;
      const ok = !confirmDelete && dirty === 0 ? true : await confirm({
        title: t('explorer.deleteTitle'),
        body: (
          <>
            <p>{targets.length === 1 ? t('explorer.deleteBody', { name: targets[0]!.name }) : t('explorer.deleteMany', { count: targets.length })}</p>
            {targets.length > 1 && (
              <ul>
                {targets.slice(0, MAX_LISTED).map((n) => <li key={n.path}>{n.name}</li>)}
                {targets.length > MAX_LISTED && <li>{t('explorer.andMore', { count: targets.length - MAX_LISTED })}</li>}
              </ul>
            )}
            {dirty > 0 && <p>{t('explorer.dirtyDelete', { count: dirty })}</p>}
          </>
        ),
        okLabel: t('explorer.delete'),
        danger: true,
      });
      if (!ok) return;
      const parents = new Set(targets.map((n) => relPath.dirname(n.path)));
      const paths = topPaths(targets.map((n) => n.path));
      try {
        await api.fsDelete(project.id, paths);
        for (const path of paths) onDeleted(project.id, path);
      } finally {
        for (const dir of parents) reloadDir(dir);
      }
    });

  /** Moves `from` to `to`; an existing name asks Keep both / Replace. Returns the final path, or null when cancelled. */
  const moveOne = async (from: string, to: string): Promise<string | null> => {
    const finalPath = (entry: FsEntry) => relPath.join(relPath.dirname(to), entry.name);
    try {
      return finalPath(await api.fsMove(project.id, from, to));
    } catch (err) {
      if (errorOf(err).code !== 'exists') throw err;
    }
    const choice = await choose({
      title: t('explorer.existsTitle'),
      body: t('explorer.existsBody', { name: relPath.basename(to) }),
      choices: [
        { id: 'keepBoth', label: t('explorer.keepBoth') },
        { id: 'replace', label: t('explorer.replace'), danger: true },
      ],
    });
    if (choice !== 'keepBoth' && choice !== 'replace') return null;
    return finalPath(await api.fsMove(project.id, from, to, choice));
  };

  const moveInto = async (froms: string[], dir: string, dropped = false) => {
    if (!froms.length) return;
    if (dropped && confirmDragDrop) {
      const name = relPath.basename(dir) || project.name;
      const body = froms.length === 1 ? t('explorer.moveBody', { name: relPath.basename(froms[0]!), target: name }) : t('explorer.moveMany', { count: froms.length, target: name });
      if (!(await confirm({ title: t('explorer.moveTitle'), body }))) return;
    }
    const dirty = dirtyCount?.(project.id, froms) ?? 0;
    if (dirty > 0 && !(await confirm({ title: t('explorer.dirtyTitle'), body: t('explorer.dirtyMove', { count: dirty }) }))) return;
    const moves: Array<{ from: string; to: string }> = [];
    const reload = new Set([dir]);
    try {
      for (const from of froms) {
        const to = await moveOne(from, relPath.join(dir, relPath.basename(from)));
        if (to === null) break;
        onMoved(project.id, from, to);
        moves.push({ from, to });
        reload.add(relPath.dirname(from));
      }
    } finally {
      for (const d of reload) reloadDir(d);
      expand(nodeId(project.id, dir));
    }
    if (moves.length) record({ kind: 'move', project: project.id, moves }, labelOf(moves.map((m) => m.to)));
  };

  // The copy route names clashes "name copy.ext", "name copy 2.ext", so pasting in place works.
  const copyInto = async (froms: string[], dir: string) => {
    const created: string[] = [];
    try {
      for (const from of froms) {
        const entry = await api.fsCopy(project.id, from, relPath.join(dir, relPath.basename(from)));
        created.push(relPath.join(dir, entry.name));
      }
    } finally {
      reloadDir(dir);
      expand(nodeId(project.id, dir));
    }
    if (created.length) record({ kind: 'copy', project: project.id, paths: created }, labelOf(created));
  };

  const undoOp = (op: UndoOp) =>
    run(async () => {
      if (!undo.take(op)) return;
      try {
        if ('paths' in op) {
          const ok = await confirm({
            title: t('explorer.undoDeleteTitle'),
            body: t('explorer.undoDeleteBody', { name: labelOf(op.paths) }),
            okLabel: t('explorer.undo'),
            danger: true,
          });
          if (!ok) return void undo.push(op);
          const paths = topPaths(op.paths);
          await api.fsDelete(op.project, paths);
          for (const path of paths) onDeleted(op.project, path);
          toast({ message: t('explorer.undone', { what: t(DID[op.kind], { name: labelOf(op.paths) }) }) });
        } else {
          const pending = [...op.moves].reverse();
          try {
            while (pending.length) {
              const m = pending[0]!;
              await api.fsMove(op.project, m.to, m.from);
              onMoved(op.project, m.to, m.from);
              pending.shift();
            }
          } catch (err) {
            if (pending.length) undo.push({ ...op, moves: pending.reverse() });
            throw err;
          }
          toast({ message: t('explorer.undone', { what: t(DID[op.kind], { name: labelOf(op.moves.map((m) => m.to)) }) }) });
        }
      } finally {
        folderFiles.current.clear();
        tree.current?.reload();
      }
    });

  const undoLast = () => {
    const op = undo.last();
    if (op) void undoOp(op);
    else toast({ message: t('explorer.undoNothing') });
  };

  const stash = (mode: 'copy' | 'cut', nodes: Node[]) => {
    const paths = actionable(nodes).map((n) => n.path);
    if (paths.length) clipboard.current = { mode, paths };
  };

  const paste = (node: Node) =>
    run(async () => {
      const clip = clipboard.current;
      if (!clip || sealed(node)) return;
      const dir = isDir(node) ? node.path : relPath.dirname(node.path);
      if (clip.mode === 'copy') return copyInto(clip.paths, dir);
      await moveInto(clip.paths.filter((from) => relPath.dirname(from) !== dir && !relPath.isUnder(dir, from)), dir);
      clipboard.current = undefined;
    });

  const takenIn = (dir: string) => takenInDir(project.id, dir);

  const extract = (node: Node, ask: boolean) =>
    run(async () => {
      const dir = relPath.dirname(node.path);
      const { fold, taken } = await takenIn(dir);
      let to = relPath.join(dir, freeName(archiveStem(node.name), true, taken, fold));
      if (ask) {
        const raw = await prompt({
          title: t('explorer.extractTo'),
          label: t('explorer.extractToLabel'),
          value: to,
          validate: (v) => (v.replace(/\\/g, '/').split('/').some((x) => !x.trim() || x.trim() === '.' || x.trim() === '..') ? t('explorer.nameInvalid') : null),
        });
        if (raw === null) return;
        to = raw.replace(/\\/g, '/').split('/').map((x) => x.trim()).join('/');
      }
      const result = await api.fsExtract(project.id, node.path, to);
      reloadDir(dir);
      reloadDir(relPath.dirname(result.path));
      reveal(result.path);
      toast({ message: t('explorer.extracted', { name: node.name, target: result.path }) });
    });

  const compress = (nodes: Node[], format: FsArchiveFormat) =>
    run(async () => {
      const done = await compressPaths(project, actionable(nodes).map((n) => n.path), format);
      if (!done) return;
      reloadDir(done.dir);
      reveal(done.result.path);
      toast({ message: done.message });
    });

  /**
   * Files and folders dragged in from the OS. A top-level name that is taken asks Skip / Keep both / Replace
   * (once for all with the checkbox); what is inside a dropped folder is not compared. Up to UPLOAD_PARALLEL files go at once.
   */
  const dropFiles = (data: DataTransfer, target: Node) => {
    const entries = entriesOf(data);
    if (sealed(target) || !entries.length) return;
    void run(async () => {
      const dir = target.path;
      const fold = /Windows|Mac/.test(navigator.userAgent) ? (n: string) => n.toLowerCase() : (n: string) => n;
      const taken = new Set((await api.fsList(project.id, dir)).map((e) => fold(e.name)));
      let all: 'skip' | 'keepBoth' | 'replace' | undefined;
      const jobs: Array<{ name: string; tree: Awaited<ReturnType<typeof walkEntry>>; isDir: boolean; replace?: string }> = [];
      for (const entry of entries) {
        let name = entry.name;
        let replace: string | undefined;
        if (taken.has(fold(name))) {
          let choice = all;
          if (!choice) {
            let applyAll = false;
            const picked = await choose({
              title: t('explorer.existsTitle'),
              body: t('explorer.existsBody', { name }),
              choices: [
                { id: 'keepBoth', label: t('explorer.keepBoth') },
                { id: 'replace', label: t('explorer.replace'), danger: true },
                { id: 'skip', label: t('explorer.skip') },
              ],
              checkbox: entries.length > 1 ? { label: t('explorer.applyToAll'), onChange: (v) => (applyAll = v) } : undefined,
            });
            if (picked !== 'keepBoth' && picked !== 'replace' && picked !== 'skip') return;
            choice = picked;
            if (applyAll) all = choice;
          }
          if (choice === 'skip') continue;
          if (choice === 'keepBoth') name = freeName(name, entry.isDirectory, taken, fold);
          else replace = relPath.join(dir, name);
        }
        taken.add(fold(name));
        jobs.push({ name, tree: await walkEntry(entry), isDir: entry.isDirectory, replace });
      }

      const under = (j: (typeof jobs)[number], rel: string[]) => [dir, j.name, ...rel.slice(1)].filter(Boolean).join('/');
      const files = jobs.flatMap((j) => j.tree.files.map((f) => ({ path: under(j, f.rel), file: f.file })));
      const emptyDirs = jobs.flatMap((j) => j.tree.emptyDirs.map((rel) => under(j, rel)));
      let done = 0;
      let failed = 0;
      let firstError: unknown;
      const progress = () => {
        if (files.length > 1) toast({ key: 'upload', message: t('explorer.uploading', { done, total: files.length }), timeout: 0 });
      };
      progress();
      try {
        // Replaced names are removed only now, after every prompt and folder read succeeded.
        for (const j of jobs) if (j.replace) await api.fsDelete(project.id, [j.replace]);
        for (const path of emptyDirs) await api.fsCreate(project.id, path, 'dir').catch((err) => { if (errorOf(err).code !== 'exists') throw err; });
        const queue = [...files];
        await Promise.all(
          Array.from({ length: Math.min(UPLOAD_PARALLEL, queue.length) }, async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              try {
                await api.fsUpload(project.id, next.path, next.file);
              } catch (err) {
                failed++;
                firstError ??= err;
              }
              done++;
              progress();
            }
          }),
        );
      } finally {
        reloadDir(dir);
        expand(nodeId(project.id, dir));
      }
      const created = jobs.map((j) => relPath.join(dir, j.name));
      if (failed) {
        toast({ key: 'upload', kind: 'error', message: t('explorer.uploadFailed', { count: failed, error: errorMessage(errorOf(firstError)) }) });
      } else if (created.length) {
        record({ kind: 'copy', project: project.id, paths: created }, labelOf(created), 'upload');
        if (created.length === 1 && !jobs[0]!.isDir) onOpenFile(project.id, created[0]!);
      }
    });
  };

  // The OS fetches a dragged-out file by URL with no headers; the link is made on pointer down so it is there at dragstart.
  const prepareDragOut = (node: Node) => {
    if (isDir(node) || sealed(node)) return;
    const id = nodeId(project.id, node.path);
    api.fsDownloadTicket(project.id, node.path).then(
      ({ ticket, name }) => (outLink.current = { id, name, url: `${window.location.origin}/api/fs/download?t=${ticket}`, at: Date.now() }),
      () => {},
    );
  };
  const dragOutLink = (node: Node) => {
    const link = outLink.current;
    outLink.current = undefined;
    return link && link.id === nodeId(project.id, node.path) && Date.now() - link.at < LINK_FRESH_MS ? link : undefined;
  };

  const drop = (dragged: Node[], target: Node, copy: boolean) =>
    run(async () => {
      if (sealed(target)) return;
      const nodes = actionable(dragged).filter((n) => !relPath.isUnder(target.path, n.path));
      if (copy) await copyInto(nodes.map((n) => n.path), target.path);
      else await moveInto(nodes.filter((n) => relPath.dirname(n.path) !== target.path).map((n) => n.path), target.path, true);
    });

  const selectedDir = () => {
    const picked = tree.current?.selection() ?? [];
    return picked.length === 1 && !sealed(picked[0]!) ? picked[0]! : rootNode;
  };
  useImperativeHandle(apiRef, () => ({
    newFile: () => void create('file', selectedDir()),
    newFolder: () => void create('dir', selectedDir()),
    refresh: () => {
      folderFiles.current.clear();
      tree.current?.reload();
      refreshGit();
    },
    collapseAll: () => onExpandedChange([nodeId(project.id, '')]),
    expandAll: () => onExpandedChange([...new Set([...expanded, ...(tree.current?.loadedFolders() ?? [])])]),
    canCollapse: () => expanded.some((id) => id !== nodeId(project.id, '')),
    reveal,
    scrollTo,
    finding: () => !!find,
    selectedFolder: () => {
      const node = selectedDir();
      return isDir(node) ? node.path : relPath.dirname(node.path);
    },
  }));

  const menuItems = (node: Node, selection: Node[]): Array<ContextMenuItem | 'sep'> => {
    const disabled = locked(node);
    const noPath = sealed(node);
    const item = (id: string, label: string, act: () => void, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ id, label, run: act, disabled, ...extra });
    const call = (job: () => Promise<unknown>) => () => void run(async () => void (await job()));
    const ref = (n: Node) => ({ project: project.id, path: n.path });
    const compressItems = (nodes: Node[]) => {
      const ok = nodes.length > 0 && nodes.every((n) => !isRoot(n) && !sealed(n)) && commonParent(nodes) !== undefined;
      return ok
        ? [
            item('compressZip', t('explorer.compressZip'), () => void compress(nodes, 'zip'), { icon: 'archive', disabled: false }),
            item('compress7z', t('explorer.compress7z'), () => void compress(nodes, '7z'), { disabled: false }),
          ]
        : [];
    };
    if (selection.length > 1) {
      const pair = selection.length === 2 && selection.every((n) => !isDir(n) && !sealed(n));
      return [
        ...(pair && onCompare ? [item('compareSelected', t('explorer.compareSelected'), () => onCompare(ref(selection[0]!), ref(selection[1]!)), { disabled: false }), 'sep' as const] : []),
        item('copy', t('explorer.copy'), () => stash('copy', selection), { icon: 'copy', hint: 'Ctrl+C' }),
        item('cut', t('explorer.cut'), () => stash('cut', selection), { hint: 'Ctrl+X' }),
        ...compressItems(selection),
        item('delete', t('explorer.delete'), () => void remove(selection), {
          icon: 'trash',
          hint: multiDeleteEnabled() ? 'Del' : t('explorer.deleteOne'),
          danger: true,
          disabled: disabled || !multiDeleteEnabled(),
        }),
      ];
    }
    return [
      ...(isDir(node) ? [] : [item('open', t('explorer.open'), () => open(node), { icon: 'file' })]),
      ...(isDir(node) || !onOpenFileToSide ? [] : [item('openSide', t('explorer.openSide'), () => onOpenFileToSide(project.id, node.path), { icon: 'split', hint: 'Ctrl+Enter' })]),
      item('newFile', t('explorer.newFile'), () => void create('file', node), { icon: 'plus', disabled: noPath }),
      item('newDir', t('explorer.newFolder'), () => void create('dir', node), { icon: 'folder', disabled: noPath }),
      'sep',
      ...(isRoot(node) ? [] : [item('copy', t('explorer.copy'), () => stash('copy', [node]), { icon: 'copy', hint: 'Ctrl+C' }), item('cut', t('explorer.cut'), () => stash('cut', [node]), { hint: 'Ctrl+X' })]),
      item('paste', t('explorer.paste'), () => void paste(node), { hint: 'Ctrl+V', disabled: noPath || !clipboard.current }),
      ...(isRoot(node)
        ? []
        : [
            item('rename', t('explorer.rename'), () => tree.current?.startRename(nodeId(project.id, node.path)), { icon: 'edit', hint: 'F2' }),
            item('delete', t('explorer.delete'), () => void remove([node]), { icon: 'trash', hint: 'Del', danger: true }),
            'sep' as const,
            ...(isArchive(node)
              ? [
                  item('extractHere', t('explorer.extractHere'), () => void extract(node, false), { icon: 'archive' }),
                  item('extractTo', t('explorer.extractTo'), () => void extract(node, true)),
                ]
              : []),
            ...compressItems([node]),
            'sep' as const,
          ]),
      item('copyFullPath', t('explorer.copyFullPath'), () => copyPath(fullPath(project.path, node.path)), { icon: 'copy', disabled: false }),
      ...(isRoot(node) ? [] : [item('copyPath', t('explorer.copyPath'), () => copyPath(node.path), { icon: 'copy', disabled: false })]),
      'sep' as const,
      ...(isDir(node) || !onCompare || !onSelectForCompare
        ? []
        : [
            ...(compareWith && !(compareWith.project === project.id && compareWith.path === node.path)
              ? [item('compareWithSelected', t('explorer.compareWithSelected'), () => onCompare(compareWith, ref(node)))]
              : []),
            item('selectForCompare', t('explorer.selectForCompare'), () => onSelectForCompare(project.id, node.path)),
            'sep' as const,
          ]),
      ...(isDir(node) && onOpenDetails ? [item('openDetails', t('explorer.openDetails'), () => onOpenDetails(project.id, node.path), { icon: 'table', disabled: noPath })] : []),
      ...(isDir(node) ? [item('openTerminal', t('explorer.openTerminal'), () => onOpenTerminal(project.id, node.path), { icon: 'terminal', disabled: noPath })] : []),
      item('reveal', t('explorer.reveal'), call(() => api.fsReveal(project.id, node.path)), { disabled: noPath }),
      ...(editors.data ?? []).map((editor) =>
        item(`editor-${editor.id}`, t('explorer.openInEditor', { editor: editor.name }), call(() => api.openInEditor(editor.id, project.id, node.path)), {
          disabled: noPath || editor.path === null,
          hint: editor.path === null ? t('explorer.editorMissing') : undefined,
        }),
      ),
      ...(isDir(node) ? [] : [item('openDefault', t('explorer.openDefault'), call(() => api.fsOpen(project.id, node.path)), { disabled: noPath })]),
      'sep' as const,
      item('properties', t('explorer.properties'), () => setProperties(node.path)),
    ];
  };

  return (
    <section className="xp-project">
      {element}
      <TreeView
        ref={tree}
        roots={roots}
        hideRoots
        idOf={(n) => nodeId(n.project, n.path)}
        labelOf={(n) => (n.outside ? `${n.name} (${t('explorer.outside')})` : n.name)}
        iconOf={iconOf}
        dimmedOf={(n) => !!n.excluded || (!!git && isDir(n) && !n.outside && !isRoot(n) && isIgnored(git, n.path))}
        iconToneOf={(n) => (isDir(n) ? undefined : fileIconOf(n.name).tone)}
        hasChildren={(n) => isDir(n) || !!n.nested?.length}
        isFolder={isDir}
        compact={compact}
        visibleOf={visibleOf}
        markOf={markOf}
        decorationOf={decorationOf}
        forceExpanded={forced}
        loadChildren={loadChildren}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        onOpen={open}
        onOpenToSide={onOpenFileToSide && ((node) => !node.outside && onOpenFileToSide(project.id, node.path))}
        onPreview={onPreviewFile && ((node) => !node.outside && onPreviewFile(project.id, node.path))}
        onContextMenu={(node, e) => setMenu({ at: { x: e.clientX, y: e.clientY }, node, selection: tree.current?.selection() ?? [node] })}
        onRename={(node, name) => void rename(node, name)}
        onDelete={(nodes) => void remove(nodes)}
        onCopy={(nodes) => stash('copy', nodes)}
        onCut={(nodes) => stash('cut', nodes)}
        onPaste={(node) => void paste(node)}
        onUndo={undoLast}
        newEntry={creating && { parentId: nodeId(project.id, creating.dir), kind: creating.kind, onSubmit: (name) => submitNew(creating, name), onCancel: () => setCreating(undefined) }}
        draggable
        onDrop={(dragged, target, copy) => void drop(dragged, target, copy)}
        onDropFiles={dropFiles}
        dragOut={{ prepare: prepareDragOut, link: dragOutLink }}
      />
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.node, menu.selection)} onClose={() => setMenu(undefined)} />}
      {properties !== undefined && <PropertiesDialog root={project.id} path={properties} onClose={() => setProperties(undefined)} />}
    </section>
  );
}
