import { useMemo, useState } from 'react';
import { Button, Empty } from '@kedalion/ui';
import { t } from '../../i18n';
import { lineDiff, type FileEntry } from './model';

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

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

/** The files the session read or changed, with the changes of the picked one as diffs. */
export function FilesView({ files, onGoto }: { files: FileEntry[]; onGoto(i: number): void }) {
  const [file, setFile] = useState<string>();
  if (files.length === 0) return <Empty title={t('panel.trajectory.files.empty')} />;
  const current = files.find((f) => f.file === file) ?? files[0]!;
  return (
    <div className="agents-traj">
      <ul className="agents-traj-list" aria-label={t('panel.trajectory.files.list')}>
        {files.map((f) => (
          <li key={f.file}>
            <button type="button" className="agents-traj-step agents-traj-file" aria-pressed={f === current} title={f.file} onClick={() => setFile(f.file)}>
              <span className="agents-traj-label">{baseName(f.file)}</span>
              <span className="agents-traj-meta">{f.edits.length > 0 ? `±${f.edits.length}` : `${f.reads}×`}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="agents-traj-detail agents-traj-files-detail" tabIndex={0}>
        <div className="agents-traj-files-head">
          <code title={current.file}>{current.file}</code>
          <span className="agents-traj-meta">{t('panel.trajectory.files.summary', { edits: current.edits.length, reads: current.reads })}</span>
        </div>
        {current.edits.length === 0 && <p className="agents-empty">{t('panel.trajectory.files.noEdits')}</p>}
        {current.edits.map((e, k) => (
          <section key={k} className={`agents-traj-change${e.error ? ' agents-traj-error' : ''}`}>
            <div className="agents-traj-change-head">
              <span>{t('panel.trajectory.files.change', { n: e.i + 1 })}</span>
              <Button variant="ghost" size="xs" onClick={() => onGoto(e.i)}>{t('panel.trajectory.files.goto')}</Button>
            </div>
            <Diff old={e.old} next={e.new} />
          </section>
        ))}
      </div>
    </div>
  );
}
