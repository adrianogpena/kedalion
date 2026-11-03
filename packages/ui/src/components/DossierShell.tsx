import { useRef, type ReactNode } from 'react';
import type { GitRepoInfo, GitStatus } from '@kedalion/server-core/protocol';
import { useDossier, useDossierData } from '../dossier';
import { t } from '../i18n';
import { useRovingList } from '../roving-list';
import type { AppFrameProps } from './AppFrame';
import { useScreenHooks, type NavItem, type SidebarProps } from './Sidebar';
import { Icon } from './ui';

export type ChapterId = 'cover' | 'code' | 'history' | 'requests' | 'runs' | 'web';

/** The screens as chapters of the project's dossier, in order; views not listed get a chapter of their own at the end. */
export const DOSSIER_CHAPTERS: ReadonlyArray<{ id: ChapterId; screens: readonly string[] }> = [
  { id: 'cover', screens: ['dashboard'] },
  { id: 'code', screens: ['explorer'] },
  { id: 'history', screens: ['git'] },
  { id: 'requests', screens: ['rest', 'workbench'] },
  { id: 'runs', screens: ['terminal', 'agents'] },
  { id: 'web', screens: ['browser'] },
];

export const chapterLabel = (id: ChapterId) => t(`dossier.chapter.${id}`);

/** The chapter's number in the table of contents (1 = Cover). */
export const chapterNumber = (id: ChapterId) => String(DOSSIER_CHAPTERS.findIndex((c) => c.id === id) + 1);

/** The chapter a screen belongs to, if listed. */
export const chapterOfScreen = (screen: string) => DOSSIER_CHAPTERS.find((c) => c.screens.includes(screen));

/** Branch, upstream distance and (with `status`) the working-tree change count; only the facts that exist. */
export function DossierStateLine({ repo, status }: { repo: GitRepoInfo | undefined; status?: GitStatus }) {
  if (!repo) return null;
  if (!repo.repo) return <span className="dossier-state muted">{t('dossier.notRepo')}</span>;
  const ahead = status?.ahead ?? repo.ahead ?? 0;
  const behind = status?.behind ?? repo.behind ?? 0;
  const upstream = status?.upstream ?? repo.upstream;
  const branch = status?.branch ?? repo.branch;
  return (
    <span className="dossier-state">
      {branch && (
        <span className="dossier-state-branch">
          <Icon name="git-branch" size={12} />
          {branch}
        </span>
      )}
      {!upstream ? (
        <span className="dossier-state-sync">{t('dossier.noUpstream')}</span>
      ) : ahead || behind ? (
        <>
          {ahead > 0 && <span className="dossier-state-ahead">{t('dossier.ahead', { n: ahead })}</span>}
          {behind > 0 && <span className="dossier-state-behind">{t('dossier.behind', { n: behind })}</span>}
        </>
      ) : (
        <span className="dossier-state-sync">{t('dossier.synced')}</span>
      )}
      {status && <span className={`dossier-state-dirty${status.files.length ? ' dirty' : ''}`}>{status.files.length ? t('dossier.changes', { n: status.files.length }) : t('dossier.clean')}</span>}
    </span>
  );
}

/** Dossier frame: the spine (projects and the active one's contents) on the left, the dossier header and the view on the right. */
export function DossierAppFrame({ zen, sidebar, tools, children }: AppFrameProps) {
  const { project } = useDossier();
  const { projects, repos, status } = useDossierData();
  const current = projects?.find((p) => p.id === project);
  return (
    <div className={`app dossier-frame${zen ? ' zen' : ''}`}>
      {sidebar}
      <header className="dossier-header">
        <div className="dossier-header-title">
          <span className="dossier-header-name">{current?.name ?? t('dossier.noProject')}</span>
          {current && <DossierStateLine repo={repos.get(current.id)} status={status} />}
        </div>
        <span className="spacer" />
        {tools && <div className="dossier-header-tools">{tools}</div>}
      </header>
      <div className="dossier-body">{children}</div>
    </div>
  );
}

interface Chapter<Id extends string> {
  key: string;
  label: string;
  num: string;
  items: NavItem<Id>[];
}

/** The screens grouped as numbered chapters; views not in `DOSSIER_CHAPTERS` follow as chapters of their own. */
function chaptersOf<Id extends string>(items: NavItem<Id>[]): Chapter<Id>[] {
  const listed = new Set<string>(DOSSIER_CHAPTERS.flatMap((c) => c.screens));
  return [
    ...DOSSIER_CHAPTERS.map((c) => ({ key: c.id, label: chapterLabel(c.id), items: c.screens.flatMap((id) => items.filter((i) => i.id === id)) })),
    ...items.filter((i) => !listed.has(i.id)).map((i) => ({ key: i.id, label: i.label, items: [i] })),
  ]
    .filter((c) => c.items.length > 0)
    .map((c, i) => ({ ...c, num: String(i + 1) }));
}

/** The active project's table of contents: numbered chapters, sub-items where a chapter has two screens. */
function ChapterToc<Id extends string>({ sections, current, onSelect, popped, poppedHint }: SidebarProps<Id>) {
  const chapters = chaptersOf(sections.flatMap((s) => s.items));
  const titleOf = (item: NavItem<Id>, label = item.label) => {
    const base = item.hint ? `${label} (${item.hint})` : label;
    return popped?.has(item.id) && poppedHint ? `${base} - ${poppedHint}` : base;
  };
  const mark = (item: NavItem<Id>) =>
    popped?.has(item.id) ? (
      <span className="popped-mark">
        <Icon name="popout" size={10} />
      </span>
    ) : null;
  return (
    <div className="dossier-toc" role="list" aria-label={t('dossier.chapters')}>
      {chapters.map((c) => {
        const active = c.items.some((i) => i.id === current);
        const first = c.items[0];
        const single = c.items.length === 1;
        const label = `${c.num} ${c.label}`;
        return (
          <div key={c.key} role="listitem" className={`dossier-toc-chapter${active ? ' active' : ''}`}>
            <button
              className={`dossier-toc-item dossier-rove${active ? ' active' : ''}`}
              title={single ? titleOf(first, c.label) : c.label}
              aria-label={single ? titleOf(first, label) : label}
              aria-current={single && active ? 'page' : undefined}
              onClick={() => onSelect(first.id)}
            >
              <span className="dossier-chapter-num">{c.num}</span>
              <span className="dossier-chapter-title">{c.label}</span>
              {single && mark(first)}
            </button>
            {!single &&
              c.items.map((item) => (
                <button
                  key={item.id}
                  className={`dossier-toc-sub dossier-rove${item.id === current ? ' active' : ''}`}
                  title={titleOf(item)}
                  aria-label={titleOf(item)}
                  aria-current={item.id === current ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="dossier-toc-sub-label">{item.label}</span>
                  {mark(item)}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Dossier Sidebar slot, the project spine: every project with its live git state (a pick switches every view); the
 * active project opens into its table of contents. No collapse toggle: Zen hides the spine.
 */
export function DossierSidebar<Id extends string>(props: SidebarProps<Id>) {
  useScreenHooks(props.sections, props.current);
  const { project, setProject } = useDossier();
  const { projects, repos } = useDossierData();
  const list = useRef<HTMLDivElement>(null);
  useRovingList(list, '.dossier-rove');
  const hasActive = !!projects?.some((p) => p.id === project);
  return (
    <nav className="dossier-spine" aria-label={t('dossier.projects')}>
      <div className="dossier-spine-title">{t('dossier.projects')}</div>
      <div className="dossier-spine-list" ref={list}>
        {projects?.length === 0 && <div className="dossier-spine-empty">{t('dossier.noProjects')}</div>}
        {projects?.map((p) => {
          const active = p.id === project;
          return (
            <div key={p.id} className={`dossier-spine-project${active ? ' active' : ''}`}>
              <button className={`dossier-spine-row dossier-rove${active ? ' active' : ''}`} aria-current={active ? 'true' : undefined} aria-expanded={active} aria-label={p.name} title={p.path} onClick={() => setProject(p.id)}>
                <span className="dossier-spine-initial" aria-hidden="true">{p.name.slice(0, 1)}</span>
                <span className="dossier-spine-name">{p.name}</span>
                <DossierStateLine repo={repos.get(p.id)} />
              </button>
              {active && <ChapterToc {...props} />}
            </div>
          );
        })}
        {/* Without an active project the chapters still list here, so every screen stays reachable. */}
        {!hasActive && <ChapterToc {...props} />}
      </div>
    </nav>
  );
}

/** The header of a chapter page: chapter, project name and path, git state, and the page's own actions. */
export function ProjectHeader({ chapter, actions }: { chapter: ChapterId; actions?: ReactNode }) {
  const { project } = useDossier();
  const { projects, repos, status } = useDossierData();
  const current = projects?.find((p) => p.id === project);
  return (
    <div className="dossier-project-header">
      <div className="dossier-project-chapter">
        <span className="dossier-chapter-num">{t('dossier.chapterOf', { n: chapterNumber(chapter) })}</span>
        <span className="dossier-chapter-title">{chapterLabel(chapter)}</span>
      </div>
      <div className="dossier-project-id">
        <span className="dossier-project-name">{current?.name ?? t('dossier.noProject')}</span>
        {current && <span className="dossier-project-path">{current.path}</span>}
      </div>
      {current && <DossierStateLine repo={repos.get(current.id)} status={status} />}
      {actions && (
        <>
          <span className="spacer" />
          <div className="dossier-project-actions">{actions}</div>
        </>
      )}
    </div>
  );
}
