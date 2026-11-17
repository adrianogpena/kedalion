import { forwardRef, lazy, Suspense } from 'react';
import { CodeView, type DiffMode, type DiffViewHandle, langOfContent } from '@kedalion/editor';
import type { GitCommitFile, GitFile, GitFileContent } from '@kedalion/server-core/protocol';
import { ErrorBanner, PanelBanner, PanelLoading, PanelNotice, useAsync } from '@kedalion/ui';
import { t } from '../i18n';
import { commitSidesOf, sidesOf } from './sides';

const DiffView = lazy(() => import('@kedalion/editor').then((m) => ({ default: m.DiffView })));

const problemOf = (side?: GitFileContent) =>
  side?.binary ? t('git.binary') : side?.tooLarge ? t('git.tooLarge') : side?.missing ? t('git.missing') : undefined;

/** A working-tree change, or a file changed by a commit. */
export type GitDiffSource = { file: GitFile; commit?: undefined } | { file: GitCommitFile; commit: string };

export interface GitDiffPaneProps {
  root: string;
  source: GitDiffSource;
  /** Changes on every refresh, so the sides are read again. */
  tick: number;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
}

/** The diff of one changed file, or a message when it can't be shown. */
export const GitDiffPane = forwardRef<DiffViewHandle, GitDiffPaneProps>(function GitDiffPane({ root, source, tick, mode, onModeChange }, ref) {
  const { file } = source;
  const sides = useAsync(
    () => (source.commit !== undefined ? commitSidesOf(root, source.commit, source.file) : sidesOf(root, source.file)),
    // A commit never changes, so its sides are read once.
    source.commit !== undefined ? [root, source.commit, file.path] : [root, file.path, source.file.group, source.file.index, source.file.worktree, tick],
  );
  if (sides.error) return <ErrorBanner error={sides.error} onRetry={sides.reload} />;
  if (!sides.data) return <PanelLoading />;
  const { original, modified } = sides.data;
  const lang = langOfContent(file.path.split('/').pop() ?? file.path, (modified ?? original)?.text);
  const problem = problemOf(original) ?? problemOf(modified);
  if (problem) return <PanelNotice icon="file" title={file.path} message={problem} />;
  if (!original) {
    return (
      <div className="git-conflict">
        <PanelBanner tone="warn">{t('git.conflictNote')}</PanelBanner>
        <div className="git-conflict-body"><CodeView value={modified.text ?? ''} lang={lang} lineNumbers /></div>
      </div>
    );
  }
  const modeChange = source.commit === undefined ? source.file.modeChange : undefined;
  return (
    <Suspense fallback={<PanelLoading />}>
      {modeChange && <PanelBanner tone="warn">{t('git.modeChange', modeChange)}</PanelBanner>}
      <DiffView
        ref={ref}
        original={original.text ?? ''}
        modified={modified.text ?? ''}
        lang={lang}
        mode={mode}
        onModeChange={onModeChange}
        modeLabels={{ split: t('git.split'), inline: t('git.inline') }}
      />
    </Suspense>
  );
});
