import { useEffect, useState } from 'react';
import { Button, ErrorBanner, errorOf, Icon, IconButton } from '@kedalion/ui';
import { t } from './i18n';
import { postExists } from './sidebar-api';
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
interface SectionState {
  open: Record<Kind, boolean>;
  /** Collapsed group headings, as `kind:group`. */
  collapsed: string[];
}
const readSections = (): SectionState => {
  try {
    const v = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? 'null') as (Partial<Record<Kind, unknown>> & { collapsed?: unknown }) | null;
    const collapsed = Array.isArray(v?.collapsed) ? v.collapsed.filter((s): s is string => typeof s === 'string') : [];
    return { open: { paths: v?.paths !== false, commands: v?.commands !== false }, collapsed };
  } catch {
    return { open: { paths: true, commands: true }, collapsed: [] };
  }
};
const saveSections = (v: SectionState) => {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...v.open, collapsed: v.collapsed }));
  } catch {
    // no storage: sections start open next time
  }
};

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

interface Row {
  id: string;
  name: string;
  value: string;
  group: string;
}

interface FormProps {
  kind: Kind;
  initial?: { name: string; value: string; group: string };
  groups: string[];
  onSave(name: string, value: string, group: string): void;
  onCancel(): void;
}

function ItemForm({ kind, initial, groups, onSave, onCancel }: FormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [value, setValue] = useState(initial?.value ?? '');
  const [group, setGroup] = useState(initial?.group ?? '');
  const listId = `term-side-groups-${kind}`;
  const ok = value.trim().length > 0;
  const save = () => {
    if (!ok) return;
    const v = value.trim();
    onSave(name.trim() || (kind === 'paths' ? lastSegment(v) : ''), v, group.trim());
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
      <input list={listId} value={group} maxLength={100} placeholder={t('terminalScreen.sidebar.group')} aria-label={t('terminalScreen.sidebar.group')} onChange={(e) => setGroup(e.target.value)} />
      <datalist id={listId}>
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
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
  const [state, setState] = useState(readSections);
  const open = state.open;
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  /** The form shown: a new item of a kind, or an existing item's id. */
  const [form, setForm] = useState<{ kind: Kind; id?: string }>();
  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((s) => s.toLowerCase().includes(q));

  const pathKey = data.paths.map((p) => p.path).join('\n');
  useEffect(() => {
    const paths = pathKey ? pathKey.split('\n') : [];
    if (paths.length === 0) {
      setMissing(new Set());
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      postExists(paths.slice(0, 200)).then(
        (r) => live && setMissing(new Set(r.missing)),
        () => {},
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pathKey]);

  const toggle = (kind: Kind) =>
    setState((s) => {
      const next = { ...s, open: { ...s.open, [kind]: !s.open[kind] } };
      saveSections(next);
      return next;
    });
  const toggleGroup = (key: string) =>
    setState((s) => {
      const next = { ...s, collapsed: s.collapsed.includes(key) ? s.collapsed.filter((k) => k !== key) : [...s.collapsed, key] };
      saveSections(next);
      return next;
    });

  const idOf = () => crypto.randomUUID().slice(0, 8);
  const commit = (kind: Kind, id: string | undefined, name: string, value: string, group: string) => {
    const g = group ? { group } : {};
    if (kind === 'paths') {
      const list: SavedPath[] = id
        ? data.paths.map((p) => (p.id === id ? { id: p.id, name, path: value, ...g } : p))
        : [...data.paths, { id: idOf(), name, path: value, ...g }];
      onChange({ ...data, paths: list });
    } else {
      const list: SavedCommand[] = id
        ? data.commands.map((c) => (c.id === id ? { id: c.id, name, command: value, ...g } : c))
        : [...data.commands, { id: idOf(), name, command: value, ...g }];
      onChange({ ...data, commands: list });
    }
    setForm(undefined);
  };
  const remove = (kind: Kind, id: string) =>
    onChange(kind === 'paths' ? { ...data, paths: data.paths.filter((p) => p.id !== id) } : { ...data, commands: data.commands.filter((c) => c.id !== id) });

  /** Moves an item one place among the items of its own group. */
  const move = (kind: Kind, id: string, dir: -1 | 1) => {
    const list: Array<SavedPath | SavedCommand> = kind === 'paths' ? data.paths : data.commands;
    const from = list.findIndex((x) => x.id === id);
    if (from < 0) return;
    const g = list[from]!.group ?? '';
    let to = from + dir;
    while (to >= 0 && to < list.length && (list[to]!.group ?? '') !== g) to += dir;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    [next[from], next[to]] = [next[to]!, next[from]!];
    onChange(kind === 'paths' ? { ...data, paths: next as SavedPath[] } : { ...data, commands: next as SavedCommand[] });
  };

  const rows = (kind: Kind) => {
    const all: Row[] =
      kind === 'paths'
        ? data.paths.map((p) => ({ id: p.id, name: p.name, value: p.path, group: p.group ?? '' }))
        : data.commands.map((c) => ({ id: c.id, name: c.name, value: c.command, group: c.group ?? '' }));
    const groups = [...new Set(all.map((i) => i.group).filter(Boolean))];
    const shown = all.filter((i) => match(i.name, i.value, i.group));
    const canMove = (i: Row, dir: -1 | 1) => {
      const sibs = all.filter((x) => x.group === i.group);
      const at = sibs.findIndex((x) => x.id === i.id);
      return at + dir >= 0 && at + dir < sibs.length;
    };
    const row = (i: Row) =>
      form?.kind === kind && form.id === i.id ? (
        <li key={i.id}>
          <ItemForm kind={kind} groups={groups} initial={{ name: i.name, value: i.value, group: i.group }} onSave={(n, v, g) => commit(kind, i.id, n, v, g)} onCancel={() => setForm(undefined)} />
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
          {kind === 'paths' && missing.has(i.value) && (
            <span className="muted term-side-missing" title={t('terminalScreen.sidebar.missing')}>
              <Icon name="alert" size={14} />
            </span>
          )}
          <span className="term-side-actions">
            <IconButton icon="chevron-up" size="sm" label={t('terminalScreen.sidebar.moveUp')} disabled={!canMove(i, -1)} onClick={() => move(kind, i.id, -1)} />
            <IconButton icon="chevron-down" size="sm" label={t('terminalScreen.sidebar.moveDown')} disabled={!canMove(i, 1)} onClick={() => move(kind, i.id, 1)} />
            <IconButton icon="edit" size="sm" label={t('terminalScreen.sidebar.edit')} onClick={() => setForm({ kind, id: i.id })} />
            <IconButton icon="trash" size="sm" label={t('terminalScreen.sidebar.delete')} onClick={() => remove(kind, i.id)} />
          </span>
        </li>
      );
    const shownGroups = groups.filter((g) => shown.some((i) => i.group === g));
    return (
      <>
        {form?.kind === kind && !form.id && <ItemForm kind={kind} groups={groups} onSave={(n, v, g) => commit(kind, undefined, n, v, g)} onCancel={() => setForm(undefined)} />}
        {shown.length === 0 && !(form?.kind === kind && !form.id) && (
          <div className="term-side-empty muted">{t(kind === 'paths' ? 'terminalScreen.sidebar.noPaths' : 'terminalScreen.sidebar.noCommands')}</div>
        )}
        <ul className="term-side-list">{shown.filter((i) => !i.group).map(row)}</ul>
        {shownGroups.map((g) => {
          const key = `${kind}:${g}`;
          const closed = state.collapsed.includes(key) && !q;
          return (
            <div key={g} className="term-side-group">
              <Button size="sm" variant="ghost" className="term-side-group-head" icon={closed ? 'chevron-up' : 'chevron-down'} aria-expanded={!closed} onClick={() => toggleGroup(key)}>
                {g}
              </Button>
              {!closed && <ul className="term-side-list">{shown.filter((i) => i.group === g).map(row)}</ul>}
            </div>
          );
        })}
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
