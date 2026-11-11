import { useState, type MouseEvent } from 'react';
import type { GitFile } from '@kedalion/server-core/protocol';
import { Button, ContextMenu, type ContextMenuItem, copyNotify, IconButton, ToolbarSep, errorOf, ErrorBanner, PanelLoading, useAsync, useDialogs, useToast, useViewLink } from '@kedalion/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps, WorkspaceApi } from '../../workspace/types';
import { codeOf, gitClient } from '../diff/git-client';
import { gitAction, listBranches, sessionChanges } from './git-api';
import './style.css';

const POLL_MS = 3000;

type Group = 'staged' | 'unstaged' | 'untracked' | 'conflict';
const GROUPS: Array<{ group: Group; key: 'staged' | 'unstaged' | 'untracked' | 'conflict' }> = [
  { group: 'conflict', key: 'conflict' },
  { group: 'staged', key: 'staged' },
  { group: 'unstaged', key: 'unstaged' },
  { group: 'untracked', key: 'untracked' },
];

/** Opens the file's diff over the changes list. */
function openDiff(api: WorkspaceApi, file: GitFile) {
  api.open('diff', { path: file.path, group: file.group });
}

interface ChangesViewProps {
  project: string;
  api: WorkspaceApi;
  visible: boolean;
  /** Show only what this Claude session changed (files it wrote, commits since it started). */
  sessionId?: string;
  /** Sidebar card: file rows show only the file name. */
  sectionMode?: boolean;
}

function ChangesView({ project, api, visible, sessionId, sectionMode }: ChangesViewProps) {
  const toast = useToast();
  const openInGit = useViewLink<{ project: string; commit: string }>('git');
  const dialogs = useDialogs();
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'> }>();
  const openMenu = (e: MouseEvent, items: Array<ContextMenuItem | 'sep'>) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: { x: e.clientX, y: e.clientY }, items });
  };
  const status = useAsync(() => gitClient.gitStatus(project), [project], visible ? POLL_MS : 0);
  const refresh = status.reload;
  const branches = useAsync(() => listBranches(project), [project, status.data?.branch]);
  const session = useAsync(() => (sessionId ? sessionChanges(project, sessionId) : Promise.resolve(undefined)), [project, sessionId], visible && sessionId ? POLL_MS : 0);

  const run = async (action: string, body?: Record<string, unknown>, done?: () => void) => {
    setBusy(true);
    try {
      await gitAction(action, project, body);
      done?.();
    } catch (e) {
      const err = errorOf(e);
      toast({ message: err.detail || err.message, kind: 'error' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (status.error && !status.data) return <ErrorBanner error={status.error} onRetry={status.reload} />;
  if (!status.data) return <PanelLoading />;
  const { branch, ahead, behind } = status.data;
  if (sessionId && !session.data && !session.error) return <PanelLoading />;
  const mine = sessionId && session.data ? new Set(session.data.files.map((p) => p.toLowerCase())) : undefined;
  const files = mine ? status.data.files.filter((f) => mine.has(f.path.toLowerCase())) : status.data.files;
  const commits = mine ? (session.data?.commits ?? []) : [];
  const staged = files.filter((f) => f.group === 'staged');
  const hasChanges = files.length > 0 || commits.length > 0;

  const discard = async (list: GitFile[]) => {
    const ok = await dialogs.confirm({
      title: t('panel.changes.discard'),
      body: list.length === 1 ? list[0]!.path : t('panel.changes.discardMany', { n: list.length }),
      okLabel: t('panel.changes.discard'),
      danger: true,
    });
    if (!ok) return;
    const untracked = list.filter((f) => f.group === 'untracked').map((f) => f.path);
    const tracked = list.filter((f) => f.group !== 'untracked').map((f) => f.path);
    await run('discard', { paths: tracked, untracked });
  };

  const undo = async () => {
    const ok = await dialogs.confirm({ title: t('panel.changes.undo'), body: t('panel.changes.undoBody'), okLabel: t('panel.changes.undo'), danger: true });
    if (ok) await run('undo');
  };

  const commit = (push: boolean) =>
    run('commit', { message, amend, push }, () => {
      setMessage('');
      setAmend(false);
    });

  const newBranch = async () => {
    const name = await dialogs.prompt({ title: t('panel.changes.newBranch'), label: t('panel.changes.branchName') });
    if (name?.trim()) await run('checkout', { branch: name.trim(), create: true });
  };

  const canCommit = !busy && (amend || (message.trim() !== '' && staged.length > 0));

  return (
    <div className="agents-chg">
      {dialogs.element}
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} />}
      <div className="agents-chg-bar">
        <select
          className="agents-chg-branch"
          aria-label={t('panel.changes.branch')}
          value={branch}
          disabled={busy}
          onChange={(e) => void run('checkout', { branch: e.target.value })}
        >
          {(branches.data ?? [{ name: branch, current: true }]).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        <Button size="sm" icon="plus" disabled={busy} onClick={() => void newBranch()}>
          {t('panel.changes.newBranch')}
        </Button>
        <ToolbarSep />
        <span className="agents-chg-sync">{ahead || behind ? `↑${ahead} ↓${behind}` : ''}</span>
        <Button size="sm" icon="download" disabled={busy} onClick={() => void run('pull')}>
          {t('panel.changes.pull')}
        </Button>
        <Button size="sm" icon="arrow-up" disabled={busy} onClick={() => void run('push')}>
          {t('panel.changes.push')}
        </Button>
        <ToolbarSep />
        <Button size="sm" disabled={busy || !hasChanges} onClick={() => void run('stash')}>
          {t('panel.changes.stash')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void run('stash', { pop: true })}>
          {t('panel.changes.pop')}
        </Button>
        <IconButton icon="refresh" label={t('agents.changes.refresh')} onClick={refresh} />
      </div>

      <div className="agents-chg-commit">
        <textarea
          value={message}
          rows={3}
          placeholder={t('panel.changes.message')}
          aria-label={t('panel.changes.message')}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="agents-chg-commit-row">
          <Button variant="primary" size="sm" icon="check" disabled={!canCommit} onClick={() => void commit(false)}>
            {t('panel.changes.commit')}
          </Button>
          <Button size="sm" icon="arrow-up" disabled={!canCommit} onClick={() => void commit(true)}>
            {t('panel.changes.commitPush')}
          </Button>
          <label className="agents-chg-amend">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            {t('panel.changes.amend')}
          </label>
          <Button size="sm" icon="rotate-ccw" disabled={busy} onClick={() => void undo()}>
            {t('panel.changes.undo')}
          </Button>
        </div>
      </div>

      {!hasChanges ? (
        <p className="agents-empty agents-placeholder">{t(mine ? 'panel.changes.sessionClean' : 'agents.changes.clean')}</p>
      ) : (
        <div className="agents-chg-groups">
          {commits.length > 0 && (
            <section className="agents-chg-group">
              <header className="agents-chg-head">
                <span>
                  {t('panel.changes.group.commits')} ({commits.length})
                </span>
              </header>
              <ul className="agents-chg-list">
                {commits.map((c) => (
                  <li
                    key={c.hash}
                    className="agents-chg-file"
                    onContextMenu={(e) =>
                      openMenu(e, [
                        ...(openInGit ? [{ id: 'git', label: t('agents.changes.openGit'), icon: 'git-branch' as const, run: () => openInGit({ project, commit: c.hash }) }] : []),
                        { id: 'hash', label: t('panel.changes.copyHash'), icon: 'copy', run: () => void copyNotify(c.hash) },
                      ])
                    }
                  >
                    <span className="agents-chg-path" title={c.files.join('\n')}>
                      {c.hash.slice(0, 7)} {c.subject}
                    </span>
                    {openInGit && <IconButton size="xs" icon="git-branch" label={t('agents.changes.openGit')} onClick={() => openInGit({ project, commit: c.hash })} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {GROUPS.map(({ group, key }) => {
            const list = files.filter((f) => f.group === group);
            if (list.length === 0) return null;
            return (
              <section key={group} className="agents-chg-group">
                <header className="agents-chg-head">
                  <span>
                    {t(`panel.changes.group.${key}`)} ({list.length})
                  </span>
                  {group === 'staged' ? (
                    <Button size="xs" disabled={busy} onClick={() => void run('unstage', mine ? { paths: list.map((f) => f.path) } : { all: true })}>
                      {t('panel.changes.unstageAll')}
                    </Button>
                  ) : (
                    <>
                      <Button size="xs" icon="plus" disabled={busy} onClick={() => void run('stage', { paths: list.map((f) => f.path) })}>
                        {t('panel.changes.stageAll')}
                      </Button>
                      <Button variant="danger" size="xs" disabled={busy} onClick={() => void discard(list)}>
                        {t('panel.changes.discardAll')}
                      </Button>
                    </>
                  )}
                </header>
                <ul className="agents-chg-list">
                  {list.map((f) => (
                    <li
                      key={`${f.group}:${f.path}`}
                      className="agents-chg-file"
                      onContextMenu={(e) =>
                        openMenu(e, [
                          { id: 'diff', label: t('panel.changes.openDiff'), icon: 'file', run: () => openDiff(api, f) },
                          group === 'staged'
                            ? { id: 'unstage', label: t('panel.changes.unstage'), icon: 'chevron-down', disabled: busy, run: () => void run('unstage', { paths: [f.path] }) }
                            : { id: 'stage', label: t('panel.changes.stage'), icon: 'plus', disabled: busy, run: () => void run('stage', { paths: [f.path] }) },
                          { id: 'path', label: t('panel.changes.copyPath'), icon: 'copy', run: () => void copyNotify(f.path) },
                          ...(group === 'staged' ? [] : (['sep', { id: 'discard', label: t('panel.changes.discard'), icon: 'trash' as const, danger: true, disabled: busy, run: () => void discard([f]) }] as const)),
                        ])
                      }
                    >
                      <button
                        type="button"
                        className="agents-chg-open"
                        title={f.path}
                        onClick={() => openDiff(api, f)}
                      >
                        <span className={`agents-changes-code agents-changes-${f.group}`}>{codeOf(f)}</span>
                        <span className="agents-chg-path">{sectionMode ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path}</span>
                      </button>
                      {group === 'staged' ? (
                        <IconButton size="xs" icon="chevron-down" disabled={busy} label={t('panel.changes.unstage')} onClick={() => void run('unstage', { paths: [f.path] })} />
                      ) : (
                        <>
                          <IconButton size="xs" icon="plus" disabled={busy} label={t('panel.changes.stage')} onClick={() => void run('stage', { paths: [f.path] })} />
                          <IconButton variant="danger" size="xs" icon="trash" disabled={busy} label={t('panel.changes.discard')} onClick={() => void discard([f])} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangesPanel({ project, api, visible, sessionId }: PanelProps) {
  return (
    <div className="agents-panel-changes">
      <ChangesView project={project} api={api} visible={visible} sessionId={sessionId} sectionMode />
    </div>
  );
}

function ChangesSection({ project, api, sessionId }: SectionProps) {
  if (!project) return <p className="agents-empty agents-placeholder">{t('agents.panel.changes.empty')}</p>;
  return <ChangesView project={project} api={api} visible sessionId={sessionId} sectionMode />;
}

export const panel: PanelModule = {
  kind: 'changes',
  titleKey: 'panel.changes.title',
  icon: 'git-branch',
  placement: 'both',
  single: true,
  Panel: ChangesPanel,
  Section: ChangesSection,
};
