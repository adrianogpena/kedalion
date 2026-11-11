import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ContextMenu, copyNotify, ErrorBanner, fileIconOf, Icon, IconButton, Spinner, useFileIconVersion, useStream } from '@kedalion/ui';
import type { Project, SearchHit } from '../client';
import { t } from '../i18n';

const MAX_HITS = 500;

export interface ProjectSearchProps {
  project: Project;
  /** Globs of entries search skips. */
  exclude?: string[];
  onOpenFile(project: string, path: string): void;
  onClose(): void;
  /** Focuses and selects the input each time it changes (and on mount). */
  focusSignal: number;
}

/** Search box and results over one project's files (names, or names and content). */
export function ProjectSearch({ project, exclude, onOpenFile, onClose, focusSignal }: ProjectSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [content, setContent] = useState(true);
  const [searched, setSearched] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; hit: SearchHit } | null>(null);
  useFileIconVersion();
  const search =useStream<SearchHit>({ maxItems: MAX_HITS });

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusSignal]);

  const start = (q: string, withContent: boolean) => {
    if (!q.trim()) return;
    setSearched(true);
    search.start('/api/fs/search', { root: project.id, path: '', q: q.trim(), content: withContent ? '1' : undefined, exclude: exclude?.length ? JSON.stringify(exclude) : undefined });
  };

  const close = () => {
    search.cancel();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(query, content);
  };

  const toggleContent = () => {
    setContent(!content);
    if (searched) start(query, !content);
  };

  return (
    <div className="xp-search-panel">
      <div className="xp-head">
        <form className="xp-search" onSubmit={submit}>
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={t('explorer.search.placeholder', { name: project.name })}
            aria-label={t('explorer.search.placeholder', { name: project.name })}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              if (search.running) search.cancel();
              else close();
            }}
          />
        </form>
        <button type="button" className={`chip${content ? ' chip-on' : ''}`} onClick={toggleContent} aria-pressed={content} title={t('explorer.search.content')}>
          {t('explorer.search.content')}
        </button>
        <IconButton icon="close" onClick={close} label={t('explorer.search.close')} />
      </div>
      {searched && (
        <div className="xp-results">
          <div className="xp-status muted">
            {search.running ? (
              <>
                <Spinner small /> {t('explorer.search.running')}
              </>
            ) : search.items.length === 0 && !search.error ? (
              t('explorer.search.none')
            ) : (
              t('explorer.search.count', { count: search.items.length })
            )}
            {search.truncated && ` · ${t('explorer.search.truncated', { count: MAX_HITS })}`}
          </div>
          {search.error && <ErrorBanner error={search.error} compact />}
          {search.items.map((hit, i) => (
            <button
              key={`${hit.path}:${hit.line ?? ''}:${i}`}
              className="xp-hit"
              disabled={hit.kind === 'dir'}
              onClick={() => onOpenFile(project.id, hit.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ at: { x: e.clientX, y: e.clientY }, hit });
              }}
              title={hit.path}
            >
              <span className={`tree-icon${fileIconOf(hit.path).tone ? ` tone-${fileIconOf(hit.path).tone}` : ''}`}>
                <Icon name={hit.kind === 'dir' ? 'folder' : fileIconOf(hit.path).icon} size={14} />
              </span>
              <span className="xp-hit-text">
                <span className="xp-hit-path">
                  {hit.path}
                  {hit.line ? `:${hit.line}` : ''}
                </span>
                {hit.text && <span className="xp-hit-line mono">{hit.text}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            { id: 'open', label: t('explorer.search.openFile'), icon: 'file-text', disabled: menu.hit.kind === 'dir', run: () => onOpenFile(project.id, menu.hit.path) },
            { id: 'path', label: t('explorer.search.copyPath'), icon: 'copy', run: () => void copyNotify(menu.hit.path) },
            ...(menu.hit.line ? [{ id: 'line', label: t('explorer.search.copyPathLine'), icon: 'copy' as const, run: () => void copyNotify(`${menu.hit.path}:${menu.hit.line}`) }] : []),
          ]}
        />
      )}
    </div>
  );
}
