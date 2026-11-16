import { lazy, Suspense } from 'react';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps } from '../../workspace/types';
import './style.css';

const TerminalPane = lazy(() => import('@kedalion/terminal').then((m) => ({ default: m.TerminalPane })));

/** The one shell of each project: kept here so the panel and the sidebar card reattach to it. */
const sessions = new Map<string, string>();

function TerminalBody({ project, visible }: { project: string | undefined; visible: boolean }) {
  if (!project) return <p className="agents-empty agents-placeholder">{t('panel.terminal.noProject')}</p>;
  return (
    <div className="agents-terminal">
      <Suspense fallback={null}>
        <TerminalPane
          key={project}
          session={sessions.get(project)}
          dir={project}
          restartOnExit
          visible={visible}
          onSession={(id) => sessions.set(project, id)}
        />
      </Suspense>
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'terminal',
  titleKey: 'panel.terminal.title',
  icon: 'terminal',
  placement: 'both',
  single: true,
  Panel: ({ project, visible }: PanelProps) => <TerminalBody project={project} visible={visible} />,
  Section: ({ project }: SectionProps) => <TerminalBody project={project} visible />,
};
