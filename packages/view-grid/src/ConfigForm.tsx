import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Button, IconButton, MAX_TEXT_FIELD, Modal, OnOffField, validConfig, type PanelConfig, type PanelField } from '@kedalion/ui';
import { ConnectionDialog, listConnections, type ConnectionType, type PublicConnection } from './connections/ConnectionDialog';
import { FolderField } from './FolderField';
import { tKey } from './i18n';
import { opmlUrls } from './panels/feeds/opml';
import { feedUrls } from './panels/feeds/rss';

function NumberInput({ field, value, onChange }: { field: Extract<PanelField, { kind: 'number' }>; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText((prev) => (Number(prev) === value ? prev : String(value))), [value]);
  return (
    <input
      type="number"
      value={text}
      min={field.min}
      max={field.max}
      aria-label={tKey(field.label)}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

const MAX_IMPORTED_FEEDS = 10;

function TextField({ field, value, hint, onChange }: { field: Extract<PanelField, { kind: 'text' }>; value: string; hint?: string; onChange: (value: string) => void }) {
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const importOpml = async (file: File) => {
    const found = opmlUrls(await file.text());
    const have = feedUrls(value, Infinity);
    const added = found.filter((u) => !have.includes(u)).slice(0, Math.max(0, MAX_IMPORTED_FEEDS - have.length));
    if (found.length === 0) return setStatus(tKey('grid.field.importOpml.none'));
    if (added.length > 0) onChange([value.trimEnd(), ...added].filter(Boolean).join('\n'));
    setStatus(tKey('grid.field.importOpml.done', { added: added.length, found: found.length }));
  };
  return (
    <div className="field">
      <label className="field">
        <span className="mono-label">{tKey(field.label)}</span>
        <textarea
          value={value}
          rows={field.rows ?? 4}
          placeholder={field.placeholder ? tKey(field.placeholder) : undefined}
          maxLength={field.maxLength ?? MAX_TEXT_FIELD}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        {hint && <span className="muted">{hint}</span>}
      </label>
      {field.importOpml && (
        <span className="grid-config-import">
          <input
            ref={fileInput}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importOpml(file);
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>{tKey('grid.field.importOpml')}</Button>
          {status && <span className="muted">{status}</span>}
        </span>
      )}
    </div>
  );
}

const NEW_CONNECTION = 'new:connection';

interface Connections {
  list: PublicConnection[];
  /** Opens the edit dialog for a new connection of `type`; `done` gets the stored one. */
  create(type: ConnectionType, done: (c: PublicConnection) => void): void;
}

function FieldRow({ field, value, onChange, connections }: { field: PanelField; value: unknown; onChange: (value: unknown) => void; connections: Connections }) {
  const hint = field.description ? tKey(field.description) : undefined;
  switch (field.kind) {
    case 'connection': {
      const id = typeof value === 'string' ? value : field.default;
      const matching = connections.list.filter((c) => c.type === field.connectionType);
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <select
            value={id}
            onChange={(e) => {
              if (e.target.value === NEW_CONNECTION) connections.create(field.connectionType, (c) => onChange(c.id));
              else onChange(e.target.value);
            }}
          >
            <option value="">{tKey('conn.pick')}</option>
            {id !== '' && !matching.some((c) => c.id === id) && <option value={id}>{id}</option>}
            {matching.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value={NEW_CONNECTION}>{tKey('conn.new')}</option>
          </select>
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    }
    case 'folder':
      return <FolderField label={tKey(field.label)} hint={hint} value={typeof value === 'string' ? value : field.default} onChange={onChange} />;
    case 'boolean':
      return <OnOffField label={tKey(field.label)} hint={hint} value={value === true} onChange={onChange} />;
    case 'number':
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <NumberInput field={field} value={typeof value === 'number' ? value : field.default} onChange={onChange} />
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    case 'string':
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <input
            type={field.secret ? 'password' : undefined}
            autoComplete={field.secret ? 'off' : undefined}
            value={typeof value === 'string' ? value : field.default}
            placeholder={field.placeholder ? tKey(field.placeholder) : undefined}
            maxLength={field.maxLength}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    case 'enum':
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <select value={String(value)} onChange={(e) => onChange(field.values.find((v) => String(v) === e.target.value) ?? field.default)}>
            {field.values.map((v) => (
              <option key={String(v)} value={String(v)}>{field.optionLabel ? tKey(`${field.optionLabel}.${v}`) : String(v)}</option>
            ))}
          </select>
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    case 'multi': {
      const picked = Array.isArray(value) ? (value as unknown[]) : field.default;
      return (
        <fieldset className="field grid-config-multi">
          <legend className="mono-label">{tKey(field.label)}</legend>
          {field.values.map((v) => (
            <label key={v} className="grid-config-check">
              <input
                type="checkbox"
                checked={picked.includes(v)}
                onChange={(e) => onChange(field.values.filter((x) => (x === v ? e.target.checked : picked.includes(x))))}
              />
              <span>{field.optionLabel ? tKey(`${field.optionLabel}.${v}`) : v}</span>
            </label>
          ))}
          {hint && <span className="muted">{hint}</span>}
        </fieldset>
      );
    }
    case 'text':
      return <TextField field={field} value={typeof value === 'string' ? value : field.default} hint={hint} onChange={onChange} />;
    case 'date': {
      const date = typeof value === 'string' ? value : field.default;
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <span className="grid-config-date">
            <input type="date" value={date} onChange={(e) => onChange(e.target.value)} />
            <IconButton icon="close" label={tKey('grid.field.clearDate')} disabled={date === ''} onClick={() => onChange('')} />
          </span>
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    }
  }
}

/** A form generated from the fields of a panel kind. */
export function ConfigForm({ fields, value, onChange }: { fields: readonly PanelField[]; value: PanelConfig; onChange: (value: PanelConfig) => void }) {
  const [list, setList] = useState<PublicConnection[]>([]);
  const [creating, setCreating] = useState<{ type: ConnectionType; done: (c: PublicConnection) => void }>();
  const needsConnections = fields.some((f) => f.kind === 'connection');
  useEffect(() => {
    if (!needsConnections) return;
    let live = true;
    listConnections().then((l) => live && setList(l), () => {});
    return () => {
      live = false;
    };
  }, [needsConnections]);
  const connections: Connections = { list, create: (type, done) => setCreating({ type, done }) };
  return (
    <div className="grid-config-form">
      {fields.filter((f) => !f.hidden).map((f) => (
        <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} connections={connections} />
      ))}
      {creating && (
        <ConnectionDialog
          type={creating.type}
          onSaved={(c) => {
            setList((l) => [...l.filter((x) => x.id !== c.id), c]);
            creating.done(c);
          }}
          onClose={() => setCreating(undefined)}
        />
      )}
    </div>
  );
}

/** Dialog to edit the config of one panel instance; saving gives the cleaned config. */
export function ConfigDialog({ name, fields, editor: Editor, value, onSave, onClose }: {
  name: string;
  fields: readonly PanelField[];
  /** The kind's `configEditor`, shown instead of the fields form. */
  editor?: ComponentType<{ value: PanelConfig; onChange(next: PanelConfig): void }>;
  value: PanelConfig;
  onSave: (config: PanelConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => validConfig(fields, value));
  const save = () => {
    onSave(validConfig(fields, draft));
    onClose();
  };
  return (
    <Modal
      title={tKey('grid.configure.title', { name })}
      onClose={onClose}
      footer={
        <>
          <Button title={tKey('grid.cancel')} onClick={onClose}>{tKey('grid.cancel')}</Button>
          <Button variant="primary" title={tKey('grid.apply')} onClick={save}>{tKey('grid.apply')}</Button>
        </>
      }
    >
      {Editor ? <Editor value={draft} onChange={setDraft} /> : <ConfigForm fields={fields} value={draft} onChange={setDraft} />}
    </Modal>
  );
}
