import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownView } from '@kedalion/editor';
import { Button, ContextMenu, type ContextMenuItem, errorOf, useDialogs } from '@kedalion/ui';
import { t } from '../../../i18n';
import type { AgentsCapWarn } from '../../../protocol';
import { stopSession } from '../../api';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { advance, implementPrompt, startPrompt, type TaskItem } from './flow';
import { loadTasks, planOf, saveTasks, startModeSession, stateLabel } from './tasks-api';
import './style.css';

const POLL_MS = 2000;

/** Task: a plan-mode session plans the task; the plan is approved, revised or cancelled here; approval starts the implementing session. */
function TaskPanel({ project, api, visible }: PanelProps) {
  const host = useAgentsHost();
  const dialogs = useDialogs();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [text, setText] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState('');
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'> }>();
  const reviewed = useRef(new Set<string>());
  const latest = useRef(tasks);
  latest.current = tasks;
  const skipSave = useRef(true);
  const loadedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    loadedFor.current = undefined;
    skipSave.current = true;
    setSelected(undefined);
    setLoaded(false);
    loadTasks(project).then(
      (list) => {
        if (!alive) return;
        loadedFor.current = project;
        setTasks(list);
        setSelected(list[0]?.id);
        setLoaded(true);
      },
      (e) => {
        if (!alive) return;
        setError(errorOf(e).message);
        setLoaded(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [project]);

  useEffect(() => {
    if (!loaded || loadedFor.current !== project) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    void saveTasks(project, tasks).catch((e) => setError(errorOf(e).message));
  }, [tasks, loaded, project]);

  const patch = useCallback((id: string, change: Partial<TaskItem>) => setTasks((all) => all.map((x) => (x.id === id ? { ...x, ...change } : x))), []);

  const waiting = tasks
    .filter((x) => x.state === 'planning' || x.state === 'planned')
    .map((x) => x.id)
    .join('|');
  useEffect(() => {
    if (!loaded || !visible || !waiting) return;
    let alive = true;
    const poll = async () => {
      for (const task of latest.current) {
        if (task.state !== 'planning' && task.state !== 'planned') continue;
        const plan = await planOf(task.planSession).catch(() => undefined);
        const now = latest.current.find((x) => x.id === task.id);
        const change = now && advance(now, { plan });
        if (alive && change) patch(task.id, change);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loaded, visible, waiting, patch]);

  useEffect(() => {
    if (!loaded) return;
    for (const task of tasks) {
      if (task.state !== 'approved' && task.state !== 'implementing') continue;
      const implStatus = host.sessions.find((s) => s.id === task.implSession)?.status;
      const change = advance(task, { implStatus });
      if (!change) continue;
      patch(task.id, change);
      if (change.state === 'done' && task.review && !reviewed.current.has(task.id)) {
        reviewed.current.add(task.id);
        api.open('review');
      }
    }
  }, [host.sessions, tasks, loaded, patch, api]);

  const account = host.accounts.find((a) => a.active) ?? host.accounts.find((a) => a.isDefault) ?? host.accounts[0];
  const confirmCap = (w: AgentsCapWarn) => dialogs.confirm({ title: t('agents.cap.warn', { live: w.live, cap: w.cap }), okLabel: t('agents.cap.confirm') });

  const start = async () => {
    const prompt = text.trim();
    if (!prompt || !account || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await startModeSession({ account: account.id, dir: project, mode: 'plan', prompt: startPrompt(host.taskSkill, prompt), confirmCap });
      if (!r) return;
      const task: TaskItem = { id: crypto.randomUUID(), text: prompt, state: 'planning', planSession: r.sessionId, review: review || undefined, createdAt: Date.now() };
      setTasks((all) => [task, ...all]);
      setSelected(task.id);
      setText('');
      api.open('agent', { sessionId: r.sessionId, terminal: r.session });
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  const current = tasks.find((x) => x.id === selected);

  const approve = async (task: TaskItem) => {
    if (!task.plan || !account || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await startModeSession({ account: account.id, dir: project, mode: 'acceptEdits', prompt: implementPrompt(task.plan), confirmCap });
      if (!r) return;
      patch(task.id, { state: 'approved', implSession: r.sessionId, worked: false });
      void stopSession(task.planSession).catch(() => undefined);
      api.open('agent', { sessionId: r.sessionId, terminal: r.session });
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  const revise = (task: TaskItem) => {
    const body = revision.trim();
    if (!body) return;
    host.sendToSession(task.planSession, body);
    api.open('agent', { sessionId: task.planSession });
    setRevision('');
    setRevising(false);
  };

  const remove = (task: TaskItem, stop: boolean) => {
    if (stop) void stopSession(task.planSession).catch(() => undefined);
    setTasks((all) => all.filter((x) => x.id !== task.id));
    if (selected === task.id) setSelected(undefined);
  };

  const planning = current?.state === 'planning' || current?.state === 'planned';

  return (
    <div className="agents-panel-task">
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} />}
      <div className="agents-task-new">
        <textarea aria-label={t('panel.task.title')} placeholder={t('panel.task.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="agents-task-row">
          <label className="agents-task-check">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
            {t('panel.task.reviewWhenDone')}
          </label>
          <span style={{ flex: 1 }} />
          <Button variant="primary" size="sm" icon="play" disabled={busy || !text.trim() || !account} onClick={() => void start()}>
            {busy ? t('panel.task.starting') : t('panel.task.start')}
          </Button>
        </div>
        {!account && <div className="agents-task-hint">{t('panel.task.noAccount')}</div>}
        {error && (
          <div role="alert" className="agents-task-error">
            {error}
          </div>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="agents-task-hint">{t('panel.task.empty')}</div>
      ) : (
        <ul className="agents-task-list" aria-label={t('panel.task.list')}>
          {tasks.map((task) => (
            <li
              key={task.id}
              className="agents-task-item"
              aria-current={task.id === selected}
              onClick={() => {
                setSelected(task.id);
                setRevising(false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const live = task.state === 'planning' || task.state === 'planned';
                const items: Array<ContextMenuItem | 'sep'> = [
                  { id: 'open', label: t('panel.task.openSession'), icon: 'popout', run: () => api.open('agent', { sessionId: live ? task.planSession : (task.implSession ?? task.planSession) }) },
                ];
                if (task.state === 'planned') items.push({ id: 'approve', label: t('panel.task.approve'), icon: 'check', disabled: busy || !account, run: () => void approve(task) });
                if (live) items.push('sep', { id: 'cancel', label: t('panel.task.cancel'), icon: 'square', danger: true, run: () => remove(task, true) });
                else if (task.state === 'done') items.push('sep', { id: 'remove', label: t('panel.task.remove'), icon: 'trash', danger: true, run: () => remove(task, false) });
                setMenu({ at: { x: e.clientX, y: e.clientY }, items });
              }}
            >
              <span className="agents-task-text" title={task.text}>
                {task.text}
              </span>
              <span className="agents-task-state" data-state={task.state}>
                {stateLabel(task.state)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {current && (
        <div className="agents-task-plan">
          {current.state === 'planning' && <div className="agents-task-hint">{t('panel.task.waitingPlan')}</div>}
          {current.plan && <MarkdownView markdown={current.plan} />}
          <div className="agents-task-row end">
            <Button size="sm" icon="popout" onClick={() => api.open('agent', { sessionId: planning ? current.planSession : (current.implSession ?? current.planSession) })}>
              {t('panel.task.openSession')}
            </Button>
            {planning && (
              <Button variant="danger" size="sm" icon="square" onClick={() => remove(current, true)}>
                {t('panel.task.cancel')}
              </Button>
            )}
            {current.state === 'planned' && (
              <>
                <Button size="sm" pressed={revising} onClick={() => setRevising((v) => !v)}>
                  {t('panel.task.revise')}
                </Button>
                <Button variant="primary" size="sm" icon="check" disabled={busy || !account} onClick={() => void approve(current)}>
                  {t('panel.task.approve')}
                </Button>
              </>
            )}
            {current.state === 'done' && (
              <Button variant="danger" size="sm" icon="trash" onClick={() => remove(current, false)}>
                {t('panel.task.remove')}
              </Button>
            )}
          </div>
          {revising && current.state === 'planned' && (
            <div className="agents-task-revise">
              <label className="agents-task-hint" htmlFor="agents-task-revision">
                {t('panel.task.reviseLabel')}
              </label>
              <textarea id="agents-task-revision" value={revision} onChange={(e) => setRevision(e.target.value)} />
              <div className="agents-task-hint">{t('panel.task.reviseHint')}</div>
              <div className="agents-task-row end">
                <Button variant="primary" size="sm" disabled={!revision.trim()} onClick={() => revise(current)}>
                  {t('panel.task.reviseSend')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'task',
  titleKey: 'panel.task.title',
  icon: 'check',
  placement: 'both',
  single: true,
  Panel: TaskPanel,
};
