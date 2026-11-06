import { CodeEditor } from '@kedalion/editor';
import { useEffect, useRef, useState } from 'react';
import { getFileRunner } from '../../file-runner';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import './tickets.css';

interface Props {
  ticketId: string;
  kind: 'sql' | 'rest';
  config: Record<string, unknown>;
}

interface TicketFile {
  text: string;
  exists: boolean;
  project: string;
  path: string;
}

const SAVE_DELAY_MS = 600;

/** The ticket's `sql/<KEY>.sql` or `rest/<KEY>.curl`: saved as you type (nothing is created until the first edit), run like in the Explorer. */
export function TicketFileEditor({ ticketId, kind, config }: Props) {
  const [file, setFile] = useState<TicketFile | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const latest = useRef('');
  const saved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const configRef = useRef(config);
  configRef.current = config;

  const flush = async () => {
    clearTimeout(timer.current);
    const value = latest.current;
    const prev = saved.current;
    if (prev === null || value === prev) return;
    saved.current = value;
    try {
      await runAction('tickets', 'file-set', configRef.current, { id: ticketId, kind, text: value });
      setError('');
    } catch (err) {
      if (saved.current === value) saved.current = prev;
      setError(String((err as Error)?.message ?? err));
    }
  };

  useEffect(() => {
    let live = true;
    runAction<TicketFile>('tickets', 'file-get', configRef.current, { id: ticketId, kind })
      .then((f) => {
        if (!live) return;
        latest.current = f.text;
        saved.current = f.text;
        setText(f.text);
        setFile(f);
      })
      .catch((err) => live && setError(String((err as Error)?.message ?? err)));
    return () => {
      live = false;
      void flush();
    };
  }, [ticketId, kind]);

  const change = (value: string) => {
    latest.current = value;
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  if (!file) return error ? <div className="tickets-error" role="alert">{error}</div> : null;
  const Runner = getFileRunner();
  return (
    <div className="tickets-notes">
      {error && <div className="tickets-error" role="alert">{error}</div>}
      {file.project === '' ? (
        <div className="tickets-error" role="alert">{tKey('dash.tickets.notes.noProject')}</div>
      ) : (
        <div className="tickets-notes-editor">
          {Runner ? (
            <Runner project={file.project} path={file.path} value={text} onChange={change} />
          ) : (
            <CodeEditor value={text} lang={kind === 'sql' ? 'sql' : 'shell'} height="100%" wrap onChange={change} />
          )}
        </div>
      )}
    </div>
  );
}
