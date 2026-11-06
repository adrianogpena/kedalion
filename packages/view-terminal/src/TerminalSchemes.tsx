import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { Button, Modal, SettingItem } from '@kedalion/ui';
import { MAX_SCHEMES, parseWindowsTerminalSchemes, SCHEME_COLORS, TERMINAL_THEMES, themeOf, type ColorScheme } from '@kedalion/terminal/options';
import type { TerminalProfile } from '@kedalion/terminal/protocol';
import { t, type TerminalMessageKey } from './i18n';
import { terminalDefault, type TerminalSettings, type TerminalViewSettings } from './settings';

type Settings = TerminalViewSettings;
type Change = (patch: Partial<Settings>) => void;
type ProfileAppearance = NonNullable<TerminalProfile['appearance']>;
type SchemeColors = Omit<ColorScheme, 'id' | 'name'>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const OPTIONAL = ['cursor', 'cursorAccent', 'selectionBackground'] as const;
const FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
const CURSOR_STYLES = ['block', 'bar', 'underline'] as const;
const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;
const BUILTIN_THEMES = TERMINAL_THEMES as readonly string[];

const msg = (key: string, params?: Record<string, string | number>) => t(key as TerminalMessageKey, params as never);
const builtinName = (id: string) => msg(`settings.terminal.theme.${id}`);

/** A name not in `names`: `base`, else `base (2)`, `base (3)`, ... */
function uniqueName(base: string, names: readonly string[]): string {
  const used = new Set(names.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
}

function uniqueId(schemes: readonly ColorScheme[]): string {
  const taken = new Set(schemes.map((s) => s.id));
  let id = `custom-${Date.now().toString(36)}`;
  while (taken.has(id)) id += 'x';
  return id;
}

/** The colors of a built-in theme (`app` has no fixed ones, so Dark+ stands in) or a custom scheme. */
export function colorsOfTheme(id: string, schemes: readonly ColorScheme[]): SchemeColors {
  const custom = schemes.find((s) => s.id === id);
  if (custom) {
    const { id: _id, name: _name, ...rest } = custom;
    return rest;
  }
  const theme = themeOf(id === 'app' ? 'dark-plus' : id, () => '#000000') as Record<string, string>;
  const out: Record<string, string> = { foreground: theme.foreground, background: theme.background };
  for (const k of OPTIONAL) if (theme[k]) out[k] = theme[k];
  SCHEME_COLORS.forEach((k, i) => (out[k] = theme[ANSI_KEYS[i]]));
  return out as SchemeColors;
}

/** Background, foreground and the 16 ANSI colors as small squares. */
function Swatch({ scheme }: { scheme: SchemeColors }) {
  const colors = [scheme.background, scheme.foreground, ...SCHEME_COLORS.map((k) => scheme[k])];
  return (
    <span className="scheme-swatch" aria-hidden>
      {colors.map((c, i) => <span key={i} style={{ background: c }} />)}
    </span>
  );
}

/** A native color input with a hex text field; `optional` allows clearing it. */
function ColorInput({ label, value, optional, fallback, onChange }: { label: string; value: string | undefined; optional?: boolean; fallback: string; onChange: (v: string | undefined) => void }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commit = (v: string) => {
    setText(v);
    if (HEX.test(v)) onChange(v.toLowerCase());
    else if (optional && v === '') onChange(undefined);
  };
  return (
    <div className="scheme-color">
      <span className="muted">{label}</span>
      <input type="color" value={value ?? fallback} aria-label={label} onChange={(e) => commit(e.target.value)} />
      <input className="scheme-hex" value={text} placeholder={optional ? fallback : undefined} spellCheck={false} maxLength={7} aria-label={label} onChange={(e) => commit(e.target.value)} />
    </div>
  );
}

function SchemePreview({ scheme }: { scheme: SchemeColors }) {
  const c = (k: keyof SchemeColors): CSSProperties => ({ color: scheme[k] });
  return (
    <div className="scheme-preview" style={{ background: scheme.background, color: scheme.foreground }} aria-label={t('settings.terminal.schemes.preview')}>
      <div><span style={c('green')}>user@host</span> <span style={c('blue')}>~/project</span> <span style={c('brightBlack')}>(main)</span> $ git status</div>
      <div>On branch main</div>
      <div><span style={c('red')}>deleted:    old.ts</span></div>
      <div><span style={c('green')}>new file:   src/app.ts</span></div>
      <div><span style={c('yellow')}>warning:</span> <span style={c('cyan')}>3</span> <span style={c('purple')}>files</span> <span style={{ background: scheme.selectionBackground ?? 'transparent' }}>selected text</span></div>
      <div>
        <span style={c('green')}>user@host</span> $ ls{' '}
        <span className="scheme-cursor" style={{ background: scheme.cursor ?? scheme.foreground, color: scheme.cursorAccent ?? scheme.background }}> </span>
      </div>
      <div className="scheme-preview-bright">{SCHEME_COLORS.map((k) => <span key={k} style={{ background: scheme[k] }} />)}</div>
    </div>
  );
}

function SchemeEditor({ scheme, onChange }: { scheme: ColorScheme; onChange: (patch: Partial<ColorScheme>) => void }) {
  return (
    <div className="scheme-editor">
      <label className="field">
        <span className="mono-label">{t('settings.terminal.schemes.name')}</span>
        <input value={scheme.name} maxLength={80} spellCheck={false} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <div className="scheme-colors">
        <ColorInput label={msg('settings.terminal.schemes.color.foreground')} value={scheme.foreground} fallback="#cccccc" onChange={(v) => v && onChange({ foreground: v })} />
        <ColorInput label={msg('settings.terminal.schemes.color.background')} value={scheme.background} fallback="#1e1e1e" onChange={(v) => v && onChange({ background: v })} />
        {OPTIONAL.map((k) => (
          <ColorInput
            key={k}
            label={msg(`settings.terminal.schemes.color.${k}`)}
            value={scheme[k]}
            optional
            fallback={k === 'cursorAccent' ? scheme.background : k === 'cursor' ? scheme.foreground : '#264f78'}
            onChange={(v) => onChange({ [k]: v })}
          />
        ))}
        {SCHEME_COLORS.map((k) => (
          <ColorInput key={k} label={msg(`settings.terminal.schemes.color.${k}`)} value={scheme[k]} fallback="#000000" onChange={(v) => v && onChange({ [k]: v })} />
        ))}
      </div>
      <SchemePreview scheme={scheme} />
    </div>
  );
}

function ImportModal({ schemes, onImport, onClose }: { schemes: ColorScheme[]; onImport: (found: ColorScheme[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const found = text.trim() ? parseWindowsTerminalSchemes(text, schemes.map((s) => s.id)) : null;
  const room = MAX_SCHEMES - schemes.length;
  return (
    <Modal
      title={t('settings.terminal.schemes.importTitle')}
      onClose={onClose}
      footer={
        <>
          <Button title={t('settings.terminal.schemes.importCancel')} onClick={onClose}>{t('settings.terminal.schemes.importCancel')}</Button>
          <Button title={t('settings.terminal.schemes.importAction')} variant="primary" disabled={!found || found.length === 0 || room <= 0} onClick={() => found && onImport(found.slice(0, room))}>{t('settings.terminal.schemes.importAction')}</Button>
        </>
      }
    >
      <div className="form">
        <span className="muted">{t('settings.terminal.schemes.importHint')}</span>
        <textarea className="scheme-import" rows={10} value={text} spellCheck={false} autoFocus placeholder={t('settings.terminal.schemes.importPlaceholder')} onChange={(e) => setText(e.target.value)} />
        {found && (found.length > 0
          ? <span className="muted">{t('settings.terminal.schemes.importFound', { count: found.length })}</span>
          : <span className="req-hint tone-warn">{t('settings.terminal.schemes.importNone')}</span>)}
      </div>
    </Modal>
  );
}

/** Terminal > Appearance: built-in schemes (read only) and the custom ones, with editor, copy and Windows Terminal import. */
export function SchemesRow({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const schemes = settings.terminal?.schemes ?? [];
  const selected = settings.terminal?.theme ?? 'app';
  const set = (next: ColorScheme[]) => onChange({ terminal: { ...settings.terminal, schemes: next } });
  return (
    <SettingItem id="terminal.schemes" modified={schemes.length > 0}>
      <SchemesField schemes={schemes} selected={selected} onChange={set} />
    </SettingItem>
  );
}

function SchemesField({ schemes, selected, onChange }: { schemes: ColorScheme[]; selected: string; onChange: (schemes: ColorScheme[]) => void }) {
  const [editing, setEditing] = useState<string>();
  const [importing, setImporting] = useState(false);
  const names = schemes.map((s) => s.name);
  const full = schemes.length >= MAX_SCHEMES;
  const clean = (s: ColorScheme): ColorScheme => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as ColorScheme;
  const add = (name: string, colors: SchemeColors) => {
    const id = uniqueId(schemes);
    onChange([...schemes, { id, name: uniqueName(name, names), ...colors }]);
    setEditing(id);
  };
  const selectedName = schemes.find((s) => s.id === selected)?.name ?? (BUILTIN_THEMES.includes(selected) && selected !== 'app' ? builtinName(selected) : t('settings.terminal.schemes.newName'));
  return (
    <div className="field schemes">
      <span className="mono-label">{t('settings.terminal.schemes')}</span>
      <span className="muted">{t('settings.terminal.schemes.hint')}</span>
      <div className="profile-list">
        {TERMINAL_THEMES.filter((id) => id !== 'app').map((id) => (
          <div key={id} className="profile-row scheme-row">
            <Swatch scheme={colorsOfTheme(id, [])} />
            <span className="profile-name">{builtinName(id)}</span>
            <span className="muted profile-shell">{t('settings.terminal.schemes.builtin')}</span>
            <span className="profile-actions">
              <Button title={t('settings.terminal.schemes.duplicate')} size="xs" icon="copy" disabled={full} onClick={() => add(builtinName(id), colorsOfTheme(id, []))}>{t('settings.terminal.schemes.duplicate')}</Button>
            </span>
          </div>
        ))}
        {schemes.map((s) => {
          const open = editing === s.id;
          return (
            <div key={s.id} className="profile-row scheme-row">
              <Swatch scheme={s} />
              <span className="profile-name">{s.name}</span>
              <span className="muted profile-shell">{t('settings.terminal.schemes.custom')}</span>
              <span className="profile-actions">
                <Button title={t(open ? 'settings.terminal.profiles.done' : 'settings.terminal.profiles.edit')} size="xs" icon={open ? 'check' : 'edit'} aria-expanded={open} onClick={() => setEditing(open ? undefined : s.id)}>{t(open ? 'settings.terminal.profiles.done' : 'settings.terminal.profiles.edit')}</Button>
                <Button title={t('settings.terminal.schemes.duplicate')} size="xs" icon="copy" disabled={full} onClick={() => add(s.name, colorsOfTheme(s.id, schemes))}>{t('settings.terminal.schemes.duplicate')}</Button>
                <Button title={t('settings.terminal.profiles.delete')} variant="danger" size="xs" icon="trash" onClick={() => { if (editing === s.id) setEditing(undefined); onChange(schemes.filter((x) => x.id !== s.id)); }}>{t('settings.terminal.profiles.delete')}</Button>
              </span>
              {open && <SchemeEditor scheme={s} onChange={(patch) => onChange(schemes.map((x) => (x.id === s.id ? clean({ ...x, ...patch }) : x)))} />}
            </div>
          );
        })}
      </div>
      <div className="row">
        <Button title={t('settings.terminal.schemes.new')} size="sm" icon="plus" disabled={full} onClick={() => add(selectedName, colorsOfTheme(selected, schemes))}>{t('settings.terminal.schemes.new')}</Button>
        <Button title={t('settings.terminal.schemes.import')} size="sm" icon="download" disabled={full} onClick={() => setImporting(true)}>{t('settings.terminal.schemes.import')}</Button>
      </div>
      {importing && (
        <ImportModal
          schemes={schemes}
          onClose={() => setImporting(false)}
          onImport={(found) => {
            const taken = [...names];
            const added = found.map((s) => {
              const name = uniqueName(s.name, taken);
              taken.push(name);
              return { ...s, name };
            });
            onChange([...schemes, ...added]);
            setImporting(false);
          }}
        />
      )}
    </div>
  );
}

/** A select of the built-in themes and the custom schemes; `inherit` adds an empty "use default" choice. */
function ThemeSelect({ value, schemes, inherit, label, onChange }: { value: string; schemes: ColorScheme[]; inherit?: string; label: string; onChange: (v: string) => void }) {
  const known = value === '' || BUILTIN_THEMES.includes(value) || schemes.some((s) => s.id === value);
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {inherit !== undefined && <option value="">{inherit}</option>}
      {!known && <option value={value}>{value}</option>}
      <optgroup label={t('settings.terminal.schemes.builtin')}>
        {TERMINAL_THEMES.map((id) => <option key={id} value={id}>{builtinName(id)}</option>)}
      </optgroup>
      {schemes.length > 0 && (
        <optgroup label={t('settings.terminal.schemes.custom')}>
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/** The global color theme row: built-ins plus the custom schemes. */
export function ThemeRow({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const value = settings.terminal?.theme ?? 'app';
  const label = t('settings.terminal.theme');
  return (
    <SettingItem id="terminal.theme" modified={value !== terminalDefault('theme')}>
      <label className="field">
        <span className="mono-label">{label}</span>
        <ThemeSelect value={value} schemes={settings.terminal?.schemes ?? []} label={label} onChange={(theme) => onChange({ terminal: { ...settings.terminal, theme } })} />
        <span className="muted">{t('settings.terminal.theme.hint')}</span>
      </label>
    </SettingItem>
  );
}

/** A number kept as text while typing; empty clears it, a number is clamped on blur or Enter. */
function OptionalNumber({ value, min, max, step, placeholder, label, onChange }: { value: number | undefined; min: number; max: number; step: number; placeholder: string; label: string; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) {
      setText('');
      onChange(undefined);
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    onChange(clamped);
  };
  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** The optional Appearance part of a profile; an empty field inherits the global terminal setting. */
export function ProfileAppearanceFields({ value, terminal, onChange }: { value: ProfileAppearance | undefined; terminal: TerminalSettings | undefined; onChange: (appearance: ProfileAppearance | undefined) => void }) {
  const a = value ?? {};
  const inherited = (k: keyof ProfileAppearance): unknown => (terminal as Record<string, unknown> | undefined)?.[k] ?? terminalDefault(k);
  const set = (patch: Partial<ProfileAppearance>) => {
    const next: Record<string, unknown> = { ...a, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    onChange(Object.keys(next).length ? (next as ProfileAppearance) : undefined);
  };
  const schemes = terminal?.schemes ?? [];
  const themeName = (id: string) => schemes.find((s) => s.id === id)?.name ?? (BUILTIN_THEMES.includes(id) ? builtinName(id) : id);
  const useDefault = (v: string) => t('settings.terminal.profiles.useDefaultValue', { value: v });
  const weightLabel = (w: string) => msg(`settings.terminal.fontWeight.${w}`);
  const blinkLabel = (b: boolean) => t(b ? 'settings.terminal.profiles.on' : 'settings.terminal.profiles.off');
  const item = (key: keyof ProfileAppearance, labelKey: string, child: ReactNode) => (
    <SettingItem id={`terminal.profiles.appearance.${key}`} modified={a[key] !== undefined}>
      <label className="field">
        <span className="mono-label">{msg(labelKey)}</span>
        {child}
      </label>
    </SettingItem>
  );
  return (
    <div className="profile-appearance">
      <span className="mono-label">{t('settings.terminal.profiles.appearance')}</span>
      <span className="muted">{t('settings.terminal.profiles.appearance.hint')}</span>
      {item('fontFamily', 'settings.terminal.fontFamily', (
        <input value={a.fontFamily ?? ''} placeholder={String(inherited('fontFamily'))} spellCheck={false} onChange={(e) => set({ fontFamily: e.target.value })} />
      ))}
      {item('fontSize', 'settings.terminal.fontSize', (
        <OptionalNumber value={a.fontSize} min={8} max={32} step={1} placeholder={String(inherited('fontSize'))} label={t('settings.terminal.fontSize')} onChange={(fontSize) => set({ fontSize })} />
      ))}
      {item('fontWeight', 'settings.terminal.fontWeight', (
        <select value={a.fontWeight ?? ''} onChange={(e) => set({ fontWeight: (e.target.value || undefined) as ProfileAppearance['fontWeight'] })}>
          <option value="">{useDefault(weightLabel(String(inherited('fontWeight'))))}</option>
          {FONT_WEIGHTS.map((w) => <option key={w} value={w}>{weightLabel(w)}</option>)}
        </select>
      ))}
      {item('lineHeight', 'settings.terminal.lineHeight', (
        <OptionalNumber value={a.lineHeight} min={1} max={2} step={0.1} placeholder={String(inherited('lineHeight'))} label={t('settings.terminal.lineHeight')} onChange={(lineHeight) => set({ lineHeight })} />
      ))}
      {item('theme', 'settings.terminal.theme', (
        <ThemeSelect value={a.theme ?? ''} schemes={schemes} label={t('settings.terminal.theme')} inherit={useDefault(themeName(String(inherited('theme'))))} onChange={(theme) => set({ theme })} />
      ))}
      {item('cursorStyle', 'settings.terminal.cursorStyle', (
        <select value={a.cursorStyle ?? ''} onChange={(e) => set({ cursorStyle: (e.target.value || undefined) as ProfileAppearance['cursorStyle'] })}>
          <option value="">{useDefault(msg(`settings.terminal.cursorStyle.${inherited('cursorStyle')}`))}</option>
          {CURSOR_STYLES.map((s) => <option key={s} value={s}>{msg(`settings.terminal.cursorStyle.${s}`)}</option>)}
        </select>
      ))}
      {item('cursorBlink', 'settings.terminal.cursorBlink', (
        <select value={a.cursorBlink === undefined ? '' : a.cursorBlink ? 'on' : 'off'} onChange={(e) => set({ cursorBlink: e.target.value === '' ? undefined : e.target.value === 'on' })}>
          <option value="">{useDefault(blinkLabel(inherited('cursorBlink') === true))}</option>
          <option value="on">{blinkLabel(true)}</option>
          <option value="off">{blinkLabel(false)}</option>
        </select>
      ))}
      {item('padding', 'settings.terminal.padding', (
        <OptionalNumber value={a.padding} min={0} max={48} step={1} placeholder={String(inherited('padding'))} label={t('settings.terminal.padding')} onChange={(padding) => set({ padding })} />
      ))}
    </div>
  );
}
