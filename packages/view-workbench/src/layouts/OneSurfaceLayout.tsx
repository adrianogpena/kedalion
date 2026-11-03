import { type ReactNode, useState } from 'react';
import { Button } from '@kedalion/ui';
import './one-surface.css';

export interface OneSurfaceLayoutProps {
  dialogs: ReactNode;
  /** Existing toolbar row (source, run, transactions, panels, export). */
  bar: ReactNode;
  banners: ReactNode;
  schema: ReactNode;
  /** Today's editor/results split. */
  split: ReactNode;
  steps: ReactNode;
  history: ReactNode;
  managing: ReactNode;
  sources: { id: string; label: string }[];
  source: string;
  onSource: (id: string) => void;
  onRun: () => void;
  busy: boolean;
}

/** Workbench A: one surface, a thin line of source chips and Run, the full toolbar behind "Tools". */
export function OneSurfaceLayout(p: OneSurfaceLayoutProps) {
  const [tools, setTools] = useState(false);
  return (
    <div className="content dzw-a">
      {p.dialogs}
      <div className="dzw-line">
        <div className="dzw-chips">
          {p.sources.map((s) => (
            <Button key={s.id} size="sm" variant="ghost" pressed={s.id === p.source} onClick={() => p.onSource(s.id)} title={s.label}>{s.label}</Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" icon="more" pressed={tools} onClick={() => setTools((v) => !v)} title="All tools">Tools</Button>
        <Button size="sm" variant="primary" icon="play" onClick={p.onRun} disabled={p.busy}>Run</Button>
      </div>
      {tools && <div className="dzw-tools">{p.bar}</div>}
      {p.banners}
      <div className="wb-body">
        {p.schema}
        {p.split}
        {p.steps}
        {p.history}
      </div>
      {p.managing}
    </div>
  );
}
