import { useMemo, useState } from 'react';
import { Button, Empty, useAsync } from '@kedalion/ui';
import type { AgentFileGit } from '../../protocol';
import { t } from '../../i18n';
import { getFileStatus } from '../api';
import { fmtTokens, lineDiff, type FileEntry } from './model';

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** Path relative to the session cwd when inside it, forward slashes. */
function relPath(file: string, cwd?: string): string {
  const f = file.replace(/\\/g, '/');
  if (!cwd) return f;
  const c = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  return f.toLowerCase().startsWith(`${c.toLowerCase()}/`) ? f.slice(c.length + 1) : f;
}

const dirOf = (rel: string) => {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
};

const GIT_TONE: Record<AgentFileGit, string> = { modified: 'warn', untracked: 'info', added: 'ok', deleted: 'err', committed: 'ok', reverted: 'muted', clean: 'muted', ignored: 'muted', outside: 'muted' };

type Filter = 'all' | 'edited' | 'read' | 'shell';

function Diff({ old, next }: { old: string; next: string }) {
  const lines = useMemo(() => lineDiff(old, next), [old, next]);
  return (
    <pre className="agents-traj-diff">
      {lines.map((l, i) => (
        <span key={i} className={`agents-traj-diff-${l.kind}`}>
          {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
          {l.text}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

const clock = (ts?: number) => (ts === undefined ? '' : new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

function Delta({ f }: { f: FileEntry }) {
  if (f.added === 0 && f.removed === 0) return null;
  return (
    <span className="agents-traj-fdelta">
      <span className="agents-traj-diff-add">+{f.added}</span> <span className="agents-traj-diff-del">−{f.removed}</span>
    </span>
  );
}

/** The files the session read, changed or searched, with the changes of the picked one as diffs. */
export function FilesView({ files, cwd, sessionId, stamp, onGoto }: { files: FileEntry[]; cwd?: string; sessionId?: string; stamp: number; onGoto(i: number): void }) {
  const [file, setFile] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [grouped, setGrouped] = useState(false);
  const git = useAsync(() => (sessionId ? getFileStatus(sessionId) : Promise.resolve(undefined)), [sessionId, stamp], 0);
  const gitOf = (f: FileEntry): AgentFileGit | undefined => git.data?.status[f.file];
  const diskOf = (f: FileEntry) => git.data?.disk?.[f.file];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (q && !f.file.toLowerCase().includes(q)) return false;
      if (filter === 'edited') return f.kind !== 'read';
      if (filter === 'read') return f.kind === 'read';
      if (filter === 'shell') return f.shell.length > 0;
      return true;
    });
  }, [files, query, filter]);
  const groups = useMemo(() => {
    if (!grouped) return [{ dir: '', items: shown }];
    const m = new Map<string, FileEntry[]>();
    for (const f of shown) {
      const d = dirOf(relPath(f.file, cwd));
      m.set(d, [...(m.get(d) ?? []), f]);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([dir, items]) => ({ dir, items }));
  }, [shown, grouped, cwd]);
  if (files.length === 0) return <Empty title={t('panel.trajectory.files.empty')} />;
  const current = shown.find((f) => f.file === file) ?? shown[0];
  const row = (f: FileEntry) => {
    const rel = relPath(f.file, cwd);
    const dir = dirOf(rel);
    const g = gitOf(f);
    return (
      <li key={f.file}>
        <button type="button" className="agents-traj-step agents-traj-file" aria-pressed={f === current} title={f.file} onClick={() => setFile(f.file)}>
          <span className={`agents-traj-kindbadge agents-traj-fk-${f.kind}`}>{t(`panel.trajectory.files.kind.${f.kind}`)}</span>
          <span className="agents-traj-label">
            {baseName(f.file)}
            {!grouped && dir && <span className="agents-traj-dir"> {dir}</span>}
          </span>
          {f.failed > 0 && <span className="agents-traj-fail" title={t('panel.trajectory.files.failed', { n: f.failed })}>✕{f.failed}</span>}
          {f.shell.length > 0 && <span className="agents-traj-meta" title={t('panel.trajectory.files.viaShell')}>⌘{f.shell.length}</span>}
          <Delta f={f} />
          {diskOf(f) && <span className="agents-traj-git agents-traj-git-warn" title={t(`panel.trajectory.files.disk.${diskOf(f)!}.tip`)}>{t(`panel.trajectory.files.disk.${diskOf(f)!}`)}</span>}
          {g && g !== 'clean' && g !== 'outside' && <span className={`agents-traj-git agents-traj-git-${GIT_TONE[g]}`}>{t(`panel.trajectory.files.git.${g}`)}</span>}
          <span className="agents-traj-meta">{f.edits.length > 0 ? `±${f.edits.length}` : `${f.reads}×`}</span>
        </button>
      </li>
    );
  };
  return (
    <div className="agents-traj">
      <div className="agents-traj-filescol">
        <div className="agents-traj-filesbar">
          <input className="agents-traj-fsearch" type="search" value={query} placeholder={t('panel.trajectory.files.search')} aria-label={t('panel.trajectory.files.search')} onChange={(e) => setQuery(e.target.value)} />
          <div className="agents-traj-kinds">
            {(['all', 'edited', 'read', 'shell'] as const).map((k) => (
              <Button key={k} variant="ghost" size="xs" pressed={filter === k} onClick={() => setFilter(k)}>
                {t(`panel.trajectory.files.filter.${k}`)}
              </Button>
            ))}
            <Button variant="ghost" size="xs" pressed={grouped} onClick={() => setGrouped(!grouped)}>
              {t('panel.trajectory.files.group')}
            </Button>
          </div>
        </div>
        <div className="agents-traj-list" aria-label={t('panel.trajectory.files.list')}>
          {shown.length === 0 && <p className="agents-empty">{t('panel.trajectory.files.none')}</p>}
          {groups.map((g) => (
            <div key={g.dir}>
              {grouped && <div className="agents-traj-fgroup">{g.dir || '.'}</div>}
              <ul>{g.items.map(row)}</ul>
            </div>
          ))}
        </div>
      </div>
      <div className="agents-traj-detail agents-traj-files-detail" tabIndex={0}>
        {current && <FileDetail f={current} cwd={cwd} git={gitOf(current)} disk={diskOf(current)} onGoto={onGoto} />}
      </div>
    </div>
  );
}

function FileDetail({ f, cwd, git, disk, onGoto }: { f: FileEntry; cwd?: string; git?: AgentFileGit; disk?: 'changed' | 'missing'; onGoto(i: number): void }) {
  const tokens = Math.round(f.readChars / 4);
  return (
    <>
      <div className="agents-traj-files-head">
        <code title={f.file}>{relPath(f.file, cwd)}</code>
        <span className="agents-traj-meta">{t('panel.trajectory.files.summary', { edits: f.edits.length, reads: f.reads })}</span>
      </div>
      <dl className="agents-traj-metabar">
        <div><dt>{t('panel.trajectory.files.kindLabel')}</dt><dd>{t(`panel.trajectory.files.kind.${f.kind}`)}</dd></div>
        {disk && <div><dt>{t('panel.trajectory.files.diskLabel')}</dt><dd>{t(`panel.trajectory.files.disk.${disk}.tip`)}</dd></div>}
        {git && <div><dt>{t('panel.trajectory.files.gitLabel')}</dt><dd>{t(`panel.trajectory.files.git.${git}`)}</dd></div>}
        {(f.added > 0 || f.removed > 0) && <div><dt>{t('panel.trajectory.files.lines')}</dt><dd><Delta f={f} /></dd></div>}
        {f.failed > 0 && <div><dt>{t('panel.trajectory.files.failedLabel')}</dt><dd>{f.failed}</dd></div>}
        {f.firstTs !== undefined && <div><dt>{t('panel.trajectory.files.touched')}</dt><dd>{clock(f.firstTs)}{f.lastTs !== f.firstTs ? ` – ${clock(f.lastTs)}` : ''}</dd></div>}
        <div><dt>{t('panel.trajectory.files.steps')}</dt><dd>{f.firstI + 1}{f.lastI !== f.firstI ? ` – ${f.lastI + 1}` : ''}</dd></div>
        {f.ranges.length > 0 && <div><dt>{t('panel.trajectory.files.ranges')}</dt><dd>{f.ranges.join(', ')}</dd></div>}
        {tokens > 0 && <div><dt>{t('panel.trajectory.files.readCost')}</dt><dd>~{fmtTokens(tokens)}</dd></div>}
        {f.hits > 0 && <div><dt>{t('panel.trajectory.files.hits')}</dt><dd>{f.hits}×</dd></div>}
      </dl>
      {f.shell.length > 0 && (
        <section className="agents-traj-change">
          <div className="agents-traj-change-head">
            <span>{t('panel.trajectory.files.viaShell')}</span>
          </div>
          <ul className="agents-traj-shelllist">
            {f.shell.map((s, k) => (
              <li key={k}>
                <span>{t(`panel.trajectory.files.op.${s.op}`)}</span>
                <Button variant="ghost" size="xs" onClick={() => onGoto(s.i)}>{t('panel.trajectory.files.goto')}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {f.edits.length === 0 && f.shell.length === 0 && <p className="agents-empty">{t('panel.trajectory.files.noEdits')}</p>}
      {f.edits.map((e, k) => (
        <section key={k} className={`agents-traj-change${e.error ? ' agents-traj-error' : ''}`}>
          <div className="agents-traj-change-head">
            <span>{t('panel.trajectory.files.change', { n: e.i + 1 })}{e.ts !== undefined ? ` · ${clock(e.ts)}` : ''}</span>
            <Button variant="ghost" size="xs" onClick={() => onGoto(e.i)}>{t('panel.trajectory.files.goto')}</Button>
          </div>
          <Diff old={e.old} next={e.new} />
        </section>
      ))}
    </>
  );
}

