import { useEffect, useState } from 'react';
import { errorOf, useDialogs } from '@kedalion/ui';
import { TerminalPane, type TerminalPaneHandle } from '@kedalion/terminal';
import { listSessions } from '@kedalion/terminal/session';
import { t } from '../../../i18n';
import { patchSessionState, startSession, takeOverSession, terminalOf } from '../../api';
import { categoryOf } from '../../filters';
import { ExitBar } from '../../ExitBar';
import { ExternalPane } from '../../ExternalPane';
import { ResumeBar } from '../../ResumeBar';
import { SessionHead } from '../../SessionHead';
import { StoppedPane } from '../../StoppedPane';
import { readFocus } from '../../trajectory/model';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** A Claude session: its head strip and terminal, or its stopped / external view; the panel's params are `{ sessionId, terminal? }`. */
function AgentPanel({ params, api, update }: PanelProps) {
  const host = useAgentsHost();
  const dialogs = useDialogs();
  const sessionId = text(params.sessionId) ?? '';
  const hint = text(params.terminal);
  const focus = readFocus(params.focus);
  const session = host.sessions.find((s) => s.id === sessionId);
  const [terminal, setTerminal] = useState<string | undefined>(hint);
  const [resolved, setResolved] = useState(hint !== undefined);
  const stoppedNow = session !== undefined && !session.external && categoryOf(session) === 'stopped';
  const lifecycle = session?.lifecycle;
  const known = session !== undefined;
  const external = session?.external === true;

  useEffect(() => {
    if (!hint) return;
    setTerminal(hint);
    setResolved(true);
  }, [hint]);

  useEffect(() => {
    if (!sessionId || !known || external) return;
    if (stoppedNow && lifecycle !== 'exited') {
      setTerminal(undefined);
      setResolved(true);
      return;
    }
    if (terminal) return;
    let alive = true;
    terminalOf(sessionId).then(
      (live) => {
        if (!alive) return;
        if (live) setTerminal(live);
        setResolved(true);
      },
      (e) => {
        if (!alive) return;
        setResolved(true);
        host.setError(errorOf(e).message);
      },
    );
    return () => {
      alive = false;
    };
  }, [sessionId, known, external, stoppedNow, lifecycle, terminal]);

  // `/clear` gives the pty a new Claude session id (the server adopts it into the pty's meta): follow it.
  useEffect(() => {
    if (!terminal || !sessionId) return;
    let alive = true;
    void listSessions().then(
      (all) => {
        const to = all.find((x) => x.id === terminal)?.meta?.agentSession;
        if (!alive || typeof to !== 'string' || to === sessionId) return;
        const active = document.activeElement;
        const hadFocus = !active || active === document.body || active.closest('.agents-main') !== null;
        update({ sessionId: to });
        if (hadFocus) host.focusSoon();
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [host.sessions, terminal, sessionId]);

  const inExternal = external && session !== undefined;
  const inTerminal = !inExternal && terminal !== undefined;
  const inPreview = !inExternal && !inTerminal && session !== undefined && resolved;
  const showSession = session !== undefined && (inTerminal || inExternal || inPreview);
  const exitedHere = showSession && !inExternal && (session.lifecycle === 'exited' || (inPreview && (session.status === 'exited' || host.userStopped.has(session.id))));
  const resumeHere = showSession && inPreview && !exitedHere && !session.external && !host.resumeDismissed.has(session.id);

  const startPreview = async () => {
    if (!session) return;
    host.setError('');
    try {
      const r = await startSession({ account: session.account, dir: session.cwd, sessionId: session.id });
      setTerminal(r.session);
      setResolved(true);
      host.focusSoon();
    } catch (e) {
      host.setError(errorOf(e).message);
    }
  };

  /** Take over an external session (a hanging one is only closed, not started): ends the other terminal's process (after a warning unless it is idle), then resumes it here. */
  const takeOver = async () => {
    if (!session) return;
    host.setError('');
    if (!session.hanging && session.status !== 'idle' && session.status !== 'done') {
      const status = t(`agents.status.${session.status}`).toLowerCase();
      const ok = await dialogs.confirm({ title: t('agents.external.takeover'), body: t('agents.external.takeoverBusy', { status }), okLabel: t('agents.external.takeover'), danger: true });
      if (!ok) return;
    }
    try {
      if (!(await takeOverSession(session.id)).ok) return host.setError(t('agents.external.takeoverFailed'));
      if (session.hanging) return;
      const r = await startSession({ account: session.account, dir: session.cwd, sessionId: session.id });
      setTerminal(r.session);
      setResolved(true);
      host.focusSoon();
    } catch (e) {
      host.setError(errorOf(e).message);
    }
  };

  const clearExited = () => {
    host.clearExited(sessionId);
    setTerminal(undefined);
    setResolved(true);
  };

  const missing = !session && !terminal && host.sessions.length > 0;

  return (
    <div className="agents-panel-agent">
      {showSession && (
        <SessionHead
          session={session}
          git={host.git[session.cwd]}
          onRename={(name) => void patchSessionState(session.id, { name }).catch((e) => host.setError(errorOf(e).message))}
          onStop={() => host.stop(session)}
          onRestart={() => host.restart(session)}
          onCopy={() => host.copyResponse(session.id)}
          onTrajectory={() => api.open('trajectory', { sessionId: session.id })}
          onTogglePanel={() => api.toggleSide()}
        />
      )}
      <div className="agents-panes">
        {terminal && (
          <div className="agents-pane">
            <TerminalPane
              session={terminal}
              appKeys={host.appKeys}
              focused={false}
              handle={(h: TerminalPaneHandle | null) => host.registerTerminal(sessionId, h ? { insert: h.insert, submit: h.submit } : null)}
            />
          </div>
        )}
        {inExternal && (
          <div className="agents-pane">
            <ExternalPane focus={focus} sessionId={session.id} updatedAt={session.updatedAt} external={session.external === true} hanging={session.hanging === true} onTakeOver={() => void takeOver()} />
          </div>
        )}
        {inPreview && !terminal && (
          <div className="agents-pane">
            <StoppedPane
              focus={focus}
              session={session}
              branch={host.git[session.cwd]?.branch}
              onStart={() => void startPreview()}
              onBackground={() => host.startBackground(session)}
              onRestart={() => host.restart(session)}
              onClear={clearExited}
              noName
            />
          </div>
        )}
        {missing && (
          <div className="agents-dock-card">
            <h2 className="agents-dock-card-title">{t('workspace.agent.missing')}</h2>
            <p className="agents-dock-card-desc">{t('workspace.agent.missing.desc')}</p>
          </div>
        )}
      </div>
      {exitedHere && <ExitBar code={session.exitCode} userStopped={host.userStopped.has(session.id)} onRestart={() => host.restart(session)} onClose={clearExited} />}
      {resumeHere && <ResumeBar onResume={() => void startPreview()} onDismiss={() => host.dismissResume(session.id)} />}
      {dialogs.element}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'agent',
  titleKey: 'panel.agent.title',
  icon: 'cube',
  placement: 'center',
  Panel: AgentPanel,
};
