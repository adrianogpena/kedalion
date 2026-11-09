import { useState } from 'react';
import { Button, ErrorBanner, errorOf, Icon, IconButton } from '@kedalion/ui';
import { t } from './i18n';
import type { SavedCommand, SavedPath, SidebarData } from './sidebar-types';

export interface TerminalSidebarProps {
  data: SidebarData;
  loading: boolean;
  error?: unknown;
  onChange(next: SidebarData): void;
  /** False when no terminal tab is focused: the rows do nothing. */
  canAct: boolean;
  /** Saves the focused terminal's folder as a path. */
  onAddCwd(): void;
  onCd(path: string): void;
  onPrint(command: string): void;
  onHide(): void;
}

type Kind = 'paths' | 'commands';

const SECTIONS_KEY = 'kedalion.terminal.sidebar.sections';
const readSections = (): Record<Kind, boolean> => {
  try {
    const v = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? 'null') as Partial<Record<Kind, unknown>> | null;
    return { paths: v?.paths !== false, commands: v?.commands !== false };
  } catch {
    return { paths: true, commands: true };
  }
};
const saveSections = (v: Record<Kind, boolean>) => {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(v));
  } catch {
    // no storage: sections start open next time
  }
};

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

interface FormProps {
  kind: Kind;
  initial?: { name: string; value: string };
  onSave(name: string, value: string): void;
  onCancel(): void;
}

function ItemForm({ kind, initial, onSave, onCancel }: FormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [value, setValue] = useState(initial?.value ?? '');
  const ok = value.trim().length > 0;
  const save = () => {
    if (!ok) return;
    const v = value.trim();
    onSave(name.trim() || (kind === 'paths' ? lastSegment(v) : ''), v);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && (kind === 'paths' || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };
  return (
    <div className="term-side-form" onKeyDown={keys}>
      <input autoFocus value={name} placeholder={t('terminalScreen.sidebar.name')} aria-label={t('terminalScreen.sidebar.name')} onChange={(e) => setName(e.target.value)} />
      {kind === 'paths' ? (
        <input value={value} placeholder={t('terminalScreen.sidebar.path')} aria-label={t('terminalScreen.sidebar.path')} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <textarea rows={3} value={value} placeholder={t('terminalScreen.sidebar.command')} aria-label={t('terminalScreen.sidebar.command')} onChange={(e) => setValue(e.target.value)} />
      )}
      <div className="term-side-form-actions">
        <Button size="sm" variant="primary" disabled={!ok} onClick={save}>
          {t('terminalScreen.sidebar.save')}
        </Button>
        <Button size="sm" onClick={onCancel}>
          {t('terminalScreen.sidebar.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function TerminalSidebar({ data, loading, error, onChange, canAct, onAddCwd, onCd, onPrint, onHide }: TerminalSidebarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(readSections);
  /** The form shown: a new item of a kind, or an existing item's id. */
  const [form, setForm] = useState<{ kind: Kind; id?: string }>();
  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((s) => s.toLowerCase().includes(q));

  const toggle = (kind: Kind) =>
    setOpen((o) => {
      const next = { ...o, [kind]: !o[kind] };
      saveSections(next);
      return next;
    });

  const idOf = () => crypto.randomUUID().slice(0, 8);
  const commit = (kind: Kind, id: string | undefined, name: string, value: string) => {
    if (kind === 'paths') {
      const list: SavedPath[] = id
        ? data.paths.map((p) => (p.id === id ? { ...p, name, path: value } : p))
        : [...data.paths, { id: idOf(), name, path: value }];
      onChange({ ...data, paths: list });
    } else {
      const list: SavedCommand[] = id
        ? data.commands.map((c) => (c.id === id ? { ...c, name, command: value } : c))
        : [...data.commands, { id: idOf(), name, command: value }];
      onChange({ ...data, commands: list });
    }
    setForm(undefined);
  };
  const remove = (kind: Kind, id: string) =>
    onChange(kind === 'paths' ? { ...data, paths: data.paths.filter((p) => p.id !== id) } : { ...data, commands: data.commands.filter((c) => c.id !== id) });

  const rows = (kind: Kind) => {
    const items: Array<{ id: string; name: string; value: string }> =
      kind === 'paths' ? data.paths.map((p) => ({ id: p.id, name: p.name, value: p.path })) : data.commands.map((c) => ({ id: c.id, name: c.name, value: c.command }));
    const shown = items.filter((i) => match(i.name, i.value));
    return (
      <>
        {form?.kind === kind && !form.id && <ItemForm kind={kind} onSave={(n, v) => commit(kind, undefined, n, v)} onCancel={() => setForm(undefined)} />}
        {shown.length === 0 && !(form?.kind === kind && !form.id) && (
          <div className="term-side-empty muted">{t(kind === 'paths' ? 'terminalScreen.sidebar.noPaths' : 'terminalScreen.sidebar.noCommands')}</div>
        )}
        <ul className="term-side-list">
          {shown.map((i) =>
            form?.kind === kind && form.id === i.id ? (
              <li key={i.id}>
                <ItemForm kind={kind} initial={{ name: i.name, value: i.value }} onSave={(n, v) => commit(kind, i.id, n, v)} onCancel={() => setForm(undefined)} />
              </li>
            ) : (
              <li key={i.id} className={`term-side-row${canAct ? '' : ' inert'}`}>
                <button
                  type="button"
                  className="term-side-main"
                  title={canAct ? i.value : t('terminalScreen.sidebar.noSession')}
                  aria-disabled={!canAct}
                  onClick={() => canAct && (kind === 'paths' ? onCd(i.value) : onPrint(i.value))}
                >
                  <span className="term-side-name">{i.name || i.value}</span>
                  {i.name && <span className="muted term-side-value">{i.value}</span>}
                </button>
                <span className="term-side-actions">
                  <IconButton icon="edit" size="sm" label={t('terminalScreen.sidebar.edit')} onClick={() => setForm({ kind, id: i.id })} />
                  <IconButton icon="trash" size="sm" label={t('terminalScreen.sidebar.delete')} onClick={() => remove(kind, i.id)} />
                </span>
              </li>
            ),
          )}
        </ul>
      </>
    );
  };

  const section = (kind: Kind, icon: 'folder' | 'terminal') => (
    <section className="term-side-section">
      <div className="term-side-section-head">
        <button type="button" className="term-side-toggle" aria-expanded={open[kind]} onClick={() => toggle(kind)}>
          <Icon name={open[kind] ? 'chevron-down' : 'chevron-up'} />
          <Icon name={icon} />
          <span>{t(kind === 'paths' ? 'terminalScreen.sidebar.paths' : 'terminalScreen.sidebar.commands')}</span>
        </button>
        {kind === 'paths' && <IconButton icon="folder" size="sm" label={t('terminalScreen.sidebar.addCwd')} disabled={!canAct} onClick={onAddCwd} />}
        <IconButton
          icon="plus"
          size="sm"
          label={t('terminalScreen.sidebar.add')}
          onClick={() => {
            if (!open[kind]) toggle(kind);
            setForm({ kind });
          }}
        />
      </div>
      {open[kind] && rows(kind)}
    </section>
  );

  return (
    <div className="term-side">
      <div className="term-side-head">
        <Icon name="search" />
        <input value={query} placeholder={t('terminalScreen.sidebar.search')} aria-label={t('terminalScreen.sidebar.search')} onChange={(e) => setQuery(e.target.value)} />
        <IconButton icon="sidebar" size="sm" label={t('terminalScreen.sidebar.hide')} onClick={onHide} />
      </div>
      {error !== undefined && <ErrorBanner compact error={errorOf(error)} />}
      <div className="term-side-body">{!loading && (<>{section('paths', 'folder')}{section('commands', 'terminal')}</>)}</div>
    </div>
  );
}
