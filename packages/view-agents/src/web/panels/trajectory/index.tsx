import { TrajectoryTab } from '../../TrajectoryTab';
import { categoryOf } from '../../filters';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps, SectionProps, WorkspaceApi } from '../../workspace/types';
import './style.css';

/** The trajectory of a session: the one in `sessionId`, else the selected session. */
function TrajectoryBody({ api, sessionId: given, onClose, compact, initialStep }: { api: WorkspaceApi; sessionId?: string; onClose: () => void; compact: boolean; initialStep?: number }) {
  const host = useAgentsHost();
  const sessionId = given || host.selectedId;
  const session = host.sessions.find((s) => s.id === sessionId);
  const canShow = !!session && (session.external === true || categoryOf(session) === 'stopped');
  return (
    <TrajectoryTab
      sessionId={session?.id}
      available={!!session && session.lifecycle !== 'starting'}
      onClose={onClose}
      compact={compact}
      running={session?.status === 'running'}
      canShow={canShow}
      onShow={(focus) => session && api.open('agent', { sessionId: session.id, focus })}
      initialStep={initialStep}
      onExpand={(step) => session && api.open('trajectory', { sessionId: session.id, step })}
      onOutput={(toolUseId) => session && api.open('output', { sessionId: session.id, toolUseId })}
    />
  );
}

function TrajectoryPanel({ params, api, tabId }: PanelProps) {
  const sessionId = typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : undefined;
  return (
    <div className="agents-panel-trajectory">
      <TrajectoryBody api={api} sessionId={sessionId} onClose={() => api.close(tabId)} compact={params.side === true} initialStep={typeof params.step === 'number' ? params.step : undefined} />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'trajectory',
  titleKey: 'panel.trajectory.title',
  icon: 'history',
  placement: 'both',
  Panel: TrajectoryPanel,
  Section: ({ api, sessionId }: SectionProps) => (
    <div className="agents-panel-trajectory agents-panel-trajectory-side">
      <TrajectoryBody api={api} sessionId={sessionId} onClose={() => undefined} compact />
    </div>
  ),
};
