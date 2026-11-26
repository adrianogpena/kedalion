import { useEffect, useState } from 'react';
import { Button, Icon, Modal, request } from '@kedalion/ui';
import { tKey } from './i18n';
import { fetchSource } from './source';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface Entry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  target?: 'file' | 'dir';
}

const isDir = (e: Entry) => e.kind === 'dir' || (e.kind === 'link' && e.target === 'dir');

/** `rel` (slash separated) under the project folder `root`, with the separator of `root`. */
function absolute(root: string, rel: string): string {
  if (!rel) return root;
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${/[\\/]$/.test(root) ? '' : sep}${rel.split('/').join(sep)}`;
}

/** Picks a folder of an Explorer project: nothing outside the projects can be reached. */
export function ProjectFolderDialog({ onPick, onClose }: { onPick(path: string): void; onClose(): void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [rel, setRel] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    request<Project[]>('GET', '/api/projects').then(setProjects, (err) => setError(String((err as Error)?.message ?? err)));
  }, []);

  useEffect(() => {
    if (!project) return;
    let live = true;
    setDirs([]);
    request<{ entries: Entry[] }>('GET', '/api/fs/list', { root: project.id, path: rel }).then(
      (r) => {
        if (!live) return;
        setDirs(r.entries.filter(isDir).map((e) => e.name));
        setError('');
      },
      (err) => {
        if (!live) return;
        setDirs([]);
        setError(String((err as Error)?.message ?? err));
      },
    );
    return () => {
      live = false;
    };
  }, [project, rel]);

  const up = () => {
    if (rel) setRel(rel.split('/').slice(0, -1).join('/'));
    else setProject(null);
  };

  return (
    <Modal
      title={tKey('grid.field.folder.pick')}
      onClose={onClose}
      footer={
        <>
          <Button title={tKey('grid.cancel')} onClick={onClose}>{tKey('grid.cancel')}</Button>
          <Button variant="primary" disabled={!project} title={tKey('grid.field.folder.select')} onClick={() => project && onPick(absolute(project.path, rel))}>
            {tKey('grid.field.folder.select')}
          </Button>
        </>
      }
    >
      <div className="grid-config-folder-dialog">
        {project && (
          <>
            <Button title={tKey('grid.back')} onClick={up}>{tKey('grid.back')}</Button>
            <span className="muted">{absolute(project.path, rel)}</span>
          </>
        )}
        {error && <div role="alert">{error}</div>}
        <ul className="grid-config-folder-list">
          {!project && projects?.length === 0 && <li className="muted">{tKey('grid.field.folder.noProjects')}</li>}
          {!project &&
            (projects ?? []).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="grid-config-folder-row"
                  onClick={() => {
                    setProject(p);
                    setRel('');
                    setDirs([]);
                  }}
                >
                  <Icon name="folder" size={14} />
                  <span>{p.name}</span>
                  <span className="muted">{p.path}</span>
                </button>
              </li>
            ))}
          {project &&
            dirs.map((d) => (
              <li key={d}>
                <button type="button" className="grid-config-folder-row" onClick={() => setRel(rel ? `${rel}/${d}` : d)}>
                  <Icon name="folder" size={14} />
                  <span>{d}</span>
                </button>
              </li>
            ))}
        </ul>
      </div>
    </Modal>
  );
}

/** Picks any folder of the computer: starts at the home folder, with an editable path, an up button and the subfolders. */
export function AnyFolderDialog({ onPick, onClose }: { onPick(path: string): void; onClose(): void }) {
  const [list, setList] = useState<{ path: string; parent: string; dirs: string[] } | null>(null);
  const [target, setTarget] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetchSource<{ path: string; parent: string; dirs: string[] }>('folders', { path: target }).then(
      (r) => {
        if (!live) return;
        setList(r);
        setTyped(r.path);
        setError('');
      },
      (err) => {
        if (live) setError(String((err as Error)?.message ?? err));
      },
    );
    return () => {
      live = false;
    };
  }, [target]);

  const child = (name: string) => `${list!.path}${/[\\/]$/.test(list!.path) ? '' : list!.path.includes('\\') ? '\\' : '/'}${name}`;

  return (
    <Modal
      title={tKey('grid.field.folder.pickAny')}
      onClose={onClose}
      footer={
        <>
          <Button title={tKey('grid.cancel')} onClick={onClose}>{tKey('grid.cancel')}</Button>
          <Button variant="primary" disabled={!list} title={tKey('grid.field.folder.select')} onClick={() => list && onPick(list.path)}>
            {tKey('grid.field.folder.select')}
          </Button>
        </>
      }
    >
      <div className="grid-config-folder-dialog">
        <span className="grid-config-date">
          <Button title={tKey('grid.back')} disabled={!list?.parent} onClick={() => list?.parent && setTarget(list.parent)}>{tKey('grid.back')}</Button>
          <input
            value={typed}
            aria-label={tKey('grid.field.folder.path')}
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setTarget(typed);
            }}
          />
        </span>
        {error && <div role="alert">{error}</div>}
        <ul className="grid-config-folder-list">
          {(list?.dirs ?? []).map((d) => (
            <li key={d}>
              <button type="button" className="grid-config-folder-row" onClick={() => setTarget(child(d))}>
                <Icon name="folder" size={14} />
                <span>{d}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** The linked folder (none: only a Link button) with a Link / Change button. */
export function FolderField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange(value: string): void }) {
  const [picking, setPicking] = useState(false);
  const action = tKey(value ? 'grid.field.folder.change' : 'grid.field.folder.link');
  return (
    <div className="field">
      <span className="mono-label">{label}</span>
      <span className="grid-config-folder">
        {value && <span className="grid-config-folder-path" title={value}>{value}</span>}
        <Button title={action} onClick={() => setPicking(true)}>{action}</Button>
      </span>
      {hint && <span className="muted">{hint}</span>}
      {picking && (
        <ProjectFolderDialog
          onPick={(path) => {
            setPicking(false);
            onChange(path);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
