import type { ReactNode } from 'react';
import { t } from '../i18n';

/**
 * Dossier layout: the Git screen as the project's history. The commit list is the main column, the diff of the
 * selection beside it, and a state sidebar on the right (branch, upstream distance, changed files, the screen's actions).
 * The panes are the Git screen's own, passed in as slots.
 */
export function DossierGitPage({ history, diff, state, actions }: { history: ReactNode; diff: ReactNode; state: ReactNode; actions: ReactNode }) {
  return (
    <div className="dossier-git">
      <div className="dossier-git-history">{history}</div>
      <div className="dossier-git-diff">{diff}</div>
      <aside className="dossier-git-state" aria-label={t('git.dossierState')}>
        <div className="dossier-git-state-head">
          <span className="dossier-git-state-title">{t('git.dossierState')}</span>
          <span className="spacer" />
          {actions}
        </div>
        {state}
      </aside>
    </div>
  );
}
