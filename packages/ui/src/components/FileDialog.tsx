import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DialogFilter, errorOf, request } from '../api';
import { dialogs } from '../dialogs';
import { isAbsolutePath, isValidFileName, joinPath, matchesPatterns, splitPath, withFilterExtension } from '../file-dialog';
import { t } from '../i18n';
import { useRovingList } from '../roving-list';
import { Button, IconButton } from './Button';
import { type FileDialogEntry, FileDialogList } from './FileDialogList';
import { Icon, Modal } from './ui';

export interface FileDialogProps {
  mode: 'open' | 'save' | 'folder';
  title?: string;
  filters?: DialogFilter[];
  start?: string;
  purpose?: string;
  suggestedName?: string;
  /** The chosen absolute path (already committed to the server), or null when cancelled. */
  onDone(path: string | null): void;
}

interface Places {
  start: string;
  drives: Array<{ path: string; label: string }>;
  places: Array<{ id: 'home' | 'desktop' | 'documents' | 'downloads'; path: string }>;
  recents: string[];
}

interface Listing {
  path: string;
  parent: string | null;
  entries: FileDialogEntry[];
  truncated: boolean;
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function messageOf(err: unknown): string {
  const info = errorOf(err);
  if (info.code === 'notFound' || info.code === 'badPath') return t('fileDialog.notFound');
  if (info.code === 'forbidden') return t('fileDialog.forbidden');
  if (info.code === 'badName') return t('fileDialog.invalidName');
  return info.message;
}

const stat = (path: string) => request<{ exists: boolean; kind?: 'dir' | 'file' }>('GET', '/api/file-dialog/stat', { path });

/** In-app Open / Save / Folder picker over the app server's `/api/file-dialog/*` routes. */
export function FileDialog({ mode, title, filters, start, purpose, suggestedName, onDone }: FileDialogProps) {
  const [places, setPlaces] = useState<Places | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(suggestedName ?? '');
  const [filterIndex, setFilterIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [pathText, setPathText] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const navSeq = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const crumbs = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filter = filters?.[filterIndex];
  useRovingList(side, '.fd-side-item');

  const go = useCallback(async (path: string): Promise<boolean> => {
    const seq = ++navSeq.current;
    try {
      const next = await request<Listing>('GET', '/api/file-dialog/list', { path });
      if (seq !== navSeq.current) return false;
      setListing(next);
      setSearch('');
      setError(null);
      return true;
    } catch (err) {
      if (seq === navSeq.current) setError(messageOf(err));
      return false;
    }
  }, []);

  useEffect(() => {
    let live = true;
    request<Places>('GET', '/api/file-dialog/places', { purpose, start })
      .then((p) => {
        if (!live) return;
        setPlaces(p);
        void go(p.start);
      })
      .catch((err) => live && setError(messageOf(err)));
    return () => {
      live = false;
    };
  }, [go, purpose, start]);

  useEffect(() => {
    if (crumbs.current) crumbs.current.scrollLeft = crumbs.current.scrollWidth;
  }, [listing?.path, editing]);

  const entries = useMemo(() => {
    const rows = (listing?.entries ?? []).filter((e) => (mode === 'folder' ? e.kind !== 'file' : e.kind !== 'file' || matchesPatterns(e.name, filter?.patterns ?? [])));
    const rank = (e: FileDialogEntry) => (e.kind === 'dir' ? 0 : e.kind === 'link' ? 1 : 2);
    const needle = search.trim().toLowerCase();
    const shown = needle === '' ? rows : rows.filter((e) => e.name.toLowerCase().includes(needle));
    return [...shown].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }, [listing, mode, filter, search]);

  const commit = async (path: string) => {
    setBusy(true);
    try {
      await request('POST', '/api/file-dialog/commit', {}, { mode, path, purpose });
      onDone(path);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const submit = async (override?: string) => {
    if (busy) return;
    setError(null);
    const raw = (override ?? name).trim();
    const cwd = listing?.path;
    if (mode === 'folder' && raw === '') {
      if (cwd) await commit(cwd);
      return;
    }
    if (raw === '' || (!cwd && !isAbsolutePath(raw))) return;
    let target = raw;
    if (!isAbsolutePath(raw)) {
      if (!isValidFileName(raw)) {
        setError(t('fileDialog.invalidName'));
        return;
      }
      target = joinPath(cwd!, raw);
    }
    if (mode === 'save') target = withFilterExtension(target, filter);
    let found: Awaited<ReturnType<typeof stat>>;
    try {
      found = await stat(target);
    } catch (err) {
      setError(messageOf(err));
      return;
    }
    if (found.exists && found.kind === 'dir') {
      if (mode === 'folder') await commit(target);
      else if (await go(target)) setName('');
      return;
    }
    if (mode === 'folder' || (mode === 'open' && !found.exists)) {
      setError(mode === 'folder' ? t('fileDialog.notFound') : t('fileDialog.fileNotFound'));
      return;
    }
    if (mode === 'save' && found.exists) {
      const ok = await dialogs.confirm({ title: t('fileDialog.overwriteTitle'), body: t('fileDialog.overwriteBody', { name: baseName(target) }), okLabel: t('fileDialog.replace'), danger: true });
      if (!ok) return;
    }
    await commit(target);
  };

  const activate = async (entry: FileDialogEntry) => {
    if (!listing) return;
    const path = joinPath(listing.path, entry.name);
    let kind: 'dir' | 'file' = entry.kind === 'dir' ? 'dir' : 'file';
    if (entry.kind === 'link') {
      try {
        kind = (await stat(path)).kind === 'dir' ? 'dir' : 'file';
      } catch (err) {
        setError(messageOf(err));
        return;
      }
    }
    if (kind === 'dir') {
      if (await go(path)) setName(mode === 'folder' ? '' : name);
      return;
    }
    if (mode === 'folder') return;
    setName(entry.name);
    await submit(entry.name);
  };

  const select = (entry: FileDialogEntry) => {
    if (entry.kind === 'file' ? mode !== 'folder' : mode === 'folder' && entry.kind === 'dir') setName(entry.name);
  };

  const up = () => {
    if (listing?.parent) void go(listing.parent);
  };

  const makeFolder = async () => {
    if (!listing) return;
    const folder = await dialogs.prompt({
      title: t('fileDialog.newFolder'),
      label: t('fileDialog.newFolderName'),
      validate: (v) => (v === '' || isValidFileName(v) ? null : t('fileDialog.invalidName')),
    });
    if (!folder) return;
    try {
      const made = await request<{ path: string }>('POST', '/api/file-dialog/mkdir', {}, { parent: listing.path, name: folder.trim() });
      await go(made.path);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const startEdit = () => {
    setPathText(listing?.path ?? '');
    setEditing(true);
  };

  const goText = async () => {
    const text = pathText.trim();
    if (!isAbsolutePath(text)) {
      setError(t('fileDialog.notFound'));
      return;
    }
    try {
      const found = await stat(text);
      if (!found.exists) setError(t('fileDialog.notFound'));
      else if (found.kind === 'dir') {
        if (await go(text)) setEditing(false);
      } else {
        const segments = splitPath(text);
        const parent = segments[segments.length - 2]?.path;
        if (parent && (await go(parent))) {
          if (mode !== 'folder') setName(baseName(text));
          setEditing(false);
        }
      }
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const onRootKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      startEdit();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if ((e.altKey && e.key === 'ArrowUp') || (e.key === 'Backspace' && !typing && !e.ctrlKey && !e.altKey)) {
      e.preventDefault();
      up();
    }
  };

  const heading = title?.replace(/\s*(\.{3}|…)\s*$/, '') || t(mode === 'open' ? 'fileDialog.titleOpen' : mode === 'save' ? 'fileDialog.titleSave' : 'fileDialog.titleFolder');
  const segments = listing ? splitPath(listing.path) : [];
  const placeLabel = (id: string) => t(`fileDialog.${id}` as 'fileDialog.home');

  return (
    <Modal
      large
      title={heading}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button onClick={() => onDone(null)}>{t('dialog.cancel')}</Button>
          <Button variant="primary" disabled={busy || (mode !== 'folder' && name.trim() === '')} onClick={() => void submit()}>
            {t(mode === 'save' ? 'fileDialog.save' : mode === 'folder' ? 'fileDialog.choose' : 'fileDialog.open')}
          </Button>
        </>
      }
    >
      <div ref={root} className="fd" onKeyDown={onRootKey}>
        <div className="fd-toolbar">
          <IconButton icon="arrow-up" label={t('fileDialog.up')} disabled={!listing?.parent} onClick={up} />
          {editing ? (
            <input
              className="fd-path-input"
              autoFocus
              aria-label={t('fileDialog.path')}
              value={pathText}
              onChange={(e) => setPathText(e.target.value)}
              onBlur={() => setEditing(false)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void goText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />
          ) : (
            <div ref={crumbs} className="fd-path" aria-label={t('fileDialog.path')} onClick={(e) => e.target === e.currentTarget && startEdit()}>
              {segments.map((s, i) => (
                <button key={s.path} className={`breadcrumbs-seg fd-crumb${i === segments.length - 1 ? ' current' : ''}`} onClick={() => void go(s.path)}>{s.label}</button>
              ))}
            </div>
          )}
          <IconButton icon="folder-plus" label={t('fileDialog.newFolder')} disabled={!listing} onClick={() => void makeFolder()} />
          <input
            ref={searchRef}
            className="fd-search"
            autoFocus
            placeholder={t('fileDialog.search')}
            aria-label={t('fileDialog.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (entries[0]) void activate(entries[0]);
              } else if (e.key === 'ArrowDown') {
                const row = root.current?.querySelector<HTMLElement>('.fd-row[tabindex="0"], .fd-row');
                if (row) {
                  e.preventDefault();
                  row.focus();
                }
              } else if (e.key === 'Escape' && search !== '') {
                e.preventDefault();
                e.stopPropagation();
                setSearch('');
              }
            }}
          />
        </div>
        <div className="fd-main">
          <div ref={side} className="fd-side">
            {places && places.places.length > 0 && <div className="fd-side-title">{t('fileDialog.places')}</div>}
            {places?.places.map((p) => (
              <button key={p.id} className="fd-side-item" title={p.path} onClick={() => void go(p.path)}><Icon name={p.id === 'home' ? 'home' : 'folder'} />{placeLabel(p.id)}</button>
            ))}
            {places && places.drives.length > 0 && <div className="fd-side-title">{t('fileDialog.drives')}</div>}
            {places?.drives.map((d) => (
              <button key={d.path} className="fd-side-item" title={d.path} onClick={() => void go(d.path)}><Icon name="drive" />{d.label}</button>
            ))}
            {places && places.recents.length > 0 && <div className="fd-side-title">{t('fileDialog.recents')}</div>}
            {places?.recents.map((r) => (
              <button key={r} className="fd-side-item" title={r} onClick={() => void go(r)}><Icon name="history" />{baseName(r)}</button>
            ))}
          </div>
          <div className="fd-center">
            <FileDialogList entries={entries} resetKey={listing?.path ?? ''} onActivate={(e) => void activate(e)} onSelect={select} />
            {listing && entries.length === 0 && <div className="fd-note">{t('fileDialog.empty')}</div>}
            {listing?.truncated && <div className="fd-note">{t('fileDialog.truncated')}</div>}
          </div>
        </div>
        {error !== null && <div className="fd-error field-error" role="alert">{error}</div>}
        <div className="fd-bottom">
          <label className="fd-field">
            <span>{t('fileDialog.name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                } else if (e.key === 'ArrowDown') {
                  const row = root.current?.querySelector<HTMLElement>('.fd-row[tabindex="0"], .fd-row');
                  if (row) {
                    e.preventDefault();
                    row.focus();
                  }
                }
              }}
            />
          </label>
          {filters && filters.length > 1 && mode !== 'folder' && (
            <label className="fd-field fd-filter">
              <span>{t('fileDialog.filter')}</span>
              <select value={filterIndex} onChange={(e) => setFilterIndex(Number(e.target.value))}>
                {filters.map((f, i) => <option key={f.name} value={i}>{f.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}
