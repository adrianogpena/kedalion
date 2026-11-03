import { lazy } from 'react';
import { defineView, DossierPage } from '@kedalion/ui';
import { bindGitClient, gitClient, type GitClient } from './client';
import { gitCommands } from './commands';
import { en, ptBR } from './i18n';
import type { GitViewSettings } from './settings';

const GitScreen = lazy(() => import('./GitScreen').then((m) => ({ default: m.GitScreen })));

export interface GitViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The server calls the screen makes. */
  client?: GitClient;
}

export function gitView({ group, order, client = gitClient }: GitViewOptions) {
  bindGitClient(client);
  return defineView<'git', GitViewSettings, 'nav.git'>({
    id: 'git',
    nav: { group, icon: 'git-branch', label: 'nav.git', order },
    render: ({ settings, onSave }) => (
      <DossierPage chapter="history">
        <GitScreen settings={settings} onSave={onSave} />
      </DossierPage>
    ),
    commands: gitCommands,
    messages: { en, 'pt-BR': ptBR },
  });
}
