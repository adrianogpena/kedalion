import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { errorMessage, errorOf, type ApiError } from '../api';
import { highlightRuns } from '../fuzzy';
import { t } from '../i18n';
import type { IconName } from '../icons';
import { firstChildId, isInside, locate, nextId, parentId, prevId, subtreeIds, visibleRows, type TreeRow } from '../tree';
import { Button } from './Button';
import { Icon, Spinner, type Tone } from './ui';

export const TREE_DRAG_TYPE = 'application/x-kedalion-tree';
const TYPEAHEAD_MS = 700;
const INDENT = 14;
const HOVER_EXPAND_MS = 500;
const SCROLL_EDGE = 28;

/** Children of a node; `children` stays set while a reload runs so the rows don't flicker. */
type Entry<N> = { status: 'loading'; children?: N[] } | { status: 'error'; error: ApiError } | { status: 'ok'; children: N[] };

export interface TreeViewProps<N> {
  roots: N[];
  /** Show the children of the roots instead of the roots; the roots stay expanded. */
  hideRoots?: boolean;
  idOf: (node: N) => string;
  labelOf: (node: N) => string;
  iconOf?: (node: N) => IconName;
  iconToneOf?: (node: N) => Tone | undefined;
  /** The row is drawn dimmed (an excluded entry). */
  dimmedOf?: (node: N) => boolean;
  hasChildren: (node: N) => boolean;
  /** Rows that are folders (drop targets, compactable); a row with children that is not one is a file with nested files: a click opens it, only its chevron toggles. Defaults to `hasChildren`. */
  isFolder?: (node: N) => boolean;
  /**
   * A folder whose only child is a folder shares its row with it (`a/b/c`; the row acts on the last one, Left/Right move between the
   * segments, and rename, the context menu and drops act on the selected segment). Decided for loaded children only; top-level nodes stay apart.
   */
  compact?: boolean;
  /** Called on the first expand of a node; the result is cached per id until `reload`. */
  loadChildren: (node: N) => Promise<N[]>;
  expanded: string[];
  onExpandedChange: (expanded: string[]) => void;
  /** Uncontrolled (kept inside) when omitted. */
  selected?: string | null;
  onSelect?: (node: N) => void;
  /** Enter on any row, double-click on a row without children. */
  onOpen?: (node: N) => void;
  /** A plain click (no Ctrl or Shift) on a row without children, before a possible double-click. */
  onPreview?: (node: N) => void;
  /** Ctrl+Enter, or Alt+click, on a row without children. */
  onOpenToSide?: (node: N) => void;
  onContextMenu?: (node: N, e: MouseEvent) => void;
  /** F2 or `startRename` show an inline input; Enter or leaving it commits, Escape cancels. */
  onRename?: (node: N, name: string) => void;
  /** Delete on the selected rows (Ctrl/Shift+click and Shift+Arrows select several). */
  onDelete?: (nodes: N[]) => void;
  /** Ctrl+C / Ctrl+X on the selected rows. */
  onCopy?: (nodes: N[]) => void;
  onCut?: (nodes: N[]) => void;
  /** Ctrl+V with `target` as the focused row. */
  onPaste?: (target: N) => void;
  /** Ctrl+Z with the tree focused. */
  onUndo?: () => void;
  /** An input row for a new entry as the first child of the (expanded) node `parentId`. */
  newEntry?: {
    parentId: string;
    kind: 'file' | 'dir';
    /** Enter or leaving the input with a name; returns the error to show inline, or null once done. Esc or an empty name calls `onCancel`. */
    onSubmit: (name: string) => Promise<string | null>;
    onCancel: () => void;
  };
  draggable?: boolean;
  /** Rows dragged (the whole selection when one of its rows is dragged) onto a row with children, never onto themselves or their descendants; `copy` when Ctrl was held. */
  onDrop?: (dragged: N[], target: N, copy: boolean) => void;
  /**
   * Files or folders dragged in from the OS onto a folder row (a file row means its folder, empty space the first root).
   * Read `data.items` before the first await: the browser empties it after the event.
   */
  onDropFiles?: (data: DataTransfer, target: N) => void;
  /**
   * Dragging a single row out to the OS (Chromium's `DownloadURL`): `prepare` runs on pointer down, so an async link can be
   * ready when the drag starts; `link` returns it then, or undefined for a row that can't leave the app.
   */
  dragOut?: { prepare: (node: N) => void; link: (node: N) => { name: string; url: string } | undefined };
  /** Find in the tree: nodes for which this is false are left out (their parents stay when any child shows). */
  visibleOf?: (node: N) => boolean;
  /** Find in the tree: label character indices to highlight and, on a folder, the number of matches below it. */
  markOf?: (node: N) => { positions: number[]; count?: number } | undefined;
  /** Extra look of a row (e.g. a git status): a class on the row and a short badge at its end, with an optional tooltip. */
  decorationOf?: (node: N) => { className?: string; badge?: string; title?: string } | undefined;
  /** Ids shown expanded, besides `expanded` (find lists the folders holding matches); their children load as usual. */
  forceExpanded?: ReadonlySet<string>;
}

export interface TreeViewHandle<N = unknown> {
  /** Reloads the children of `id`, or of every loaded node; collapsed ones are dropped from the cache instead. */
  reload: (id?: string) => void;
  startRename: (id: string) => void;
  /** Selects and scrolls to `id` once its row is there (its ancestors must be expanded); no focus change. */
  reveal: (id: string) => void;
  /** The selected nodes in display order. */
  selection: () => N[];
  /** Ids of every loaded folder (the roots included). */
  loadedFolders: () => string[];
}

function Marked({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions?.length) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, positions).map((r, i) => (r.hit ? <mark key={i} className="tree-hit">{r.text}</mark> : r.text))}
    </>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <input
      ref={input}
      className="tree-rename"
      defaultValue={initial}
      aria-label={t('tree.rename')}
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function NewEntryInput({ kind, depth, onSubmit, onCancel }: { kind: 'file' | 'dir'; depth: number } & Pick<NonNullable<TreeViewProps<unknown>['newEntry']>, 'onSubmit' | 'onCancel'>) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = async (value: string) => {
    if (busy.current) return;
    if (!value.trim()) return onCancel();
    busy.current = true;
    const err = await onSubmit(value.trim());
    busy.current = false;
    if (err !== null) {
      setError(err);
      input.current?.focus();
    }
  };
  return (
    <div className="tree-row tree-new" style={{ paddingLeft: (depth + 1) * INDENT + 4 }}>
      <span className="tree-chevron" />
      <span className="tree-icon">
        <Icon name={kind === 'dir' ? 'folder' : 'file'} size={15} />
      </span>
      <input
        ref={input}
        className="tree-rename"
        aria-label={t('tree.newName')}
        aria-invalid={error !== null}
        onChange={() => setError(null)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => {
          if (error === null) void submit(e.currentTarget.value);
        }}
      />
      {error !== null && <div className="tree-new-error" role="alert">{error}</div>}
    </div>
  );
}

function TreeViewInner<N>(props: TreeViewProps<N>, ref: Ref<TreeViewHandle<N>>) {
  const { roots, hideRoots, idOf, labelOf, iconOf, iconToneOf, dimmedOf, hasChildren, isFolder = hasChildren, compact, expanded, visibleOf, markOf, decorationOf, forceExpanded, onExpandedChange, onOpen, onPreview, onOpenToSide, onContextMenu, onRename, onDelete, onCopy, onCut, onPaste, onUndo, newEntry, draggable, onDrop, onDropFiles, dragOut } = props;
  const cache = useRef(new Map<string, Entry<N>>());
  const generations = useRef(new Map<string, number>());
  const queued = useRef(new Map<string, N>());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selected = props.selected !== undefined ? props.selected : ownSelected;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const hoverTimer = useRef<{ id: string; timer: number }>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const dragged = useRef<Array<{ id: string; node: N }> | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const focusNext = useRef<string | null>(null);
  const revealNext = useRef<string | null>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const latest = useRef(props);
  latest.current = props;

  const expandedSet = new Set([...expanded, ...(forceExpanded ?? []), ...(hideRoots ? roots.map(idOf) : [])]);
  const loadedChildren = (id: string) => {
    const entry = cache.current.get(id);
    return entry?.status === 'error' ? undefined : entry?.children;
  };
  const childrenOf = (id: string) => {
    const kids = loadedChildren(id);
    return visibleOf && kids ? kids.filter(visibleOf) : kids;
  };
  // The parent of a pending new entry stays the last segment of its row, so the input shows right under it.
  const allRows = visibleRows(visibleOf ? roots.filter(visibleOf) : roots, childrenOf, expandedSet, idOf, compact ? { isFolder, stopAt: new Set(newEntry ? [newEntry.parentId] : []) } : undefined);
  const rootIds = new Set(hideRoots ? roots.map(idOf) : []);
  const rows = hideRoots ? allRows.filter((r) => r.depth > 0).map((r) => ({ ...r, depth: r.depth - 1, parentId: r.parentId !== null && rootIds.has(r.parentId) ? null : r.parentId })) : allRows;
  // A new file goes after the parent's folders (and their open contents); a new folder goes first.
  const newEntryAfter = (() => {
    if (!newEntry || newEntry.kind !== 'file') return undefined;
    const owner = rootIds.has(newEntry.parentId) ? null : newEntry.parentId;
    const parentIndex = owner === null ? -1 : rows.findIndex((r) => r.id === owner);
    if (owner !== null && parentIndex < 0) return undefined;
    const baseDepth = owner === null ? 0 : rows[parentIndex]!.depth + 1;
    let after: string | undefined;
    for (let i = parentIndex + 1; i < rows.length && rows[i]!.depth >= baseDepth; i++) {
      const r = rows[i]!;
      if (r.depth === baseDepth && !isFolder(r.node)) break;
      after = r.id;
    }
    return after;
  })();
  const newEntryDepth = newEntry && rootIds.has(newEntry.parentId) ? -1 : (rows.find((r) => r.id === newEntry?.parentId)?.depth ?? 0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const rowOf = (id: string | null) => (id === null ? undefined : rows.find((r) => r.id === id));
  const at = selected === null ? undefined : locate(rows, selected);
  const current = at?.row;
  const segment = at?.index ?? 0;
  const isPicked = (row: TreeRow<N>) => row.chain.some((c) => c.id === selected) || picked.has(row.id);
  const pickedRows = () => rowsRef.current.filter(isPicked);
  // The selected segment for the current row, the row's node for the others.
  const pickedItems = () => pickedRows().flatMap((r) => (r === current ? [r.chain[segment]] : [{ id: r.id, node: r.node }]));
  const labelOfRow = (row: TreeRow<N>) => row.chain.map((c) => labelOf(c.node)).join('/');

  const bumpGeneration = (id: string) => {
    const gen = (generations.current.get(id) ?? 0) + 1;
    generations.current.set(id, gen);
    return gen;
  };

  const forget = (id: string) => {
    bumpGeneration(id);
    queued.current.delete(id);
    cache.current.delete(id);
  };

  // A load asked for while one runs for the same id waits and runs once after it (latest node wins).
  const load = (node: N, id: string) => {
    if (cache.current.get(id)?.status === 'loading') {
      queued.current.set(id, node);
      return;
    }
    const gen = bumpGeneration(id);
    cache.current.set(id, { status: 'loading', children: loadedChildren(id) });
    bump();
    const settle = (entry: Entry<N>) => {
      cache.current.set(id, entry);
      const next = queued.current.get(id);
      queued.current.delete(id);
      if (next !== undefined) load(next, id);
      else bump();
    };
    latest.current.loadChildren(node).then(
      (children) => {
        if (generations.current.get(id) !== gen) return;
        const folder = latest.current.isFolder ?? latest.current.hasChildren;
        const fresh = new Map(children.map((c) => [idOf(c), c]));
        // Gone, or turned from a file into a folder (or back): its cached subtree no longer applies.
        const stale = (loadedChildren(id) ?? []).filter((c) => {
          const now = fresh.get(idOf(c));
          return now === undefined || folder(now) !== folder(c);
        });
        for (const gone of subtreeIds(stale.map(idOf), loadedChildren, idOf)) forget(gone);
        settle({ status: 'ok', children });
      },
      (err) => {
        if (generations.current.get(id) !== gen) return;
        settle({ status: 'error', error: errorOf(err) });
      },
    );
  };

  // Expanded rows whose children aren't loaded yet (first expand, restored state, after a reload).
  useEffect(() => {
    for (const row of allRows) {
      if (expandedSet.has(row.id) && !cache.current.has(row.id) && hasChildren(row.node)) load(row.node, row.id);
    }
  });

  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    focusNext.current = null;
    rowEls.current.get(id)?.focus();
  });

  useEffect(() => {
    const id = revealNext.current;
    if (id === null) return;
    const found = locate(rowsRef.current, id);
    if (!found) return;
    revealNext.current = null;
    select(found.row, false, false, found.index);
    rowEls.current.get(found.row.id)?.scrollIntoView({ block: 'nearest' });
  });

  const select = (row: TreeRow<N>, focus = true, extend = false, index = row.chain.length - 1) => {
    const { id, node } = row.chain[index];
    if (id !== revealNext.current) revealNext.current = null;
    if (!extend) {
      anchor.current = row.id;
      setPicked(new Set());
    }
    if (latest.current.selected === undefined) setOwnSelected(id);
    if (id !== selected) latest.current.onSelect?.(node);
    if (focus) focusNext.current = row.id;
  };

  const startRename = (id: string) => {
    const found = locate(rowsRef.current, id);
    if (!found || !latest.current.onRename) return;
    select(found.row, false, false, found.index);
    setRenaming(id);
  };

  const selectRange = (to: TreeRow<N>) => {
    const all = rowsRef.current;
    const a = all.findIndex((r) => r.id === (anchor.current ?? current?.id));
    const b = all.indexOf(to);
    if (a < 0 || b < 0) return select(to);
    setPicked(new Set(all.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)));
    select(to, true, true);
  };

  const toggle = (row: TreeRow<N>) => {
    const next = new Set(pickedRows().map((r) => r.id));
    anchor.current = row.id;
    if (!next.delete(row.id)) {
      next.add(row.id);
      setPicked(next);
      return select(row, false, true);
    }
    const rest = rowsRef.current.filter((r) => next.has(r.id));
    if (!rest.length) return;
    setPicked(next);
    select(rest[rest.length - 1], false, true);
  };

  useImperativeHandle(ref, () => ({
    selection: () => pickedItems().map((x) => x.node),
    loadedFolders: () => {
      const ids = new Set(roots.map(idOf));
      for (const entry of cache.current.values()) {
        if (entry.status === 'ok') for (const c of entry.children) if (isFolder(c) && hasChildren(c)) ids.add(idOf(c));
      }
      return [...ids];
    },
    reload(id?: string) {
      const ids = id === undefined ? [...cache.current.keys()] : [id];
      const open = new Set(latest.current.expanded);
      for (const key of ids) {
        const found = locate(rowsRef.current, key);
        const root = latest.current.roots.find((r) => latest.current.idOf(r) === key);
        if (found && open.has(key)) {
          load(found.row.chain[found.index].node, key);
        } else if (root && latest.current.hideRoots) {
          load(root, key);
        } else {
          forget(key);
        }
      }
      bump();
    },
    startRename,
    reveal(id: string) {
      revealNext.current = id;
      bump();
    },
  }));

  const setOpen = (row: TreeRow<N>, open: boolean) => {
    if (open === expandedSet.has(row.id)) return;
    if (!open && selected !== null && !row.chain.some((c) => c.id === selected) && isInside(rows, selected, row.id)) select(row);
    onExpandedChange(open ? [...expanded, row.id] : expanded.filter((x) => x !== row.id));
  };

  const open = (row: TreeRow<N>) => {
    if (onOpen) onOpen(row.node);
    else if (hasChildren(row.node)) setOpen(row, !expandedSet.has(row.id));
  };

  const typeAhead = (key: string) => {
    const fold = (s: string) => s.normalize('NFC').toLocaleLowerCase();
    const now = Date.now();
    const ta = typeahead.current;
    ta.text = now - ta.at > TYPEAHEAD_MS ? fold(key) : ta.text + fold(key);
    ta.at = now;
    const chars = [...ta.text];
    // The same key again cycles through the rows starting with it, as in file managers.
    const repeat = chars.length > 1 && chars.every((c) => c === chars[0]);
    const prefix = repeat ? chars[0]! : ta.text;
    const cur = current ? rows.indexOf(current) : -1;
    // A longer prefix may still match the current row; a new first letter moves on.
    const from = Math.max(0, chars.length > 1 && !repeat ? cur : cur + 1);
    for (let k = 0; k < rows.length; k++) {
      const row = rows[(from + k) % rows.length];
      if (fold(labelOfRow(row)).startsWith(prefix)) {
        select(row);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).getAttribute('role') !== 'treeitem') return;
    if (renaming !== null || e.altKey || e.metaKey || !rows.length) return;
    const go = (id: string | null) => {
      const row = rowOf(id);
      if (!row) return;
      if (e.shiftKey) selectRange(row);
      else select(row);
    };
    const first = rows[0];
    const last = rows[rows.length - 1];
    let handled = true;
    if (e.key === 'ArrowDown') go(current ? nextId(rows, current.id) : first.id);
    else if (e.key === 'ArrowUp') go(current ? prevId(rows, current.id) : last.id);
    else if (e.key === 'Home') go(first.id);
    else if (e.key === 'End') go(last.id);
    else if (e.key.length === 1 && !e.ctrlKey) typeAhead(e.key);
    else if (!current) handled = false;
    else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      setPicked(new Set(rows.map((r) => r.id)));
      anchor.current = first.id;
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && onCopy) onCopy(pickedItems().map((x) => x.node));
    else if (e.ctrlKey && e.key.toLowerCase() === 'x' && onCut) onCut(pickedItems().map((x) => x.node));
    else if (e.ctrlKey && e.key.toLowerCase() === 'v' && onPaste) onPaste(current.chain[segment].node);
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && onUndo) onUndo();
    else if (e.key === 'ArrowLeft') {
      if (segment > 0) select(current, true, false, segment - 1);
      else if (expandedSet.has(current.id) && hasChildren(current.node)) setOpen(current, false);
      else go(parentId(rows, current.id));
    } else if (e.key === 'ArrowRight') {
      if (segment < current.chain.length - 1) select(current, true, false, segment + 1);
      else if (!hasChildren(current.node)) handled = false;
      else if (!expandedSet.has(current.id)) setOpen(current, true);
      else go(firstChildId(rows, current.id));
    } else if (e.key === 'Enter') {
      if (e.ctrlKey && onOpenToSide) {
        if (!isFolder(current.node)) onOpenToSide(current.node);
      } else open(current);
    }
    else if (e.key === 'F2' && onRename) startRename(current.chain[segment].id);
    else if (e.key === 'Delete' && onDelete) onDelete(pickedItems().map((x) => x.node));
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const finishRename = (row: TreeRow<N>, seg: { id: string; node: N }, value: string | null) => {
    setRenaming(null);
    focusNext.current = row.id;
    const name = value?.trim();
    if (name && name !== labelOf(seg.node)) latest.current.onRename?.(seg.node, name);
  };

  // The chain segment under the pointer, else the last one.
  const segmentOf = (row: TreeRow<N>, e: { target: EventTarget }) => {
    const i = Number((e.target as HTMLElement).closest?.('[data-seg]')?.getAttribute('data-seg'));
    return { index: row.chain[i] ? i : row.chain.length - 1, ...(row.chain[i] ?? row.chain[row.chain.length - 1]) };
  };

  const isFileDrag = (e: { dataTransfer: DataTransfer }) => !!onDropFiles && e.dataTransfer.types.includes('Files');
  // The folder an OS drop on `row` lands in: the folder under the pointer when the row is one, else the folder holding it.
  const fileTargetOf = (row: TreeRow<N>, seg: { id: string; node: N }) => {
    if (isFolder(row.node)) return seg;
    const parent = rows.find((r) => r.id === row.parentId);
    if (parent) return { id: parent.id, node: parent.node };
    return hideRoots && row.parentId === null ? { id: idOf(roots[0]!), node: roots[0]! } : undefined;
  };

  const canDrop = (row: TreeRow<N>, seg: { id: string }) => {
    const d = dragged.current;
    return !!d && !!onDrop && isFolder(row.node) && !d.some((x) => isInside(rows, seg.id, x.id));
  };

  // The guide under the selected folder (or the folder holding the selected file) is drawn brighter.
  const activeGuide = (() => {
    const ids = new Set<string>();
    if (!current) return { level: -1, ids };
    const open = hasChildren(current.node) && expandedSet.has(current.id) && segment === current.chain.length - 1;
    const owner = open ? current : rows.find((r) => r.id === current.parentId);
    if (!owner) return { level: -1, ids };
    for (let i = rows.indexOf(owner) + 1; i < rows.length && rows[i].depth > owner.depth; i++) ids.add(rows[i].id);
    return { level: owner.depth, ids };
  })();

  const tabStop = current?.id ?? rows[0]?.id;

  const clearHover = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.timer);
    hoverTimer.current = undefined;
  };
  useEffect(() => clearHover, []);

  // A collapsed folder under the pointer opens after a pause; near the top or bottom edge the list scrolls.
  const dragOverFolder = (row: TreeRow<N>) => {
    if (expandedSet.has(row.id)) return clearHover();
    if (hoverTimer.current?.id === row.id) return;
    clearHover();
    hoverTimer.current = { id: row.id, timer: window.setTimeout(() => latest.current.onExpandedChange([...latest.current.expanded, row.id]), HOVER_EXPAND_MS) };
  };
  const autoScroll = (e: { currentTarget: HTMLElement; clientY: number }) => {
    let el: HTMLElement | null = e.currentTarget;
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (e.clientY < box.top + SCROLL_EDGE) el.scrollTop -= 12;
    else if (e.clientY > box.bottom - SCROLL_EDGE) el.scrollTop += 12;
  };

  return (
    <div
      className="tree"
      role="tree"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        anchor.current = null;
        setPicked(new Set());
        if (latest.current.selected === undefined) setOwnSelected(null);
      }}
      onDragOver={
        draggable || onDropFiles
          ? (e) => {
              autoScroll(e);
              if (e.defaultPrevented || !isFileDrag(e) || !rows.length) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              const top = hideRoots ? idOf(roots[0]!) : rows[0]!.id;
              if (dropTarget !== top) setDropTarget(top);
            }
          : undefined
      }
      onDragLeave={onDropFiles ? (e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropTarget(null) : undefined}
      onDrop={
        onDropFiles
          ? (e) => {
              if (e.defaultPrevented || !isFileDrag(e) || !rows.length) return;
              e.preventDefault();
              setDropTarget(null);
              onDropFiles(e.dataTransfer, hideRoots ? roots[0]! : rows[0]!.node);
            }
          : undefined
      }
    >
      {hideRoots &&
        roots.map((root) => {
          const id = idOf(root);
          const entry = cache.current.get(id);
          return (
            <Fragment key={id}>
              {newEntry?.parentId === id && !newEntryAfter && <NewEntryInput key={`new-${id}`} kind={newEntry.kind} depth={-1} onSubmit={newEntry.onSubmit} onCancel={newEntry.onCancel} />}
              {entry?.status === 'loading' && !entry.children && (
                <div className="tree-status" style={{ paddingLeft: INDENT + 4 }}>
                  <Spinner small />
                  <span className="tree-label">{t('common.loading')}</span>
                </div>
              )}
              {entry?.status === 'error' && (
                <div className="tree-status tree-error" style={{ paddingLeft: INDENT + 4 }}>
                  <Icon name="alert" size={14} />
                  <span className="tree-label" title={entry.error.detail}>{errorMessage(entry.error)}</span>
                  <Button variant="ghost" size="xs" icon="refresh" title={t('common.retry')} onClick={() => load(root, id)}>
                    {t('common.retry')}
                  </Button>
                </div>
              )}
            </Fragment>
          );
        })}
      {rows.map((row) => {
        const { node, id, depth } = row;
        const expandable = hasChildren(node);
        const isOpen = expandable && expandedSet.has(id);
        const entry = isOpen ? cache.current.get(id) : undefined;
        const icon = iconOf?.(node);
        const iconTone = iconToneOf?.(node);
        const guides = Array.from({ length: depth }, (_, level) => level);
        const statusIndent = { paddingLeft: (depth + 1) * INDENT + 22 };
        const deco = decorationOf?.(node);
        return (
          <Fragment key={id}>
            <div
              ref={(el) => (el ? rowEls.current.set(id, el) : rowEls.current.delete(id))}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={expandable ? isOpen : undefined}
              aria-selected={isPicked(row)}
              tabIndex={id === tabStop ? 0 : -1}
              className={`tree-row${isPicked(row) ? ' selected' : ''}${id === dropTarget ? ' drop-target' : ''}${dimmedOf?.(node) ? ' dim' : ''}${deco?.className ? ` ${deco.className}` : ''}`}
              style={{ paddingLeft: depth * INDENT + 4 }}
              draggable={draggable && renaming !== id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) return toggle(row);
                if (e.shiftKey) return selectRange(row);
                select(row, false, false, segmentOf(row, e).index);
                const folder = isFolder(node);
                if (e.altKey && onOpenToSide && !folder) return onOpenToSide(node);
                if (expandable && (folder || (e.target as HTMLElement).closest('.tree-chevron'))) setOpen(row, !isOpen);
                else if (!folder) onPreview?.(node);
              }}
              onDoubleClick={() => !isFolder(node) && onOpen?.(node)}
              onContextMenu={
                onContextMenu &&
                ((e) => {
                  e.preventDefault();
                  const seg = segmentOf(row, e);
                  if (!isPicked(row) || (pickedRows().length === 1 && seg.id !== selected)) select(row, false, false, seg.index);
                  onContextMenu(seg.node, e);
                })
              }
              onPointerDown={dragOut && draggable ? () => dragOut.prepare(node) : undefined}
              onDragStart={(e) => {
                e.dataTransfer.setData(TREE_DRAG_TYPE, id);
                e.dataTransfer.effectAllowed = 'copyMove';
                // Dragging a row outside the selection selects it, so the highlight shows what moves.
                const inSelection = isPicked(row);
                if (!inSelection) select(row, false, false, segmentOf(row, e).index);
                dragged.current = inSelection ? pickedItems() : [{ id, node }];
                const out = dragged.current.length === 1 ? dragOut?.link(node) : undefined;
                if (out) e.dataTransfer.setData('DownloadURL', `application/octet-stream:${out.name}:${out.url}`);
              }}
              onDragEnd={() => {
                clearHover();
                dragged.current = null;
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                const seg = segmentOf(row, e);
                if (isFileDrag(e)) {
                  const target = fileTargetOf(row, seg);
                  if (!target) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (dropTarget !== target.id) setDropTarget(target.id);
                  return target === seg ? dragOverFolder(row) : clearHover();
                }
                if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE) || !canDrop(row, seg)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                if (dropTarget !== seg.id) setDropTarget(seg.id);
                dragOverFolder(row);
              }}
              onDragLeave={() => {
                if (hoverTimer.current?.id === id) clearHover();
                if (row.chain.some((c) => c.id === dropTarget)) setDropTarget(null);
              }}
              onDrop={(e) => {
                const seg = segmentOf(row, e);
                if (isFileDrag(e)) {
                  const target = fileTargetOf(row, seg);
                  clearHover();
                  setDropTarget(null);
                  if (!target) return;
                  e.preventDefault();
                  onDropFiles!(e.dataTransfer, target.node);
                  return;
                }
                const d = dragged.current;
                clearHover();
                setDropTarget(null);
                if (!d || !canDrop(row, seg)) return;
                e.preventDefault();
                dragged.current = null;
                onDrop?.(d.map((x) => x.node), seg.node, e.ctrlKey);
              }}
            >
              {guides.map((level) => (
                <span key={level} className={`tree-guide${level === activeGuide.level && activeGuide.ids.has(id) ? ' active' : ''}`} style={{ left: level * INDENT + 12 }} />
              ))}
              <span className={`tree-chevron${isOpen ? ' open' : ''}`}>{expandable && <Icon name="chevron" size={14} />}</span>
              {icon && (
                <span className={`tree-icon${iconTone ? ` tone-${iconTone}` : ''}`}>
                  <Icon name={icon} size={15} />
                </span>
              )}
              <span className="tree-label">
                {row.chain.map((c, i) => (
                  <Fragment key={c.id}>
                    {i > 0 && <span className="tree-sep">/</span>}
                    {renaming === c.id ? (
                      <RenameInput initial={labelOf(c.node)} onDone={(value) => finishRename(row, c, value)} />
                    ) : (
                      <span data-seg={i} className={`tree-seg${row.chain.length > 1 && (c.id === selected || c.id === dropTarget) ? (c.id === selected ? ' active' : ' drop') : ''}`}>
                        <Marked text={labelOf(c.node)} positions={markOf?.(c.node)?.positions} />
                      </span>
                    )}
                  </Fragment>
                ))}
              </span>
              {markOf?.(node)?.count ? <span className="tree-count">{markOf(node)!.count}</span> : null}
              {deco?.badge ? (
                <span className="tree-badge" title={deco.title}>
                  {deco.badge}
                </span>
              ) : null}
            </div>
            {isOpen && newEntry?.parentId === id && !newEntryAfter && <NewEntryInput key={`new-${id}`} kind={newEntry.kind} depth={depth} onSubmit={newEntry.onSubmit} onCancel={newEntry.onCancel} />}
            {entry?.status === 'loading' && !entry.children && (
              <div className="tree-status" style={statusIndent}>
                <Spinner small />
                <span className="tree-label">{t('common.loading')}</span>
              </div>
            )}
            {entry?.status === 'error' && (
              <div className="tree-status tree-error" style={statusIndent}>
                <Icon name="alert" size={14} />
                <span className="tree-label" title={entry.error.detail}>{errorMessage(entry.error)}</span>
                <Button variant="ghost" size="xs" icon="refresh" title={t('common.retry')} onClick={() => load(node, id)}>
                  {t('common.retry')}
                </Button>
              </div>
            )}
            {newEntry && newEntryAfter === id && <NewEntryInput key={`new-${newEntry.parentId}`} kind={newEntry.kind} depth={newEntryDepth} onSubmit={newEntry.onSubmit} onCancel={newEntry.onCancel} />}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Generic lazy tree: children load on the first expand, multi-selection (Ctrl/Shift+click,
 * Shift+Arrows, Ctrl+A) whose primary row follows the keyboard focus (Up/Down/Left/Right/Home/End, Enter, F2, Delete,
 * Ctrl+C/X/V, type-ahead), optional drag and drop.
 * The app owns `expanded` (and `selected` when given); a ref gives `reload` and `startRename`.
 */
export const TreeView = forwardRef(TreeViewInner) as <N>(props: TreeViewProps<N> & { ref?: Ref<TreeViewHandle<N>> }) => ReactElement;
