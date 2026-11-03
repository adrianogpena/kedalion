import { lazy } from 'react';
import { defineView, DossierPage, fileSettingsOf } from '@kedalion/ui';
import { bindExplorerClient, type ExplorerClients } from './client';
import { explorerViewCommands } from './commands';
import { explorerClients } from './default-client';
import { en, ptBR } from './i18n';
import { setMultiDelete } from './options';
import { explorerSettingDefs, type ExplorerViewSettings } from './settings';
import { MarkdownSettingsHost } from './markdown-settings';
import { ExcludeSettingField, ExplorerCard, NestingSettingField, ReadingWidthSettingField, ZoomSettingField } from './settings/cards';

const ExplorerScreen = lazy(() => import('./ExplorerScreen').then((m) => ({ default: m.ExplorerScreen })));

export interface ExplorerViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The server calls the screen makes. */
  client?: ExplorerClients;
  /** Whether the tree may delete several entries at once; off when omitted. */
  multiDelete?: boolean;
}

export function explorerView({ group, order, client = explorerClients, multiDelete = false }: ExplorerViewOptions) {
  bindExplorerClient(client);
  setMultiDelete(multiDelete);
  return defineView<'explorer', ExplorerViewSettings, 'nav.explorer'>({
    id: 'explorer',
    nav: { group, icon: 'folder', label: 'nav.explorer', order },
    render: ({ settings, onSave }) => (
      <>
        <MarkdownSettingsHost markdown={settings.markdown} toc={fileSettingsOf(settings.files).markdownToc} />
        <DossierPage chapter="code">
          <ExplorerScreen settings={settings} onSave={onSave} />
        </DossierPage>
      </>
    ),
    commands: explorerViewCommands,
    settings: { defs: explorerSettingDefs },
    settingsCards: {
      sections: [{ path: ['explorer'], order: 50, label: 'settings.section.explorer' }],
      cards: { explorer: ExplorerCard },
      fields: {
        'files.nestingPatterns': NestingSettingField,
        'files.exclude': ExcludeSettingField,
        'markdown.readingWidth': ReadingWidthSettingField,
        'markdown.zoom': ZoomSettingField,
      },
    },
    messages: { en, 'pt-BR': ptBR },
  });
}
