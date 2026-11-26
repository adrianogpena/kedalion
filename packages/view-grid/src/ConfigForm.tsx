import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Button, IconButton, labelList, MAX_TEXT_FIELD, Modal, OnOffField, validConfig, type FieldColumn, type FieldSuggest, type PanelConfig, type PanelField, type SuggestOption } from '@kedalion/ui';
import { ConnectionDialog, listConnections, type ConnectionType, type PublicConnection } from './connections/ConnectionDialog';
import { AnyFolderDialog, FolderField, ProjectFolderDialog } from './FolderField';
import { isHttpUrl, joinColumns, splitColumns } from './columns';
import { tKey } from './i18n';
import { fetchSource } from './source';
import { opmlUrls } from './panels/feeds/opml';
import { feedUrls } from './panels/feeds/rss';
import { parseDated } from './panels/calendar/dates';
import { parseTrack } from './panels/feeds/fx';

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

/** The options of `suggest`: its fixed ones, or what its data source returns for the `params` of `config`. */
function useSuggestions(suggest: FieldSuggest | undefined, config: PanelConfig): SuggestOption[] {
  const [fetched, setFetched] = useState<SuggestOption[]>([]);
  const source = suggest?.source;
  const sent = Object.fromEntries((suggest?.params ?? []).map((k) => [k, config[k]]));
  const sig = JSON.stringify(sent);
  useEffect(() => {
    if (!source) return;
    const ctl = new AbortController();
    fetchSource<{ options: SuggestOption[] }>(source, JSON.parse(sig), ctl.signal).then((r) => setFetched(r.options), () => setFetched([]));
    return () => ctl.abort();
  }, [source, sig]);
  return [...(suggest?.options ?? []), ...fetched];
}

let datalistIds = 0;

/** A `<datalist>` of `options` (hidden); `id` is the input's `list`. */
function Datalist({ id, options }: { id: string; options: readonly SuggestOption[] }) {
  return (
    <datalist id={id}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label && o.label !== o.value ? o.label : undefined}</option>
      ))}
    </datalist>
  );
}

/** One row per line of a text field: an input (with optional suggestions), or folders chosen with the project dialog. */
function LineListField({ field, value, config, hint, onChange }: { field: Extract<PanelField, { kind: 'text' }>; value: string; config: PanelConfig; hint?: string; onChange: (value: string) => void }) {
  const nextId = useRef(0);
  const listId = useRef(`grid-suggest-${datalistIds++}`);
  const lines = (v: string) => v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const [rows, setRows] = useState(() => lines(value).map((text) => ({ id: nextId.current++, text })));
  const [picking, setPicking] = useState(false);
  const options = useSuggestions(field.suggest, config);
  const commit = (next: typeof rows) => {
    setRows(next);
    onChange(next.map((r) => r.text.trim()).filter(Boolean).join('\n'));
  };
  const folder = field.list === 'folder';
  const Dialog = field.anyFolder ? AnyFolderDialog : ProjectFolderDialog;
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const importOpml = async (file: File) => {
    const found = opmlUrls(await file.text());
    const have = rows.map((r) => r.text.trim()).filter(Boolean);
    const added = found.filter((u) => !have.includes(u)).slice(0, Math.max(0, MAX_IMPORTED_FEEDS - have.length));
    if (found.length === 0) return setStatus(tKey('grid.field.importOpml.none'));
    if (added.length > 0) commit([...rows.filter((r) => r.text.trim()), ...added.map((text) => ({ id: nextId.current++, text }))]);
    setStatus(tKey('grid.field.importOpml.done', { added: added.length, found: found.length }));
  };
  return (
    <fieldset className="field">
      <legend className="mono-label">{tKey(field.label)}</legend>
      {options.length > 0 && <Datalist id={listId.current} options={options} />}
      {rows.map((r) => (
        <span key={r.id} className="grid-config-date">
          <input
            type={field.list === 'url' ? 'url' : undefined}
            value={r.text}
            readOnly={folder}
            list={options.length > 0 ? listId.current : undefined}
            placeholder={field.placeholder ? tKey(field.placeholder) : undefined}
            aria-label={tKey(field.label)}
            spellCheck={false}
            onChange={(e) => commit(rows.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
          />
          <IconButton icon="close" label={tKey('grid.field.list.remove')} onClick={() => commit(rows.filter((x) => x.id !== r.id))} />
        </span>
      ))}
      <span className="grid-config-import">
        <Button onClick={() => (folder ? setPicking(true) : setRows([...rows, { id: nextId.current++, text: '' }]))}>{tKey(folder ? 'grid.field.list.addFolder' : 'grid.field.list.add')}</Button>
        {field.importOpml && (
          <>
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
          </>
        )}
      </span>
      {hint && <span className="muted">{hint}</span>}
      {picking && (
        <Dialog
          onPick={(path) => {
            setPicking(false);
            if (!rows.some((r) => r.text === path)) commit([...rows, { id: nextId.current++, text: path }]);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </fieldset>
  );
}

/** One input of a `columns` row, with the suggestions of its column. */
function ColumnInput({ column, value, config, onChange }: { column: FieldColumn; value: string; config: PanelConfig; onChange: (value: string) => void }) {
  const listId = useRef(`grid-suggest-${datalistIds++}`);
  const options = useSuggestions(column.suggest, config);
  return (
    <>
      <input
        value={value}
        list={options.length > 0 ? listId.current : undefined}
        placeholder={column.placeholder ? tKey(column.placeholder) : tKey(column.label)}
        aria-label={tKey(column.label)}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {options.length > 0 && <Datalist id={listId.current} options={options} />}
    </>
  );
}

/** Rows of one input per column over the lines of a text field (cells joined by `join`, rows by `separator`). */
function ColumnsListField({ field, value, config, hint, onChange }: { field: Extract<PanelField, { kind: 'text' }>; value: string; config: PanelConfig; hint?: string; onChange: (value: string) => void }) {
  const columns = field.columns ?? [];
  const format = { join: field.join, separator: field.separator };
  const nextId = useRef(0);
  const [rows, setRows] = useState(() => splitColumns(value, columns.length, format).map((cells) => ({ id: nextId.current++, cells })));
  const commit = (next: typeof rows) => {
    setRows(next);
    onChange(joinColumns(next.map((r) => r.cells), format));
  };
  return (
    <fieldset className="field">
      <legend className="mono-label">{tKey(field.label)}</legend>
      {rows.map((r) => (
        <span key={r.id} className="grid-config-date">
          {columns.map((c, i) => (
            <ColumnInput
              key={i}
              column={c}
              value={r.cells[i] ?? ''}
              config={config}
              onChange={(v) => commit(rows.map((x) => (x.id === r.id ? { ...x, cells: x.cells.map((cell, j) => (j === i ? v : cell)) } : x)))}
            />
          ))}
          <IconButton icon="close" label={tKey('grid.field.list.remove')} onClick={() => commit(rows.filter((x) => x.id !== r.id))} />
        </span>
      ))}
      <span className="grid-config-import">
        <Button onClick={() => setRows([...rows, { id: nextId.current++, cells: columns.map(() => '') }])}>{tKey('grid.field.list.add')}</Button>
      </span>
      {hint && <span className="muted">{hint}</span>}
    </fieldset>
  );
}

/** A single-line input that offers `suggest` values. */
function SuggestInput({ field, value, config, hint, onChange }: { field: Extract<PanelField, { kind: 'string' }>; value: string; config: PanelConfig; hint?: string; onChange: (value: string) => void }) {
  const listId = useRef(`grid-suggest-${datalistIds++}`);
  const options = useSuggestions(field.suggest, config);
  return (
    <label className="field">
      <span className="mono-label">{tKey(field.label)}</span>
      <input
        value={value}
        list={options.length > 0 ? listId.current : undefined}
        placeholder={field.placeholder ? tKey(field.placeholder) : undefined}
        maxLength={field.maxLength}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {options.length > 0 && <Datalist id={listId.current} options={options} />}
      <UrlError field={field} value={value} />
      {hint && <span className="muted">{hint}</span>}
    </label>
  );
}

/** The error line of a `validate: 'http-url'` string field with a value that is not an http(s) URL. */
function UrlError({ field, value }: { field: Extract<PanelField, { kind: 'string' }>; value: string }) {
  if (field.validate !== 'http-url' || value.trim() === '' || isHttpUrl(value)) return null;
  return <span role="alert" className="muted">{tKey('grid.field.invalidUrl')}</span>;
}

const MAX_IMPORTED_FEEDS = 10;

interface DatedRow { id: number; label: string; date: string }

/** Rows of a label and a date picker over the `YYYY-MM-DD | label` lines of a text field. */
function DatedListField({ field, value, hint, onChange }: { field: Extract<PanelField, { kind: 'text' }>; value: string; hint?: string; onChange: (value: string) => void }) {
  const nextId = useRef(0);
  const [rows, setRows] = useState<DatedRow[]>(() =>
    parseDated(value).map((d) => ({ id: nextId.current++, ...d })),
  );
  const commit = (next: DatedRow[]) => {
    setRows(next);
    onChange(next.filter((r) => r.date !== '').map((r) => (r.label.trim() ? `${r.date} | ${r.label.replace(/[\r\n|]+/g, ' ').trim()}` : r.date)).join('\n'));
  };
  const patch = (id: number, p: Partial<DatedRow>) => commit(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <fieldset className="field">
      <legend className="mono-label">{tKey(field.label)}</legend>
      {rows.map((r) => (
        <span key={r.id} className="grid-config-date">
          <input
            value={r.label}
            placeholder={tKey('grid.field.dated.label')}
            aria-label={tKey('grid.field.dated.label')}
            spellCheck={false}
            onChange={(e) => patch(r.id, { label: e.target.value })}
          />
          <input type="date" value={r.date} aria-label={tKey('grid.field.dated.date')} onChange={(e) => patch(r.id, { date: e.target.value })} />
          <IconButton icon="close" label={tKey('grid.field.dated.remove')} onClick={() => commit(rows.filter((x) => x.id !== r.id))} />
        </span>
      ))}
      <span className="grid-config-import">
        <Button onClick={() => setRows([...rows, { id: nextId.current++, label: '', date: '' }])}>{tKey('grid.field.dated.add')}</Button>
      </span>
      {hint && <span className="muted">{hint}</span>}
    </fieldset>
  );
}

/** A select of the numbers in `suggest` (value = number as text, label = name); 0 is "none". A saved number not in the list stays selectable. */
function NumberPick({ field, value, config, hint, onChange }: { field: Extract<PanelField, { kind: 'number' }>; value: number; config: PanelConfig; hint?: string; onChange: (value: number) => void }) {
  const options = useSuggestions(field.suggest, config);
  const known = value === 0 || options.some((o) => Number(o.value) === value);
  return (
    <label className="field">
      <span className="mono-label">{tKey(field.label)}</span>
      <select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="0">{tKey('grid.field.pick.none')}</option>
        {!known && <option value={String(value)}>{String(value)}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
        ))}
      </select>
      {hint && <span className="muted">{hint}</span>}
    </label>
  );
}

function TextField({ field, value, config, hint, onChange }: { field: Extract<PanelField, { kind: 'text' }>; value: string; config: PanelConfig; hint?: string; onChange: (value: string) => void }) {
  const [status, setStatus] = useState('');
  const presets = useSuggestions(field.presets, config);
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
        {presets.length > 0 && (
          <select value="" aria-label={tKey('grid.field.preset')} onChange={(e) => e.target.value && onChange(e.target.value)}>
            <option value="">{tKey('grid.field.preset')}</option>
            {presets.map((o) => (
              <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
            ))}
          </select>
        )}
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

function LabelField({ field, value, hint, connection, onChange }: { field: Extract<PanelField, { kind: 'label' }>; value: string[]; hint?: string; connection: string; onChange: (value: string[]) => void }) {
  const [labels, setLabels] = useState<string[] | undefined>();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (!open) return;
    setLabels(undefined);
    if (!connection) return setLabels([]);
    const ctl = new AbortController();
    fetchSource<{ labels: string[] }>('github-labels', { connection }, ctl.signal).then((r) => setLabels(r.labels), () => setLabels([]));
    return () => ctl.abort();
  }, [open, connection]);
  const toggle = (l: string, on: boolean) => onChange(on ? [...value, l] : value.filter((x) => x !== l));
  const all = [...new Set([...(labels ?? []), ...value])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const needle = filter.trim().toLowerCase();
  const shown = all.filter((l) => l.toLowerCase().includes(needle));
  return (
    <div className="field grid-config-labels">
      <span className="mono-label">{tKey(field.label)}</span>
      <span className="grid-config-label-box">
        <span className="grid-config-label-chips">
          {value.map((l) => (
            <span key={l} className="grid-config-label-chip">
              {l}
              <IconButton icon="close" size="xs" label={tKey('grid.field.label.remove', { label: l })} onClick={() => toggle(l, false)} />
            </span>
          ))}
        </span>
        <IconButton icon="plus" label={tKey('grid.field.label.add')} pressed={open} onClick={() => setOpen((o) => !o)} />
      </span>
      {open && (
        <Modal
          title={tKey('grid.field.label.add')}
          onClose={() => setOpen(false)}
          footer={<Button variant="primary" onClick={() => setOpen(false)}>{tKey('grid.field.label.done')}</Button>}
        >
          <div className="grid-config-label-popup">
            <input autoFocus value={filter} placeholder={tKey('grid.field.label.filter')} aria-label={tKey('grid.field.label.filter')} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
            <div className="grid-config-label-list">
              {labels === undefined && <span className="muted">{tKey('grid.field.label.loading')}</span>}
              {labels !== undefined && shown.length === 0 && <span className="muted">{tKey('grid.field.label.none')}</span>}
              {shown.map((l) => (
                <label key={l} className="grid-config-check">
                  <input type="checkbox" checked={value.includes(l)} onChange={(e) => toggle(l, e.target.checked)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

const NEW_CONNECTION = 'new:connection';

interface Connections {
  list: PublicConnection[];
  /** Opens the edit dialog for a new connection of `type`; `done` gets the stored one. */
  create(type: ConnectionType, done: (c: PublicConnection) => void): void;
}

function FieldRow({ field, value, config, onChange, connections }: { field: PanelField; value: unknown; config: PanelConfig; onChange: (value: unknown) => void; connections: Connections }) {
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
    case 'label': {
      const conn = config[field.connectionKey ?? 'connection'];
      return <LabelField field={field} value={Array.isArray(value) || typeof value === 'string' ? labelList(value) : field.default} hint={hint} connection={typeof conn === 'string' ? conn : ''} onChange={onChange} />;
    }
    case 'folder':
      return <FolderField label={tKey(field.label)} hint={hint} value={typeof value === 'string' ? value : field.default} onChange={onChange} />;
    case 'boolean':
      return <OnOffField label={tKey(field.label)} hint={hint} value={value === true} onChange={onChange} />;
    case 'number':
      if (field.suggest) return <NumberPick field={field} value={typeof value === 'number' ? value : field.default} config={config} hint={hint} onChange={onChange} />;
      return (
        <label className="field">
          <span className="mono-label">{tKey(field.label)}</span>
          <NumberInput field={field} value={typeof value === 'number' ? value : field.default} onChange={onChange} />
          {hint && <span className="muted">{hint}</span>}
        </label>
      );
    case 'string':
      if (field.suggest) return <SuggestInput field={field} value={typeof value === 'string' ? value : field.default} config={config} hint={hint} onChange={onChange} />;
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
          <UrlError field={field} value={typeof value === 'string' ? value : field.default} />
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
      if (field.list === 'columns' && field.columns?.length) return <ColumnsListField field={field} value={typeof value === 'string' ? value : field.default} config={config} hint={hint} onChange={onChange} />;
      if (field.list) return <LineListField field={field} value={typeof value === 'string' ? value : field.default} config={config} hint={hint} onChange={onChange} />;
      if (field.dated) return <DatedListField field={field} value={typeof value === 'string' ? value : field.default} hint={hint} onChange={onChange} />;
      return <TextField field={field} value={typeof value === 'string' ? value : field.default} config={config} hint={hint} onChange={onChange} />;
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

const PINNED_PAIR = 'EUR>BRL';

/** The value of a `withPair` field: the stored pair and the listed ones, EUR>BRL first. */
function pairValue(field: PanelField, config: PanelConfig): string | undefined {
  if (field.kind !== 'text' || !field.withPair) return undefined;
  const [b, q] = field.withPair;
  const main = `${String(config[b] ?? '')}>${String(config[q] ?? '')}`;
  const all = [main, ...parseTrack(typeof config[field.key] === 'string' ? (config[field.key] as string) : '', main).map((p) => `${p.base}>${p.quote}`)];
  return (all.includes(PINNED_PAIR) ? [PINNED_PAIR, ...all.filter((x) => x !== PINNED_PAIR)] : all).join(', ');
}

/** `config` after the list of a `withPair` field became `list`: the shown pair stays while listed. */
function pairChange(keys: readonly [string, string], key: string, config: PanelConfig, list: string): PanelConfig {
  const [b, q] = keys;
  const pairs = parseTrack(list, '').map((p) => `${p.base}>${p.quote}`);
  const main = `${String(config[b] ?? '')}>${String(config[q] ?? '')}`;
  const shown = pairs.includes(main) || pairs.length === 0 ? main : pairs[0]!;
  const [base, quote] = shown.split('>');
  return { ...config, [b]: base, [q]: quote, [key]: pairs.filter((p) => p !== shown).join(', ') };
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
        <FieldRow key={f.key} field={f} value={pairValue(f, value) ?? value[f.key]} config={value} onChange={(v) => onChange(f.kind === 'text' && f.withPair && typeof v === 'string' ? pairChange(f.withPair, f.key, value, v) : { ...value, [f.key]: v })} connections={connections} />
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
