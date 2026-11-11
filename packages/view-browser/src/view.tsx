import { lazy } from 'react';
import { defineView } from '@kedalion/ui';
import { bindBrowserClient, browserClient, type BrowserClient } from './client';
import { browserCommands } from './commands';
import { en, ptBR } from './i18n';
import { RegenerateSecretField } from './SettingsFields';
import { browserSettingDefs,type BrowserViewSettings } from './settings';

const BrowserScreen = lazy(() => import('./BrowserScreen').then((m) => ({ default: m.BrowserScreen })));

export interface BrowserViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The server calls the screen makes. */
  client?: BrowserClient;
}

export function browserView({ group, order, client = browserClient }: BrowserViewOptions) {
  bindBrowserClient(client);
  return defineView<'browser', BrowserViewSettings, 'nav.browser'>({
    id: 'browser',
    nav: { group, icon: 'globe', label: 'nav.browser', order },
    render: ({ settings }) => <BrowserScreen home={settings.browser?.home || 'about:blank'} />,
    commands: browserCommands,
    settings: { defs: browserSettingDefs },
    settingsCards: { sections: [], fields: { 'browser.regenerateSecret': RegenerateSecretField } },
    messages: { en, 'pt-BR': ptBR },
  });
}
