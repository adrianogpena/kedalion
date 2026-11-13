import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, IconButton, type IconName, useShortcutTip } from '@kedalion/ui';
import type { ChatEvent } from '../chat-protocol.ts';
import type { AgentSessionView } from '../protocol.ts';
import { t } from '../i18n';
import { sessionHistory } from './api';
import { displayName } from './attention';
import { type BadgeKind } from './Badge';
import { toolStats } from './session-summary';
import './main.css';

/** Status badge of the head strip: kind and label (spec S7). */
export function headBadge(s: Pick<AgentSessionView, 'status' | 'lifecycle' | 'exitCode'>): { kind: BadgeKind; label: string } {
  if (s.lifecycle === 'exited' || s.status === 'exited') return { kind: 'danger', label: t('agents.badge.exited', { code: s.exitCode == null ? '?' : String(s.exitCode) }) };
  switch (s.status) {
    case 'running': return { kind: 'working', label: t('agents.badge.working') };
    case 'starting': return { kind: 'working', label: t('agents.badge.starting') };
    case 'needs-you': return { kind: 'waiting', label: t('agents.badge.waiting') };
    case 'error': return { kind: 'danger', label: t('agents.badge.error') };
    case 'done': return { kind: 'ok', label: t('agents.badge.done') };
    case 'idle': return { kind: 'neutral', label: t('agents.badge.idle') };
    default: return { kind: 'neutral', label: t('agents.badge.stopped') };
  }
}

export interface SessionHeadProps {
  session: AgentSessionView;
  git?: { branch?: string | null; dirty?: number; ahead?: number; behind?: number };
  onRename(name: string | null): void;
  onStop(): void;
  onRestart(): void;
  onCopy(): void;
  onTrajectory(): void;
  onTogglePanel(): void;
}

function HeadButton({ icon, label, onClick, command, variant }: { icon: IconName; label: string; onClick(): void; command?: string; variant?: 'danger' }) {
  const tip = useShortcutTip();
  return <IconButton size="xs" variant={variant} icon={icon} label={label} title={tip(label, command)} onClick={onClick} />;
}

/** The 34px strip above the selected session (spec S7): title (double-click renames), tool total, subagents, git, context, actions. */
export function SessionHead({ session: s, git, onRename, onStop, onRestart, onCopy, onTrajectory, onTogglePanel }: SessionHeadProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [events, setEvents] = useState<ChatEvent[]>([]);
  useEffect(() => setEditing(false), [s.id]);
  const idRef = useRef(s.id);
  const lastFetch = useRef({ at: 0, updatedAt: s.updatedAt });
  idRef.current = s.id;
  const load = (id: string, updatedAt: AgentSessionView['updatedAt']) => {
    lastFetch.current = { at: Date.now(), updatedAt };
    void sessionHistory(id).then((r) => idRef.current === id && setEvents(r.events), () => undefined);
  };
  useEffect(() => {
    setEvents([]);
    load(s.id, s.updatedAt);
  }, [s.id]);
  // Refresh on transcript changes at most every 10 s (each fetch is a full server-side parse).
  useEffect(() => {
    if (lastFetch.current.updatedAt === s.updatedAt) return;
    const timer = setTimeout(() => load(s.id, s.updatedAt), Math.max(0, lastFetch.current.at + 10_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [s.id, s.updatedAt]);
  const stats = useMemo(() => toolStats(events), [events]);

  const title = displayName(s);
  const running = (s.live === true || s.lifecycle === 'starting') && s.lifecycle !== 'exited';
  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name !== title) onRename(name || null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setEditing(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="agents-head">
      {editing ? (
        <input className="agents-head-rename" aria-label={t('agents.head.rename')} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} />
      ) : (
        <span className="agents-head-title" title={t('agents.head.rename')} onDoubleClick={() => { setDraft(title); setEditing(true); }}>{title}</span>
      )}
      {stats && stats.total > 0 && (
        <span className="agents-head-sub" title={stats.tools.map(([n, c]) => `${n} ${c}`).join(' · ')}>{t('agents.head.tools', { n: stats.total })}</span>
      )}
      {stats && stats.subagents > 0 && <span className="agents-head-sub">{t('agents.head.subagents', { n: stats.subagents })}</span>}
      {stats && stats.workflows > 0 && <span className="agents-head-sub">{t('agents.head.workflows', { n: stats.workflows })}</span>}
      <span className="agents-head-fill" />
      {git?.branch && (
        <span className="agents-head-git">
          <Icon name="git-branch" size={12} />
          {git.branch}
          {git.dirty ? <span className="agents-head-dirty">±{git.dirty}</span> : null}
          {git.behind ? <span className="agents-head-behind" title={t('agents.git.pull', { n: git.behind })}>⇣{git.behind}</span> : null}
          {git.ahead ? <span className="agents-head-ahead" title={t('agents.git.push', { n: git.ahead })}>⇡{git.ahead}</span> : null}
        </span>
      )}
      {s.contextPercent != null && <span className="agents-head-ctx">{Math.round(s.contextPercent)}%</span>}
      <span className="agents-head-actions">
        {running ? <HeadButton variant="danger" command="agents.stop" icon="square" label={t('agents.head.stop')} onClick={onStop} /> : <HeadButton command="agents.restart" icon="rotate-ccw" label={t('agents.head.restart')} onClick={onRestart} />}
        <HeadButton command="agents.copyResponse" icon="copy" label={t('agents.head.copyResponse')} onClick={onCopy} />
        <HeadButton command="agents.trajectory" icon="plan" label={t('agents.head.trajectory')} onClick={onTrajectory} />
        <HeadButton command="agents.togglePanel" icon="panel-right" label={t('agents.head.togglePanel')} onClick={onTogglePanel} />
      </span>
    </div>
  );
}
