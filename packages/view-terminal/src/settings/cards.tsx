import { type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { Button, deepEqual, ErrorBanner, IconButton, IconPicker, type IconName, isModified, SettingItem, SettingRow, type SettingsFieldProps, Spinner, useAsync, type SettingsCardProps } from '@kedalion/ui';
import { listProfiles, listShells } from '@kedalion/terminal/session';
import { isShellId, SHELL_ICONS, SHELL_IDS, SHELL_NAMES, type TerminalProfile, type TerminalProfileInfo } from '@kedalion/terminal/protocol';
import { t, type TerminalMessageKey } from '../i18n';
import { terminalSettingDefs, type TerminalViewSettings } from '../settings';
import { TriggersRow } from './TriggersRow';
import { PromptRow } from './PromptRow';
import { ProfileAppearanceFields, SchemesRow, ThemeRow } from '../TerminalSchemes';

type Settings = TerminalViewSettings;
type Change = (patch: Partial<Settings>) => void;

const tr = (key: string | undefined) => (key ? t(key as TerminalMessageKey) : '');

function TerminalCard({ shell, onShell }: { shell: string; onShell: (shell: string) => void }) {
  const shells = useAsync(() => listShells(), []);
  return (
    <section className="section">
      <div className="card form">
        {shells.error && <ErrorBanner error={shells.error} onRetry={shells.reload} compact />}
        <label className="field">
          <span className="mono-label">{t('settings.terminal.shell')}</span>
          <select value={shell} disabled={!shells.data} onChange={(e) => onShell(e.target.value)}>
            <option value="auto">{t('settings.terminal.auto')}</option>
            {shells.data?.filter((id) => id !== 'auto').map((id) => <option key={id} value={id}>{SHELL_NAMES[id as keyof typeof SHELL_NAMES] ?? id}</option>)}
          </select>
          <span className="muted">{t('settings.terminal.hint')}</span>
        </label>
      </div>
    </section>
  );
}

/** The default profile: a select of the available, visible profiles; empty follows the shell setting. */
function DefaultProfileRow({ def, settings, onChange }: SettingsFieldProps<Settings>) {
  const infos = useAsync(() => listProfiles(), []);
  const value = def.kind === 'custom' ? '' : String(def.get(settings) ?? '');
  const options = mergeProfiles(infos.data ?? [], settings.terminal?.profiles ?? []).filter((p) => p.available && !p.hidden);
  const known = options.some((p) => p.id === value);
  return (
    <SettingItem id={def.id} modified={isModified(def, settings)}>
      <label className="field">
        <span className="mono-label">{tr(def.label)}</span>
        <select value={value} onChange={(e) => onChange({ terminal: { ...settings.terminal, defaultProfile: e.target.value } })}>
          <option value="">{t('settings.terminal.defaultProfile.none')}</option>
          {!known && value && <option value={value}>{value}</option>}
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="muted">{tr(def.description)}</span>
      </label>
    </SettingItem>
  );
}

const isBuiltinId = (id: string) => isShellId(id) && id !== 'auto';
const DEFAULT_ICON = 'terminal';
const iconOf = (p: TerminalProfile): IconName =>
  (p.icon || (isBuiltinId(p.shell) ? SHELL_ICONS[p.shell as keyof typeof SHELL_ICONS] : '') || DEFAULT_ICON) as IconName;
const defaultIconOf = (p: TerminalProfile): IconName => (isBuiltinId(p.id) ? SHELL_ICONS[p.id as keyof typeof SHELL_ICONS] : DEFAULT_ICON) as IconName;
const ABSOLUTE = /^([a-zA-Z]:[\\/]|\/|\\\\)/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PROFILES = 50;

type ProfileRowData = TerminalProfile & { available: boolean };

const invalidProfile = (p: TerminalProfile) => !p.name.trim() || (p.shell === 'custom' && !(p.command && ABSOLUTE.test(p.command)));

/** The server's profiles with the draft's overrides and custom entries applied: built-ins first, then custom ones. */
function mergeProfiles(infos: TerminalProfileInfo[], saved: TerminalProfile[]): ProfileRowData[] {
  const byId = new Map(saved.map((p) => [p.id, p]));
  const builtin = infos
    .filter((p) => isBuiltinId(p.id))
    .map((p) => {
      const o = byId.get(p.id);
      return { ...p, ...(o ?? {}), id: p.id, shell: p.shell, available: p.available, icon: o?.icon ?? p.icon };
    });
  const custom = saved.filter((p) => !isBuiltinId(p.id)).map((p) => ({ ...p, available: true }));
  return [...builtin, ...custom];
}

/** An entry without the keys that hold their defaults, so a reset built-in leaves no override behind. */
function compact(p: TerminalProfile): TerminalProfile {
  const out: TerminalProfile = { ...p };
  for (const key of ['command', 'args', 'env', 'cwd', 'icon', 'hidden', 'shellIntegration', 'appearance'] as const) {
    const v = out[key];
    const empty = v === undefined || v === '' || v === false && key === 'hidden' || (Array.isArray(v) && v.length === 0) || ((key === 'env' || key === 'appearance') && !!v && Object.keys(v).length === 0);
    if (empty) delete out[key];
  }
  return out;
}

const linesOf = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const envOf = (text: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of linesOf(text)) {
    const at = line.indexOf('=');
    const key = at < 0 ? '' : line.slice(0, at).trim();
    if (ENV_KEY.test(key)) env[key] = line.slice(at + 1);
  }
  return env;
};

/** A multi-line field kept as free text while typing; `parse` turns it into the stored value. */
function TextLinesField<V>({ label, hint, value, toText, parse, onChange }: {
  label: string;
  hint: string;
  value: V;
  toText: (v: V) => string;
  parse: (text: string) => V;
  onChange: (v: V) => void;
}) {
  const [text, setText] = useState(() => toText(value));
  // An outside change (reset) replaces the text; typing keeps it.
  useEffect(() => {
    if (!deepEqual(parse(text), value)) setText(toText(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <textarea rows={3} value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />
      <span className="muted">{hint}</span>
    </label>
  );
}

function ProfilesRow({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const fallback: TerminalProfile[] = [];
  const saved = settings.terminal?.profiles ?? [];
  return (
    <SettingItem id="terminal.profiles" modified={!deepEqual(saved, fallback)}>
      <ProfilesField value={saved} terminal={settings.terminal} onChange={(profiles) => onChange({ terminal: { ...settings.terminal, profiles } })} />
    </SettingItem>
  );
}

function ProfilesField({ value: saved, terminal, onChange: save }: { value: TerminalProfile[]; terminal: Settings['terminal']; onChange: (profiles: TerminalProfile[]) => void }) {
  const infos = useAsync(() => listProfiles(), []);
  const [editing, setEditing] = useState<string>();
  const [picking, setPicking] = useState<string>();
  // While a profile is invalid the list stays here unsaved: the server would drop the whole terminal group.
  const [draft, setDraft] = useState<TerminalProfile[] | null>(null);
  useEffect(() => setDraft(null), [saved]);
  const value = draft ?? saved;
  const onChange = (next: TerminalProfile[]) => {
    if (next.some(invalidProfile)) {
      setDraft(next);
      return;
    }
    setDraft(null);
    save(next);
  };
  const rows = mergeProfiles(infos.data ?? [], value);
  const listed = rows.filter((p) => !isBuiltinId(p.id) || p.available);

  // Writes a row's fields; a built-in keeps only its overrides and drops out when nothing is left.
  const update = (id: string, patch: Partial<TerminalProfile>) => {
    const current = value.find((p) => p.id === id);
    if (!isBuiltinId(id)) {
      onChange(value.map((p) => (p.id === id ? compact({ ...p, ...patch }) : p)));
      return;
    }
    const name = SHELL_NAMES[id as keyof typeof SHELL_NAMES];
    const next = compact({ ...(current ?? { id, name, shell: id as TerminalProfile['shell'] }), ...patch });
    const bare = next.name === name && Object.keys(next).every((k) => ['id', 'name', 'shell'].includes(k));
    const others = value.filter((p) => p.id !== id);
    onChange(bare ? others : current ? value.map((p) => (p.id === id ? next : p)) : [...others, next]);
  };
  const add = () => {
    let id = `custom-${Date.now().toString(36)}`;
    while (value.some((p) => p.id === id)) id += 'x';
    const shell = ((infos.data ?? []).find((p) => isBuiltinId(p.id) && p.available)?.id ?? 'powershell') as TerminalProfile['shell'];
    onChange([...value, { id, name: t('settings.terminal.profiles.newName'), shell }]);
    setEditing(id);
  };
  const remove = (id: string) => {
    if (editing === id) setEditing(undefined);
    onChange(value.filter((p) => p.id !== id));
  };
  const pickingRow = rows.find((p) => p.id === picking);

  return (
    <div className="field profiles">
      <span className="mono-label">{t('settings.terminal.profiles')}</span>
      <span className="muted">{t('settings.terminal.profiles.hint')}</span>
      {infos.error && <ErrorBanner error={infos.error} onRetry={infos.reload} compact />}
      {!infos.data && !infos.error && <Spinner small />}
      <div className="profile-list">
        {listed.map((p) => {
          const builtin = isBuiltinId(p.id);
          const open = editing === p.id;
          return (
            <div key={p.id} className={`profile-row${p.hidden ? ' is-hidden' : ''}${open ? ' is-open' : ''}`}>
              <IconButton icon={iconOf(p)} label={t('settings.terminal.profiles.changeIcon')} onClick={() => setPicking(p.id)} />
              <span className="profile-name">{p.name}{p.hidden && <span className="muted"> ({t('settings.terminal.profiles.hidden')})</span>}</span>
              <span className="muted profile-shell">
                {p.shell === 'custom' ? t('settings.terminal.profiles.shell.custom') : SHELL_NAMES[p.shell as keyof typeof SHELL_NAMES] ?? p.shell}
                {' · '}{builtin ? t('settings.terminal.profiles.builtin') : t('settings.terminal.profiles.custom')}
              </span>
              <span className="profile-actions">
                {builtin && <Button title={t(p.hidden ? 'settings.terminal.profiles.show' : 'settings.terminal.profiles.hide')} size="xs" icon={p.hidden ? 'eye' : 'eye-off'} onClick={() => update(p.id, { hidden: !p.hidden })}>{t(p.hidden ? 'settings.terminal.profiles.show' : 'settings.terminal.profiles.hide')}</Button>}
                <Button title={t(open ? 'settings.terminal.profiles.done' : 'settings.terminal.profiles.edit')} size="xs" icon={open ? 'check' : 'edit'} aria-expanded={open} onClick={() => setEditing(open ? undefined : p.id)}>{t(open ? 'settings.terminal.profiles.done' : 'settings.terminal.profiles.edit')}</Button>
                {!builtin && <Button title={t('settings.terminal.profiles.delete')} variant="danger" size="xs" icon="trash" onClick={() => remove(p.id)}>{t('settings.terminal.profiles.delete')}</Button>}
              </span>
              {open && (
                <ProfileEditor
                  profile={p}
                  terminal={terminal}
                  builtin={builtin}
                  onChange={(patch) => update(p.id, patch)}
                  onPickIcon={() => setPicking(p.id)}
                  onReset={builtin && value.some((v) => v.id === p.id) ? () => onChange(value.filter((v) => v.id !== p.id)) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="row">
        <Button title={t('settings.terminal.profiles.add')} size="sm" icon="plus" disabled={value.length >= MAX_PROFILES} onClick={add}>{t('settings.terminal.profiles.add')}</Button>
      </div>
      {pickingRow && (
        <IconPicker
          value={iconOf(pickingRow)}
          onPick={(icon) => {
            update(pickingRow.id, { icon });
            setPicking(undefined);
          }}
          onClose={() => setPicking(undefined)}
        />
      )}
    </div>
  );
}

function ProfileEditor({ profile: p, terminal, builtin, onChange, onPickIcon, onReset }: {
  profile: ProfileRowData;
  terminal: Settings['terminal'];
  builtin: boolean;
  onChange: (patch: Partial<TerminalProfile>) => void;
  onPickIcon: () => void;
  onReset?: () => void;
}) {
  const shells = SHELL_IDS.filter((id) => id !== 'auto');
  const defaultName = builtin ? SHELL_NAMES[p.id as keyof typeof SHELL_NAMES] : undefined;
  const invalid = invalidProfile(p);
  const field = (id: string, modified: boolean, child: ReactNode) => <SettingItem id={`terminal.profiles.${p.id}.${id}`} modified={modified}>{child}</SettingItem>;
  return (
    <div className="profile-editor">
      {invalid && <span className="req-hint tone-warn">{t('settings.terminal.profiles.invalid')}</span>}
      {field('name', builtin && p.name !== defaultName, (
        <label className="field">
          <span className="mono-label">{t('settings.terminal.profiles.name')}</span>
          <input value={p.name} spellCheck={false} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
      ))}
      {!builtin && (
        <div className="field">
          <span className="mono-label">{t('settings.terminal.profiles.shell')}</span>
          <select
            value={p.shell}
            aria-label={t('settings.terminal.profiles.shell')}
            onChange={(e) => onChange({ shell: e.target.value as TerminalProfile['shell'], ...(e.target.value === 'custom' ? {} : { command: undefined }) })}
          >
            {shells.map((id) => <option key={id} value={id}>{SHELL_NAMES[id as keyof typeof SHELL_NAMES]}</option>)}
            <option value="custom">{t('settings.terminal.profiles.shell.custom')}</option>
          </select>
        </div>
      )}
      {!builtin && p.shell === 'custom' && (
        <label className="field">
          <span className="mono-label">{t('settings.terminal.profiles.command')}</span>
          <input value={p.command ?? ''} spellCheck={false} onChange={(e) => onChange({ command: e.target.value })} />
          <span className="muted">{t('settings.terminal.profiles.command.hint')}</span>
        </label>
      )}
      {field('args', (p.args?.length ?? 0) > 0, (
        <TextLinesField label={t('settings.terminal.profiles.args')} hint={t('settings.terminal.profiles.args.hint')} value={p.args ?? []} toText={(v) => v.join('\n')} parse={linesOf} onChange={(args) => onChange({ args })} />
      ))}
      {field('env', Object.keys(p.env ?? {}).length > 0, (
        <TextLinesField
          label={t('settings.terminal.profiles.env')}
          hint={t('settings.terminal.profiles.env.hint')}
          value={p.env ?? {}}
          toText={(v) => Object.entries(v).map(([k, x]) => `${k}=${x}`).join('\n')}
          parse={envOf}
          onChange={(env) => onChange({ env })}
        />
      ))}
      {field('cwd', !!p.cwd, (
        <label className="field">
          <span className="mono-label">{t('settings.terminal.profiles.cwd')}</span>
          <input value={p.cwd ?? ''} spellCheck={false} onChange={(e) => onChange({ cwd: e.target.value })} />
          <span className="muted">{t('settings.terminal.profiles.cwd.hint')}</span>
        </label>
      ))}
      {field('icon', !!p.icon && p.icon !== defaultIconOf(p), (
        <div className="field">
          <span className="mono-label">{t('settings.terminal.profiles.changeIcon')}</span>
          <div className="row">
            <Button title={iconOf(p)} size="sm" icon={iconOf(p)} onClick={onPickIcon}>{iconOf(p)}</Button>
            <Button title={t('settings.terminal.profiles.defaultIcon')} size="sm" disabled={!p.icon} onClick={() => onChange({ icon: undefined })}>{t('settings.terminal.profiles.defaultIcon')}</Button>
          </div>
        </div>
      ))}
      {field('shellIntegration', p.shellIntegration === false, (
        <label className="field setting-check">
          <span className="mono-label">{t('settings.terminal.profiles.shellIntegration')}</span>
          <input
            type="checkbox"
            checked={p.shellIntegration !== false}
            aria-label={t('settings.terminal.profiles.shellIntegration')}
            onChange={(e) => onChange({ shellIntegration: e.target.checked ? undefined : false })}
          />
        </label>
      ))}
      <ProfileAppearanceFields value={p.appearance} terminal={terminal} onChange={(appearance) => onChange({ appearance })} />
      {onReset && <div className="row"><Button title={t('settings.terminal.profiles.reset')} size="sm" icon="rotate-ccw" onClick={onReset}>{t('settings.terminal.profiles.reset')}</Button></div>}
    </div>
  );
}

/** The `terminal.profiles` page: the shell select, then the profile rows. */
export function TerminalProfilesCard({ settings, onChange, rows }: SettingsCardProps<Settings>) {
  return (
    <>
      <TerminalCard shell={settings.terminal?.shell ?? 'auto'} onShell={(shell) => onChange({ terminal: { ...settings.terminal, shell } })} />
      {rows(PROFILE_IDS)}
    </>
  );
}

const PROFILE_IDS = terminalSettingDefs
  .filter((d) => d.section.join('.') === 'terminal.profiles')
  .sort((a, b) => a.order - b.order)
  .map((d) => d.id);

/** The hand-written rows of the terminal settings (search results show them too). */
export const terminalSettingFields: Record<string, ComponentType<SettingsFieldProps<Settings>>> = {
  'terminal.defaultProfile': (p) => <DefaultProfileRow {...p} />,
  'terminal.theme': ({ settings, onChange }) => <ThemeRow settings={settings} onChange={onChange} />,
  'terminal.schemes': ({ settings, onChange }) => <SchemesRow settings={settings} onChange={onChange} />,
  'terminal.profiles': ({ settings, onChange }) => <ProfilesRow settings={settings} onChange={onChange} />,
  'terminal.triggers': ({ settings, onChange }) => <TriggersRow settings={settings} onChange={onChange} />,
  'terminal.promptStyle': ({ settings, onChange }) => <PromptRow settings={settings} onChange={onChange} />,
  'terminal.pasteLargeSize': ({ def, settings, onChange }) =>
    settings.terminal?.pasteWarning === 'never'
      ? <fieldset className="setting-disabled" disabled><SettingRow def={def} settings={settings} onChange={onChange} /></fieldset>
      : <SettingRow def={def} settings={settings} onChange={onChange} />,
};
