import { CodeEditor } from '@kedalion/editor';
import { Button, IconButton } from '@kedalion/ui';
import { useEffect, useRef, useState } from 'react';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { applyTemplate, type NoteTemplate, type TemplateVars } from './note-templates';
import { NoteTemplatesDialog } from './NoteTemplatesDialog';
import './tickets.css';

interface Props {
  ticketId: string;
  config: Record<string, unknown>;
  vars: TemplateVars;
}

const SAVE_DELAY_MS = 600;

/** The ticket's notes in the side panel: always markdown source, saved as you type. */
export function TicketNotes({ ticketId, config, vars }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [managing, setManaging] = useState(false);
  const [empty, setEmpty] = useState(false);
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
      await runAction('tickets', 'notes-set', configRef.current, { id: ticketId, text: value });
      setError('');
    } catch (err) {
      if (saved.current === value) saved.current = prev;
      setError(String((err as Error)?.message ?? err));
    }
  };

  useEffect(() => {
    let live = true;
    runAction<string>('tickets', 'notes-get', configRef.current, { id: ticketId })
      .then((value) => {
        if (!live) return;
        latest.current = value;
        saved.current = value;
        setText(value);
        setEmpty(value.trim() === '');
      })
      .catch((err) => live && setError(String((err as Error)?.message ?? err)));
    return () => {
      live = false;
      void flush();
    };
  }, [ticketId]);

  useEffect(() => {
    let live = true;
    runAction<NoteTemplate[]>('tickets', 'templates-get', configRef.current, {})
      .then((list) => live && setTemplates(list))
      .catch((err) => live && setError(String((err as Error)?.message ?? err)));
    return () => {
      live = false;
    };
  }, []);

  const change = (value: string) => {
    latest.current = value;
    setEmpty(value.trim() === '');
    if (saved.current === null) saved.current = '';
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  if (text === null) return error ? <div className="tickets-error" role="alert">{error}</div> : null;
  return (
    <div className="tickets-notes">
      <div className="tickets-notes-bar">
        {empty &&
          templates.map((t) => (
            <Button
              key={t.id}
              size="xs"
              onClick={() => {
                const value = applyTemplate(t.body, vars);
                setText(value);
                change(value);
              }}
            >
              {t.name}
            </Button>
          ))}
        <IconButton className="tickets-notes-manage" icon="edit" size="xs" label={tKey('dash.tickets.templates.manage')} onClick={() => setManaging(true)} />
      </div>
      {error && <div className="tickets-error" role="alert">{error}</div>}
      <div className="tickets-notes-editor">
        <CodeEditor value={text} lang="markdown" height="100%" wrap onChange={change} />
      </div>
      {managing && (
        <NoteTemplatesDialog
          templates={templates}
          onClose={() => setManaging(false)}
          onSave={async (list) => setTemplates(await runAction<NoteTemplate[]>('tickets', 'templates-set', configRef.current, { templates: list }))}
        />
      )}
    </div>
  );
}
