import { useRef, useState, type ReactNode } from 'react';
import type { GitFile } from '@kedalion/server-core/protocol';
import { Button, fileIconOf, Icon, statusOf, useRovingList } from '@kedalion/ui';
import { t } from '../i18n';
import { isReviewed, markReviewed, reviewKey, useReviewed } from './reviewed';
import './read-through.css';

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string) => path.slice(0, Math.max(0, path.length - nameOf(path).length - 1));
const keyOf = (file: GitFile) => `${file.group}\0${file.path}`;
const churn = (f: GitFile) => (f.added ?? 0) + (f.removed ?? 0);

interface Props {
  root: string;
  branch?: string;
  files: GitFile[];
  /** Key (group + path) of the open working-tree change. */
  openKey?: string;
  /** A History commit file is selected: its diff shows above the cards. */
  commitOpen: boolean;
  onSelect: (file: GitFile) => void;
  onOpenFile: (file: GitFile) => void;
  diffPane: ReactNode;
  /** Project picker, branch line and History panel. */
  drawer: ReactNode;
  empty?: ReactNode;
}

/** Git layout "Read-through": the whole change set as one document with a file index. */
export function ReadThroughView({ root, branch, files, openKey, commitOpen, onSelect, onOpenFile, diffPane, drawer, empty }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const index = useRef<HTMLElement>(null);
  useRovingList(index, '.rt-idx');
  useReviewed();
  const peak = Math.max(1, ...files.map(churn));
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const done = (f: GitFile) => isReviewed(reviewKey(root, f));
  const counts = (f: GitFile) => (f.added === undefined && f.removed === undefined ? undefined : [f.added ?? 0, f.removed ?? 0] as const);

  return (
    <div className="rt">
      <div className="rt-bar">
        <Icon name="git-branch" size={14} />
        <span className="rt-strong">{branch ?? '…'}</span>
        <span className="rt-dim">{t('git.rt.files', { n: files.length })}</span>
        <span className="rt-add">+{added}</span>
        <span className="rt-del">−{removed}</span>
        <span className="rt-grow" />
        <Button size="sm" icon="check" disabled={files.length === 0} onClick={() => markReviewed(files.map((f) => reviewKey(root, f)))}>
          {t('git.rt.markAll')}
        </Button>
        <Button size="sm" icon="list-flat" pressed={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>
          {t('git.rt.drawer')}
        </Button>
      </div>
      <div className="rt-body">
        <nav className="rt-index" ref={index} aria-label={t('git.rt.index')}>
          {files.map((f) => {
            const c = counts(f);
            const on = keyOf(f) === openKey;
            return (
              <button
                type="button"
                key={keyOf(f)}
                className={`rt-idx${on ? ' on' : ''}${done(f) ? ' done' : ''}`}
                title={f.path}
                onClick={() => onSelect(f)}
                onFocus={() => onSelect(f)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  onOpenFile(f);
                }}
              >
                <span className="rt-idx-name">
                  {done(f) && <Icon name="check" size={12} />}
                  {nameOf(f.path)}
                </span>
                <span className="rt-idx-bar" style={{ width: c ? `${((c[0] + c[1]) / peak) * 100}%` : 0 }}>
                  {c && <i className="rt-add-bg" style={{ flex: c[0] }} />}
                  {c && <i className="rt-del-bg" style={{ flex: c[1] }} />}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="rt-doc">
          {commitOpen && (
            <section className="rt-card open">
              <div className="rt-card-body">{diffPane}</div>
            </section>
          )}
          {files.map((f) => {
            const on = keyOf(f) === openKey;
            const icon = fileIconOf(nameOf(f.path));
            const c = counts(f);
            return (
              <section key={keyOf(f)} className={`rt-card${on ? ' open' : ''}${done(f) ? ' done' : ''}`}>
                <button type="button" className="rt-card-head" aria-expanded={on} onClick={() => onSelect(f)} onDoubleClick={() => onOpenFile(f)}>
                  <span className={`rt-chev${on ? ' open' : ''}`}><Icon name="chevron" size={12} /></span>
                  <span className={`tree-icon${icon.tone ? ` tone-${icon.tone}` : ''}`}><Icon name={icon.icon} size={14} /></span>
                  <span className="rt-card-name">
                    {nameOf(f.path)}
                    <span className="rt-dim"> {dirOf(f.path)}</span>
                  </span>
                  {done(f) && <Icon name="check" size={12} />}
                  {c ? (
                    <>
                      <span className="rt-add">+{c[0]}</span>
                      <span className="rt-del">−{c[1]}</span>
                    </>
                  ) : (
                    <span className="rt-dim">{t('git.rt.bin')}</span>
                  )}
                  <span className="rt-letter">{statusOf(f).letter}</span>
                </button>
                {on && <div className="rt-card-body">{diffPane}</div>}
              </section>
            );
          })}
          {empty}
        </div>
        {drawerOpen && <aside className="rt-drawer">{drawer}</aside>}
      </div>
    </div>
  );
}
