import { useEffect, useState, type ReactNode } from 'react';
import type { GitCommit } from '@kedalion/server-core/protocol';
import { dossierLog, useDossier, useDossierData } from '../dossier';
import { t } from '../i18n';
import { useViewLink } from '../views';
import { Button } from './Button';
import { chapterLabel, DOSSIER_CHAPTERS, DossierStateLine, ProjectHeader, type ChapterId } from './DossierShell';
import { SplitView } from './SplitView';

/** A cover button for a chapter, shown only when the app has the chapter's first screen. */
function CoverChapterButton({ chapter, screen, go }: { chapter: ChapterId; screen: string; go: (id: string) => void }) {
  const present = useViewLink(screen) !== null;
  if (!present) return null;
  return (
    <Button size="sm" onClick={() => go(screen)}>
      {chapterLabel(chapter)}
    </Button>
  );
}

/** The cover of the current project: who it is, where it stands, its latest commits and the way into each chapter. */
export function DossierCover({ go }: { go: (id: string) => void }) {
  const { project } = useDossier();
  const { projects, repos, status } = useDossierData();
  const current = projects?.find((p) => p.id === project);
  const repo = current ? repos.get(current.id) : undefined;
  const [commits, setCommits] = useState<GitCommit[]>();
  useEffect(() => {
    setCommits(undefined);
    if (!current || !repo?.repo) return;
    let live = true;
    dossierLog(current.id).then(
      (list) => live && setCommits(list),
      () => live && setCommits([]),
    );
    return () => {
      live = false;
    };
  }, [current?.id, repo?.repo, status?.branch, status?.ahead]);
  return (
    <section className="dossier-cover">
      <div className="dossier-cover-title">
        <span className="dossier-chapter-title">{chapterLabel('cover')}</span>
        <h1 className="dossier-cover-name">{current?.name ?? t('dossier.noProject')}</h1>
        {current && <span className="dossier-project-path">{current.path}</span>}
        {current && <DossierStateLine repo={repo} status={status} />}
      </div>
      {repo?.repo && (
        <div className="dossier-cover-commits">
          <div className="dossier-cover-label">{t('dossier.cover.recent')}</div>
          {commits?.length === 0 && <div className="dossier-cover-empty">{t('dossier.cover.noCommits')}</div>}
          <ol className="dossier-cover-log">
            {commits?.map((c) => (
              <li key={c.hash} className="dossier-cover-commit" title={`${c.author} · ${new Date(c.date).toLocaleString()}`}>
                <span className="dossier-cover-hash">{c.short}</span>
                <span className="dossier-cover-subject">{c.subject}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="dossier-cover-actions" role="group" aria-label={t('dossier.cover.open')}>
        {DOSSIER_CHAPTERS.filter((c) => c.id !== 'cover').map((c) => (
          <CoverChapterButton key={c.id} chapter={c.id} screen={c.screens[0]} go={go} />
        ))}
      </div>
    </section>
  );
}

/**
 * A view as a chapter page of the Dossier layout: the project header (the cover on `cover`) above the view. The wrapper
 * elements are the same in every layout (outside Dossier they are `display: contents`), so a layout switch never remounts
 * the view.
 */
export function DossierPage({ chapter, go, children }: { chapter: ChapterId; go?: (id: string) => void; children: ReactNode }) {
  const { active } = useDossier();
  const cover = chapter === 'cover';
  return (
    <div className={active ? `dossier-page dossier-page-${chapter}` : 'dossier-host'}>
      {active && (cover && go ? <DossierCover go={go} /> : <ProjectHeader chapter={chapter} />)}
      {active && cover && <div className="dossier-cover-label dossier-board-label">{t('dossier.cover.board')}</div>}
      <div className={active ? 'dossier-page-body' : 'dossier-host-body'}>{children}</div>
    </div>
  );
}

const SPLIT_KEY = 'kedalion.dossier.split.';

function readSizes(chapter: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(SPLIT_KEY + chapter) ?? 'null');
    return Array.isArray(v) && v.every((n) => typeof n === 'number') ? v : [];
  } catch {
    return [];
  }
}

export interface ChapterPane {
  id: string;
  label: string;
  node: ReactNode;
}

/**
 * A chapter with two screens as one page: the chapter header, then both screens stacked, each under its own label.
 * The pane the user works in is the current screen (`onFocusPane`), so its shortcuts and commands apply.
 */
export function DossierChapterPage({ chapter, panes, current, onFocusPane }: { chapter: ChapterId; panes: ChapterPane[]; current: string; onFocusPane: (id: string) => void }) {
  const [sizes, setSizes] = useState(() => readSizes(chapter));
  const resize = (next: number[]) => {
    setSizes(next);
    try {
      localStorage.setItem(SPLIT_KEY + chapter, JSON.stringify(next));
    } catch {
      /* storage unavailable: the split lasts for this session */
    }
  };
  return (
    <div className={`dossier-page dossier-chapter-page dossier-page-${chapter}`}>
      <ProjectHeader chapter={chapter} />
      <div className="dossier-page-body">
        <SplitView direction="column" sizes={sizes} onResize={resize}>
          {panes.map((p) => (
            <section
              key={p.id}
              className={`dossier-chapter-pane${p.id === current ? ' current' : ''}`}
              aria-label={p.label}
              onPointerDownCapture={() => p.id !== current && onFocusPane(p.id)}
              onFocusCapture={() => p.id !== current && onFocusPane(p.id)}
            >
              <div className="dossier-chapter-pane-label">{p.label}</div>
              <div className="dossier-chapter-pane-body" data-link-scope={`view:${p.id}`}>
                {p.node}
              </div>
            </section>
          ))}
        </SplitView>
      </div>
    </div>
  );
}
