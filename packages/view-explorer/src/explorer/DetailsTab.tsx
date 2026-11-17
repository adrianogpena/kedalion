import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  type BreadcrumbEntry,
  Breadcrumbs,
  ContextMenu,
  type ContextMenuItem,
  DataTable,
  type DataTableColumn,
  ErrorBanner,
  errorMessage,
  errorOf,
  fileIconOf,
  folderIconOf,
  formatBytes,
  Icon,
  IconButton,
  relPath,
  type SortState,
  useDialogs,
  useFileIconVersion,
  useToast,
  type ApiError,
} from '@kedalion/ui';
import type { FsArchiveFormat } from '@kedalion/server-core/protocol';
import { multiDeleteEnabled } from '../options';
import { explorerApi as api, type FsEntry, type Project } from '../client';
import { fullPath } from '../explorer-paths';
import { t } from '../i18n';
import { useCopyPath } from './copy-path';
import { commonParent, compressPaths } from './fs-actions';

interface Row {
  name: string;
  path: string;
  kind: FsEntry['kind'];
  dir: boolean;
  size: number;
  mtime: number;
  outside?: true;
  excluded?: true;
  hidden?: true;
}

const MAX_LISTED = 10;
const keyOf = (r: Row) => r.path;
const foldersFirst = (r: Row) => (r.dir ? 0 : 1);

export interface DetailsTabProps {
  project: Project;
  /** The folder shown, relative to the project ('' = the root). */
  path: string;
  /** The tree's exclude globs; `showHidden` lists the excluded entries too (dimmed). */
  exclude: string[];
  showHidden?: boolean;
  sort: SortState | null;
  onSortChange(sort: SortState | null): void;
  onNavigate(path: string): void;
  onOpenFile(path: string): void;
  onDeleted(project: string, path: string): void;
  dirtyCount?(project: string, paths: string[]): number;
  confirmDelete?: boolean;
}

const typeOf = (row: Row) => {
  if (row.dir) return t('explorer.details.folder');
  if (row.kind === 'link') return t('explorer.details.link');
  const dot = row.name.lastIndexOf('.');
  return dot > 0 ? t('explorer.details.fileType', { ext: row.name.slice(dot + 1).toUpperCase() }) : t('explorer.details.file');
};

/** A folder as a sortable table: folders first, Enter opens, Backspace or Alt+Up goes to the parent. */
export function DetailsTab({ project, path, exclude, showHidden = false, sort, onSortChange, onNavigate, onOpenFile, onDeleted, dirtyCount, confirmDelete = true }: DetailsTabProps) {
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<ApiError>();
  const [tick, setTick] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; rows: Row[] }>();
  const { confirm, element } = useDialogs();
  const toast = useToast();
  const copyPath = useCopyPath();
  const iconVersion = useFileIconVersion();
  const reload =() => setTick((n) => n + 1);

  useEffect(() => {
    let live = true;
    setError(undefined);
    api.fsList(project.id, path, { exclude, all: showHidden }).then(
      (entries) => {
        if (!live) return;
        setRows(entries.map((e) => ({
          name: e.name,
          path: relPath.join(path, e.name),
          kind: e.kind,
          dir: e.kind === 'dir' || e.target === 'dir',
          size: e.size,
          mtime: e.mtime,
          outside: e.outside,
          excluded: e.excluded,
          hidden: e.hidden,
        })));
      },
      (err) => live && setError(errorOf(err)),
    );
    return () => {
      live = false;
    };
  }, [project.id, path, exclude.join('\n'), showHidden, tick]);

  useEffect(() => setSelection([]), [project.id, path]);

  const run = async (job: () => Promise<void>) => {
    try {
      await job();
    } catch (err) {
      toast({ message: errorMessage(errorOf(err)), kind: 'error' });
    }
  };

  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        id: 'name',
        label: t('explorer.details.name'),
        width: 320,
        value: (r) => r.name,
        render: (r) => {
          const file = fileIconOf(r.name);
          const icon = r.dir ? (r.kind === 'link' ? 'folder-link' : folderIconOf(r.name)) : file.icon;
          return (
            <span className={`xp-details-name${r.excluded || r.hidden ? ' dim' : ''}`}>
              <span className={!r.dir && file.tone ? `tone-${file.tone}` : undefined}><Icon name={icon} size={14} /></span>
              <span className="xp-details-label">{r.name}</span>
            </span>
          );
        },
      },
      { id: 'size', label: t('explorer.details.size'), width: 100, align: 'right', value: (r) => (r.dir ? null : r.size), render: (r) => (r.dir ? '' : formatBytes(r.size)) },
      { id: 'mtime', label: t('explorer.details.modified'), width: 180, value: (r) => r.mtime, render: (r) => new Date(r.mtime).toLocaleString(), copy: (r) => new Date(r.mtime).toLocaleString() },
      { id: 'type', label: t('explorer.details.type'), width: 140, value: typeOf },
    ],
    [iconVersion],
  );

  const open = (row: Row) => (row.dir ? (!row.outside && onNavigate(row.path)) : onOpenFile(row.path));
  const up = () => path !== '' && onNavigate(relPath.dirname(path));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      up();
    }
  };

  const compress = (targets: Row[], format: FsArchiveFormat) =>
    run(async () => {
      const done = await compressPaths(project, targets.map((r) => r.path), format);
      if (!done) return;
      reload();
      toast({ message: done.message });
    });

  const remove = (targets: Row[]) =>
    run(async () => {
      if (!targets.length) return;
      if (targets.length > 1 && !multiDeleteEnabled()) {
        toast({ message: t('explorer.deleteOne') });
        return;
      }
      const dirty = dirtyCount?.(project.id, targets.map((r) => r.path)) ?? 0;
      const ok = !confirmDelete && dirty === 0 ? true : await confirm({
        title: t('explorer.deleteTitle'),
        body: (
          <>
            <p>{targets.length === 1 ? t('explorer.deleteBody', { name: targets[0]!.name }) : t('explorer.deleteMany', { count: targets.length })}</p>
            {targets.length > 1 && (
              <ul>
                {targets.slice(0, MAX_LISTED).map((r) => <li key={r.path}>{r.name}</li>)}
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
      try {
        for (const r of targets) {
          await api.fsDelete(project.id, [r.path]);
          onDeleted(project.id, r.path);
        }
      } finally {
        setSelection([]);
        reload();
      }
    });

  const menuItems = (picked: Row[]): Array<ContextMenuItem | 'sep'> => {
    const one = picked.length === 1 ? picked[0]! : undefined;
    const actionable = picked.filter((r) => !r.outside);
    const canCompress = actionable.length === picked.length && commonParent(picked) !== undefined;
    return [
      ...(one ? [{ id: 'open', label: t('explorer.open'), icon: one.dir ? ('folder' as const) : ('file' as const), run: () => open(one), disabled: one.dir && !!one.outside }, 'sep' as const] : []),
      ...(canCompress
        ? [
            { id: 'compressZip', label: t('explorer.compressZip'), icon: 'archive' as const, run: () => void compress(picked, 'zip') },
            { id: 'compress7z', label: t('explorer.compress7z'), run: () => void compress(picked, '7z') },
          ]
        : []),
      {
        id: 'delete',
        label: t('explorer.delete'),
        icon: 'trash',
        hint: picked.length > 1 && !multiDeleteEnabled() ? t('explorer.deleteOne') : 'Del',
        danger: true,
        disabled: actionable.length !== picked.length || (picked.length > 1 && !multiDeleteEnabled()),
        run: () => void remove(picked),
      },
      'sep',
      ...(one
        ? [
            { id: 'copyFullPath', label: t('explorer.copyFullPath'), icon: 'copy' as const, run: () => copyPath(fullPath(project.path, one.path)) },
            { id: 'copyPath', label: t('explorer.copyPath'), icon: 'copy' as const, run: () => copyPath(one.path) },
          ]
        : []),
    ];
  };

  const listDir = useCallback(
    async (dir: string): Promise<BreadcrumbEntry[]> =>
      (await api.fsList(project.id, dir, { exclude })).map((e) => ({
        name: e.name,
        kind: e.kind === 'dir' || e.target === 'dir' ? 'dir' : 'file',
        path: relPath.join(dir, e.name),
      })),
    [project.id, exclude.join('\n')],
  );

  const picked = (rows ?? []).filter((r) => selection.includes(r.path));

  return (
    <div
      className="xp-details"
      onKeyDown={(e) => {
        if (e.key === 'Delete' && picked.length && !menu) {
          e.preventDefault();
          // Same rule as the menu: entries outside the project are not deleted.
          if (picked.some((r) => r.outside)) return;
          void remove(picked);
        }
      }}
    >
      {element}
      <div className="xp-bar">
        <IconButton icon="chevron-up" onClick={up} disabled={path === ''} label={t('explorer.details.up')} />
        <Breadcrumbs
          root={project.name}
          path={path}
          icon={<Icon name={folderIconOf(relPath.basename(path))} size={14} />}
          list={listDir}
          onPick={(e) => (e.kind === 'dir' ? onNavigate(e.path) : onOpenFile(e.path))}
          title={`${project.name}/${path}`}
        />
      </div>
      {error && <ErrorBanner error={error} onRetry={reload} compact />}
      <div className="xp-details-body">
        <DataTable
          columns={columns}
          rows={rows ?? []}
          rowKey={keyOf}
          sort={sort}
          onSortChange={onSortChange}
          selection={selection}
          onSelectionChange={setSelection}
          groupOf={foldersFirst}
          onRowOpen={open}
          onKeyDown={onKeyDown}
          onRowContextMenu={(row, e) => {
            const keys = selection.includes(row.path) ? selection : [row.path];
            setMenu({ at: { x: e.clientX, y: e.clientY }, rows: (rows ?? []).filter((r) => keys.includes(r.path)) });
          }}
          empty={rows ? t('explorer.details.empty') : ''}
        />
      </div>
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.rows)} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
