import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { GitCommit, GitCommitFile } from '@kedalion/server-core/protocol';
import { type ApiError, ContextMenu, type ContextMenuItem, copyNotify, ErrorBanner, errorOf, fileIconOf, Icon, useFileIconVersion, useRovingList } from '@kedalion/ui';
import { gitApi as api } from '../client';
import { t } from '../i18n';
import { commitStatusOf } from './sides';

const PAGE = 50;
const INDENT = 16;
const MIN_SIZE = 0.1;
const MAX_SIZE = 0.9;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago" style age of an ISO date. */
function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, 'minute');
}

type Files = GitCommitFile[] | ApiError;

export interface HistoryPanelProps {
  root?: string;
  /** Changes on every refresh, so the log is read again. */
  tick: number;
  open: boolean;
  /** Fraction of the sidebar height. */
  size: number;
  onToggle: () => void;
  onResize: (size: number) => void;
  /** Commit and path of the selected file, if it is one of the history. */
  selected?: { commit: string; path: string };
  onSelect: (commit: GitCommit, file: GitCommitFile) => void;
  onOpen: (file: GitCommitFile) => void;
  /** Full hash of a commit to expand and select once the log has it (another screen asked for it). */
  reveal?: string;
  onRevealed?: () => void;
}

/** Commits touching the project, newest first; each expands to the files it changed. Read-only. */
export function HistoryPanel({ root, tick, open, size, onToggle, onResize, selected, onSelect, onOpen, reveal, onRevealed }: HistoryPanelProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(false);
  useFileIconVersion();
  const [logRoot, setLogRoot] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [files, setFiles] = useState<Map<string, Files>>(() => new Map());
  const count = useRef(0);
  const seq = useRef(0);
  /** The current root, so a commit's files read for an older root are dropped. */
  const rootNow = useRef(root);
  rootNow.current = root;
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useRovingList(list, '.git-row');

  useEffect(() => {
    count.current = 0;
    setCommits([]);
    setLogRoot(undefined);
    setMore(false);
    setError(undefined);
    setExpanded(new Set());
    setFiles(new Map());
  }, [root]);

  // Reads as many commits as are shown, so a refresh keeps the pages already loaded.
  useEffect(() => {
    if (!open || !root) return;
    const mine = ++seq.current;
    const limit = Math.max(PAGE, count.current);
    setLoading(true);
    api
      .gitLog(root, 0, limit)
      .then((next) => {
        if (mine !== seq.current) return;
        count.current = next.length;
        setCommits(next);
        setLogRoot(root);
        setMore(next.length === limit);
        setError(undefined);
      })
      .catch((e) => mine === seq.current && setError(errorOf(e)))
      .finally(() => mine === seq.current && setLoading(false));
  }, [root, open, tick]);

  const loadMore = () => {
    if (!root) return;
    const mine = ++seq.current;
    setLoading(true);
    api
      .gitLog(root, commits.length, PAGE)
      .then((page) => {
        if (mine !== seq.current) return;
        const next = [...commits, ...page];
        count.current = next.length;
        setCommits(next);
        setMore(page.length === PAGE);
      })
      .catch((e) => mine === seq.current && setError(errorOf(e)))
      .finally(() => mine === seq.current && setLoading(false));
  };

  // Reveal: find the commit in the log (loading older pages as needed), expand it and select its first file.
  useEffect(() => {
    if (!reveal || !root || !open || loading || logRoot !== root) return;
    // A short hash (from a terminal) matches the commit it starts.
    const commit = commits.find((c) => c.hash === reveal || (reveal.length >= 7 && c.hash.startsWith(reveal)));
    if (!commit) {
      if (more) loadMore();
      else onRevealed?.();
      return;
    }
    onRevealed?.();
    setExpanded((was) => new Set(was).add(commit.hash));
    api
      .gitCommit(root, commit.hash)
      .then((list) => {
        if (rootNow.current !== root) return;
        setFiles((was) => new Map(was).set(commit.hash, list));
        if (list[0]) onSelect(commit, list[0]);
      })
      .catch((e) => rootNow.current === root && setFiles((was) => new Map(was).set(commit.hash, errorOf(e))));
  }, [reveal, root, open, loading, logRoot, commits, more]);

  const toggle = (hash: string) => {
    const next = new Set(expanded);
    if (!next.delete(hash)) {
      next.add(hash);
      if (root && !(files.get(hash) instanceof Array)) {
        api
          .gitCommit(root, hash)
          .then((list) => rootNow.current === root && setFiles((was) => new Map(was).set(hash, list)))
          .catch((e) => rootNow.current === root && setFiles((was) => new Map(was).set(hash, errorOf(e))));
      }
    }
    setExpanded(next);
  };

  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] }>();
  const openMenu = (e: MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: { x: e.clientX, y: e.clientY }, items });
  };
  const commitMenu = (e: MouseEvent, c: GitCommit) => {
    const isOpen = expanded.has(c.hash);
    openMenu(e, [
      { id: 'toggle', label: t(isOpen ? 'git.collapse' : 'git.expand'), icon: 'chevron', run: () => toggle(c.hash) },
      { id: 'hash', label: t('git.copyHash'), icon: 'copy', run: () => void copyNotify(c.hash) },
      { id: 'short', label: t('git.copyShortHash'), icon: 'copy', run: () => void copyNotify(c.short) },
      { id: 'msg', label: t('git.copyMessage'), icon: 'copy', run: () => void copyNotify(c.subject) },
    ]);
  };
  const fileMenu = (e: MouseEvent, commit: GitCommit, file: GitCommitFile) =>
    openMenu(e, [
      { id: 'select', label: t('git.openFile'), icon: 'file', run: () => onSelect(commit, file) },
      { id: 'path', label: t('git.copyPath'), icon: 'copy', run: () => void copyNotify(file.path) },
    ]);

  const openKeys = (isOpen: boolean, act: () => void) => (e: KeyboardEvent) => {
    if ((e.key === 'ArrowRight' && !isOpen) || (e.key === 'ArrowLeft' && isOpen)) {
      e.preventDefault();
      act();
    }
  };

  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    const pane = panel.current?.parentElement;
    if (!pane || e.button !== 0) return;
    e.preventDefault();
    const box = pane.getBoundingClientRect();
    const move = (ev: globalThis.PointerEvent) => onResize(Math.min(MAX_SIZE, Math.max(MIN_SIZE, (box.bottom - ev.clientY) / box.height)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fileRow = (commit: GitCommit, file: GitCommitFile) => {
    const { letter, tone } = commitStatusOf(file);
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const dir = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
    const icon = fileIconOf(name);
    const active = selected?.commit === commit.hash && selected.path === file.path;
    return (
      <button
        key={`${commit.hash}\0${file.path}`}
        type="button"
        className={`tree-row git-row git-${tone}${active ? ' selected' : ''}`}
        style={{ paddingLeft: 4 + INDENT * 2 }}
        title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        onClick={() => onSelect(commit, file)}
        onContextMenu={(e) => fileMenu(e, commit, file)}
        onFocus={() => onSelect(commit, file)}
        onDoubleClick={() => onOpen(file)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onOpen(file);
        }}
      >
        <span className={`tree-icon${icon.tone ? ` tone-${icon.tone}` : ''}`}><Icon name={icon.icon} size={14} /></span>
        <span className="tree-label">
          {name}
          {dir && <span className="git-dir">{dir}</span>}
        </span>
        <span className="tree-badge">{letter}</span>
      </button>
    );
  };

  return (
    <div ref={panel} className={`git-history${open ? ' open' : ''}`} style={open ? { flexBasis: `${size * 100}%` } : undefined}>
      {open && <div className="git-history-sash" onPointerDown={startResize} role="separator" aria-orientation="horizontal" />}
      <button title={t('git.history')} type="button" className="tree-row git-row git-section-head" aria-expanded={open} onClick={onToggle} onKeyDown={openKeys(open, onToggle)}>
        <span className={`tree-chevron${open ? ' open' : ''}`}><Icon name="chevron" size={12} /></span>
        <span className="tree-label">{t('git.history')}</span>
      </button>
      {open && (
        <div className="git-history-body tree" ref={list}>
          {error && <ErrorBanner error={error} compact />}
          {!error && !loading && root && commits.length === 0 && <p className="git-reason">{t('git.noCommits')}</p>}
          {commits.map((c) => {
            const isOpen = expanded.has(c.hash);
            const changed = files.get(c.hash);
            return (
              <div key={c.hash} role="group">
                <button
                  type="button"
                  className="tree-row git-row git-commit"
                  style={{ paddingLeft: 4 + INDENT }}
                  title={`${c.short} · ${c.author} · ${new Date(c.date).toLocaleString()}${c.refs ? ` · ${c.refs}` : ''}\n${c.subject}`}
                  aria-expanded={isOpen}
                  onClick={() => toggle(c.hash)}
                  onContextMenu={(e) => commitMenu(e, c)}
                  onKeyDown={openKeys(isOpen, () => toggle(c.hash))}
                >
                  <span className={`tree-chevron${isOpen ? ' open' : ''}`}><Icon name="chevron" size={12} /></span>
                  <span className="tree-label">
                    {c.subject}
                    <span className="git-dir">{c.author}</span>
                  </span>
                  <span className="git-commit-age">{ago(c.date)}</span>
                </button>
                {isOpen &&
                  (changed === undefined ? (
                    <p className="git-reason git-commit-note">{t('git.loading')}</p>
                  ) : changed instanceof Array ? (
                    changed.length ? changed.map((f) => fileRow(c, f)) : <p className="git-reason git-commit-note">{t('git.noFiles')}</p>
                  ) : (
                    <ErrorBanner error={changed} compact />
                  ))}
              </div>
            );
          })}
          {more && (
            <button title={t('git.loadMore')} type="button" className="tree-row git-row git-more" onClick={loadMore} disabled={loading}>
              <span className="tree-label">{t('git.loadMore')}</span>
            </button>
          )}
        </div>
      )}
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
