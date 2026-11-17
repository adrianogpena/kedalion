import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitDiff, GitFile } from '@kedalion/server-core/protocol';
import { Button, ErrorBanner, errorOf, IconButton, PanelLoading, request, useAsync, useToast } from '@kedalion/ui';
import { t } from '../../../i18n';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { gitClient } from '../diff/git-client';
import { askAgent } from './ask';
import { addedDiff, type DiffLine, parseDiff } from './diff-parse';
import { reviewPrompt } from './prompt';
import './style.css';

const SAVE_DELAY_MS = 500;

interface Comment {
  id: string;
  path: string;
  line: number;
  removed?: boolean;
  text: string;
}

interface State {
  viewed: string[];
  comments: Comment[];
  summary: string;
}

const getState = (project: string) => request<State>('GET', '/api/agents/review', { project });
const putState = (project: string, s: State) => request<{ ok: boolean }>('PUT', '/api/agents/review', { project }, s);
const diffOf = (root: string, path: string, staged: boolean) =>
  request<GitDiff>('GET', '/api/git/diff', { root, path, ...(staged ? { staged: '1' } : {}) }).then((d) => d.text, () => '');

/** Unified diff of a changed file: staged part, then unstaged; untracked files read as all added. */
async function loadDiff(root: string, file: GitFile, others: GitFile[]): Promise<DiffLine[]> {
  if (file.group === 'untracked' || file.group === 'conflict') {
    const r = await gitClient.fsRead(root, file.path).catch(() => ({ binary: true as const }));
    return 'text' in r ? parseDiff(addedDiff(r.text)) : [];
  }
  const staged = others.some((f) => f.group === 'staged');
  const unstaged = others.some((f) => f.group === 'unstaged');
  const parts = await Promise.all([staged ? diffOf(root, file.path, true) : '', unstaged ? diffOf(root, file.path, false) : '']);
  return parseDiff(parts.join('\n'));
}

const lineKey = (l: DiffLine) => (l.kind === 'del' ? `-${l.oldNo}` : String(l.newNo));

function FileBlock({
  root,
  path,
  files,
  pollMs,
  viewed,
  comments,
  onViewed,
  onAdd,
  onRemove,
}: {
  root: string;
  path: string;
  files: GitFile[];
  pollMs: number;
  viewed: boolean;
  comments: Comment[];
  onViewed(on: boolean): void;
  onAdd(c: Omit<Comment, 'id'>): void;
  onRemove(id: string): void;
}) {
  const [open, setOpen] = useState(!viewed);
  const [draftAt, setDraftAt] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const lines = useAsync(() => loadDiff(root, files[0]!, files), [root, path, files.map((f) => f.group).join()], pollMs);
  const byLine = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of comments) m.set(c.removed ? `-${c.line}` : String(c.line), [...(m.get(c.removed ? `-${c.line}` : String(c.line)) ?? []), c]);
    return m;
  }, [comments]);

  const submit = (l: DiffLine) => {
    const text = draft.trim();
    if (text) onAdd({ path, line: l.kind === 'del' ? l.oldNo! : l.newNo!, ...(l.kind === 'del' ? { removed: true } : {}), text });
    setDraft('');
    setDraftAt(undefined);
  };

  return (
    <section className="agents-review-file" data-viewed={viewed}>
      <header className="agents-review-filebar">
        <button type="button" className="agents-review-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="agents-review-path" title={path}>{path}</span>
        <label className="agents-review-viewed">
          <input type="checkbox" checked={viewed} onChange={(e) => { onViewed(e.target.checked); if (e.target.checked) setOpen(false); }} />
          {t('panel.review.viewed')}
        </label>
      </header>
      {open &&
        (lines.error ? (
          <ErrorBanner error={lines.error} onRetry={lines.reload} />
        ) : !lines.data ? (
          <PanelLoading />
        ) : (
          <div className="agents-review-diff">
            {lines.data.map((l, i) => {
              if (l.kind === 'hunk' || l.kind === 'note') return <div key={i} className="agents-review-line" data-kind="hunk"><span className="agents-review-text">{l.text}</span></div>;
              const key = lineKey(l);
              const here = byLine.get(key) ?? [];
              return (
                <div key={i}>
                  <div className="agents-review-line" data-kind={l.kind} onClick={() => { setDraftAt(key); setDraft(''); }}>
                    <span className="agents-review-no">{l.oldNo ?? ''}</span>
                    <span className="agents-review-no">{l.newNo ?? ''}</span>
                    <span className="agents-review-text">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}{l.text}</span>
                  </div>
                  {here.map((c) => (
                    <div key={c.id} className="agents-review-comment">
                      <span>{c.removed ? `(${t('panel.review.removedLine')}) ` : ''}{c.text}</span>
                      <IconButton size="xs" icon="close" label={t('panel.review.remove')} onClick={() => onRemove(c.id)} />
                    </div>
                  ))}
                  {draftAt === key && (
                    <form className="agents-review-draft" onSubmit={(e) => { e.preventDefault(); submit(l); }}>
                      <textarea
                        autoFocus
                        rows={2}
                        value={draft}
                        placeholder={t('panel.review.commentPlaceholder')}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setDraftAt(undefined);
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(l);
                        }}
                      />
                      <Button size="xs" onClick={() => setDraftAt(undefined)}>{t('panel.review.cancel')}</Button>
                      <Button type="submit" variant="primary" size="xs" disabled={!draft.trim()}>{t('panel.review.add')}</Button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </section>
  );
}

const POLL_MS = 4000;

function ReviewPanel({ project, api, visible }: PanelProps) {
  const host = useAgentsHost();
  const [state, setState] = useState<State | undefined>();
  const [target, setTarget] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<State>();
  const changed = useRef<Set<string>>();
  const toast = useToast();

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const s = pending.current;
    pending.current = undefined;
    if (!s) return;
    const paths = changed.current;
    const next = paths ? { ...s, viewed: s.viewed.filter((p) => paths.has(p)) } : s;
    void putState(project, next).catch((e) => toast({ kind: 'error', message: errorOf(e).message }));
  }, [project, toast]);

  useEffect(() => {
    setState(undefined);
    let live = true;
    void getState(project).then((s) => live && setState(s), () => live && setState({ viewed: [], comments: [], summary: '' }));
    return () => {
      live = false;
      flush();
    };
  }, [project, flush]);

  const change = (next: State) => {
    setState(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const pollMs = visible ? POLL_MS : 0;
  const status = useAsync(() => gitClient.gitStatus(project), [project], pollMs);
  const byPath = useMemo(() => {
    const m = new Map<string, GitFile[]>();
    for (const f of status.data?.files ?? []) m.set(f.path, [...(m.get(f.path) ?? []), f]);
    return [...m.entries()];
  }, [status.data]);
  changed.current = status.data ? new Set(status.data.files.map((f) => f.path)) : undefined;

  const projectId = host.projectIdOf(project);
  const sessions = host.sessions.filter((s) => s.project === projectId && s.live && !s.external);
  const chosen = sessions.some((s) => s.id === target) ? target : (host.selectedId && sessions.some((s) => s.id === host.selectedId) ? host.selectedId : sessions[0]?.id);

  if (!state) return <div className="agents-panel-review"><PanelLoading /></div>;
  if (status.error && !status.data) return <div className="agents-panel-review"><ErrorBanner error={status.error} onRetry={status.reload} /></div>;

  const send = () => {
    if (!chosen || state.comments.length === 0) return;
    api.sendToSession(chosen, reviewPrompt(state.comments, state.summary));
    change({ ...state, comments: [], summary: '' });
  };

  return (
    <div className="agents-panel-review">
      <div className="agents-review-scroll">
        {byPath.length === 0 && status.data && <p className="agents-empty agents-placeholder">{t('panel.review.empty')}</p>}
        {byPath.map(([path, files]) => (
          <FileBlock
            key={path}
            root={project}
            path={path}
            files={files}
            pollMs={pollMs}
            viewed={state.viewed.includes(path)}
            comments={state.comments.filter((c) => c.path === path)}
            onViewed={(on) => change({ ...state, viewed: on ? [...state.viewed, path] : state.viewed.filter((p) => p !== path) })}
            onAdd={(c) => change({ ...state, comments: [...state.comments, { ...c, id: crypto.randomUUID() }] })}
            onRemove={(id) => change({ ...state, comments: state.comments.filter((c) => c.id !== id) })}
          />
        ))}
      </div>
      <footer className="agents-review-send">
        <textarea rows={2} value={state.summary} placeholder={t('panel.review.summaryPlaceholder')} aria-label={t('panel.review.summary')} onChange={(e) => change({ ...state, summary: e.target.value })} />
        <div className="agents-review-sendrow">
          {sessions.length === 0 ? (
            <span className="agents-empty">{t('panel.review.noSession')}</span>
          ) : (
            <select value={chosen} aria-label={t('panel.review.sendTo')} onChange={(e) => setTarget(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title || s.id.slice(0, 8)}</option>
              ))}
            </select>
          )}
          <Button variant="primary" size="sm" disabled={!chosen || state.comments.length === 0} onClick={send}>
            {t('panel.review.send')} ({state.comments.length})
          </Button>
        </div>
      </footer>
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'review',
  titleKey: 'panel.review.title',
  icon: 'eye',
  placement: 'center',
  single: true,
  Panel: ReviewPanel,
  commands: [{ id: 'agents.askAgent', key: 'Ctrl+L', run: (api) => void askAgent(api) }],
};
