import { CodeEditor } from '@kedalion/editor';
import { Button, IconButton, Modal, TextField } from '@kedalion/ui';
import { useState } from 'react';
import { tKey } from '../../i18n';
import type { NoteTemplate } from './note-templates';

interface Props {
  templates: NoteTemplate[];
  onSave(templates: NoteTemplate[]): Promise<void>;
  onClose(): void;
}

/** Creates, edits and deletes the note templates; nothing is saved until Save. */
export function NoteTemplatesDialog({ templates, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<NoteTemplate[]>(templates);
  const [selected, setSelected] = useState(templates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = draft.find((t) => t.id === selected);

  const patch = (id: string, change: Partial<NoteTemplate>) => setDraft((d) => d.map((t) => (t.id === id ? { ...t, ...change } : t)));

  const add = () => {
    const id = `t${Date.now().toString(36)}`;
    setDraft((d) => [...d, { id, name: tKey('dash.tickets.templates.newName'), body: '' }]);
    setSelected(id);
  };

  const remove = (id: string) => {
    const rest = draft.filter((t) => t.id !== id);
    setDraft(rest);
    if (selected === id) setSelected(rest[0]?.id ?? '');
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft.filter((t) => t.name.trim()));
      onClose();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={tKey('dash.tickets.templates.title')}
      onClose={onClose}
      large
      footer={
        <>
          <Button onClick={onClose}>{tKey('dash.tickets.templates.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{tKey('dash.tickets.templates.save')}</Button>
        </>
      }
    >
      <div className="tickets-tpl">
        <div className="tickets-tpl-list">
          {draft.map((t) => (
            <div key={t.id} className={`tickets-tpl-item${t.id === selected ? ' on' : ''}`}>
              <button type="button" className="tickets-tpl-pick" onClick={() => setSelected(t.id)}>{t.name || '…'}</button>
              <IconButton icon="trash" size="xs" label={tKey('dash.tickets.templates.delete')} onClick={() => remove(t.id)} />
            </div>
          ))}
          <Button size="sm" icon="plus" onClick={add}>{tKey('dash.tickets.templates.add')}</Button>
        </div>
        <div className="tickets-tpl-edit">
          {error && <div className="tickets-error" role="alert">{error}</div>}
          {current ? (
            <>
              <TextField label={tKey('dash.tickets.templates.name')} value={current.name} onChange={(name) => patch(current.id, { name })} />
              <div className="tickets-tpl-hint">{tKey('dash.tickets.templates.hint')}</div>
              <div className="tickets-tpl-body">
                <CodeEditor key={current.id} value={current.body} lang="markdown" height="100%" wrap onChange={(body) => patch(current.id, { body })} />
              </div>
            </>
          ) : (
            <div className="tickets-tpl-hint">{tKey('dash.tickets.templates.empty')}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
