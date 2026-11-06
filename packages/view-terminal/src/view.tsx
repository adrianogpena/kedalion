import { lazy, type ReactNode, useMemo } from 'react';
import { TerminalOptionsContext } from '@kedalion/terminal/options';
import { defineView } from '@kedalion/ui';
import { terminalCommands } from './commands';
import { en, ptBR } from './i18n';
import { terminalSettingDefs, type TerminalViewSettings, terminalSettingsOf } from './settings';
import { TerminalProfilesCard, terminalSettingFields } from './settings/cards';
import { PromptCard } from './settings/PromptRow';

// xterm.js is large; the screen loads on first visit.
const TerminalScreen = lazy(() => import('./TerminalScreen').then((m) => ({ default: m.TerminalScreen })));

function TerminalOptions({ settings, children }: { settings: TerminalViewSettings; children: ReactNode }) {
  const options = useMemo(() => terminalSettingsOf(settings), [settings.terminal]);
  return <TerminalOptionsContext.Provider value={options}>{children}</TerminalOptionsContext.Provider>;
}

export interface TerminalViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
}

export function terminalView({ group, order }: TerminalViewOptions) {
  return defineView<'terminal', TerminalViewSettings, 'nav.terminal'>({
    id: 'terminal',
    nav: { group, icon: 'terminal', label: 'nav.terminal', order },
    render: ({ settings, onSave }): ReactNode => <TerminalScreen settings={settings} onSave={onSave} />,
    provider: TerminalOptions,
    commands: terminalCommands,
    settings: { defs: terminalSettingDefs },
    settingsCards: {
      sections: [
        { path: ['terminal'], order: 70, label: 'settings.section.terminal' },
        { path: ['terminal', 'profiles'], order: 10, label: 'settings.section.terminal.profiles' },
        { path: ['terminal', 'appearance'], order: 20, label: 'settings.section.terminal.appearance' },
        { path: ['terminal', 'tabs'], order: 30, label: 'settings.section.terminal.tabs' },
        { path: ['terminal', 'behavior'], order: 40, label: 'settings.section.terminal.behavior' },
        { path: ['terminal', 'output'], order: 35, label: 'settings.section.terminal.output' },
        { path: ['terminal', 'prompt'], order: 15, label: 'settings.section.terminal.prompt' },
      ],
      cards: { 'terminal.profiles': TerminalProfilesCard, 'terminal.prompt': PromptCard },
      fields: terminalSettingFields,
    },
    messages: { en, 'pt-BR': ptBR },
  });
}
