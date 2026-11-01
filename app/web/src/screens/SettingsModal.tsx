import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, AppearanceFields, DockField, IconsField, LayoutField, MainMenuField, SettingLinksProvider, SettingErrorsContext, type SettingLinks, SettingRow, useRevealSetting, useRovingList, SETTING_ROW_CONTROLS,ZoomField, type ApiError, detectLanguage, type FileAssociation, validFileAssociations, deepEqual, dialogs, ErrorBanner, errorMessage, errorOf, GLOBAL, isDesktop, KeybindingsEditor, LANGUAGES, isModified, Modal, parseSettingsQuery, settingDescriptionText, toggleModifiedFilter, Spinner, useAsync, useKeybindings, tryT, type Language, type SettingDef, type SettingsSectionNode, sectionKey } from '@kedalion/ui';
import { APP } from '../../../app';
import { views } from '../views';
import { api, type BackupInfo, type EditorInfo, type ImportResult, type Settings } from '../api';
import { type MessageKey, t } from '../i18n';
import { settingsRegistry } from '../settings';
import { LinksSettings } from './LinksSettings';

interface Props {
  settings: Settings;
  /** Saves the patch at once; may resolve to the error the server refused it with. */
  onChange: (patch: Partial<Settings>) => void | Promise<ApiError | null>;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

type Change = (patch: Partial<Settings>) => void;

/** Translates `key` when it is a message, else falls back. */
const tr = (key: string | undefined, fallback?: string): string => (!key ? (fallback ?? '') : (tryT(key) ?? fallback ?? key));

const sectionLabel = (node: SettingsSectionNode): string => {
  const key = sectionKey(node.path);
  const last = node.path[node.path.length - 1] ?? key;
  return tr(node.label, last.charAt(0).toUpperCase() + last.slice(1));
};

interface FlatNode {
  node: SettingsSectionNode;
  key: string;
  depth: number;
  /** Labels from the top level down to this node. */
  trail: string[];
}

const flatten = (nodes: SettingsSectionNode[], depth = 0, trail: string[] = []): FlatNode[] =>
  nodes.flatMap((node) => {
    const here = [...trail, sectionLabel(node)];
    return [{ node, key: sectionKey(node.path), depth, trail: here }, ...flatten(node.children, depth + 1, here)];
  });

const isUnder = (key: string, parent: string) => key === parent || key.startsWith(`${parent}.`);

interface SectionHit {
  /** The section label matched, so the whole section shows. */
  whole: boolean;
  /** Matching settings directly in the section. */
  ids: string[];
}

const PROBLEMS_TAG = '@problems';

/** Takes the `@problems` filter out of a settings search. */
const splitProblemsTag = (query: string): { problems: boolean; rest: string } => {
  const tokens = query.split(/\s+/).filter(Boolean);
  const rest = tokens.filter((tok) => tok.toLowerCase() !== PROBLEMS_TAG);
  return { problems: rest.length !== tokens.length, rest: rest.join(' ') };
};

/** Whether the saved value of a setting fails its schema (wrong type, not one of the enum values, outside min/max). */
function problemOf(def: SettingDef<Settings>, s: Settings): boolean {
  if (def.kind === 'custom' || !def.get) return false;
  const v: unknown = def.get(s);
  if (v === undefined) return false;
  switch (def.kind) {
    case 'boolean': return typeof v !== 'boolean';
    case 'string': return typeof v !== 'string';
    case 'number': return typeof v !== 'number' || !Number.isFinite(v) || (def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max);
    case 'enum': return !(def.values as readonly unknown[]).includes(v);
  }
}

/** Whether the screen can read and reset the setting (every non-custom one, and the custom ones that give a getter and setter). */
const handled = (def: SettingDef<Settings>): boolean => def.kind !== 'custom' || (!!def.get && !!def.set);

/** A setting's value in `s`. */
const valueOf = (def: SettingDef<Settings>, s: Settings): unknown => (def.get ? def.get(s) : undefined);

/** A setting's translated label, or the id when it has none. */
const labelOf = (id: string): string | undefined => {
  const def = settingsRegistry.setting(id);
  return def && tr(def.label, id);
};

/**
 * Searches the schema like VS Code's settings search: a setting matches when its label, rendered description or id
 * holds every word; a section whose label matches (or sits under one that does) shows whole. `@modified` and
 * `@id:<id>` filters AND with the words; while one is on, a matching section shows only its filtered schema rows,
 * since hand-written fields have no schema entry to filter. Returns the sections with hits.
 */
function searchSchema(flat: FlatNode[], query: string, settings: Settings): Map<string, SectionHit> {
  const { problems, rest } = splitProblemsTag(query);
  const { text, modified, ids: only } = parseSettingsQuery(rest);
  const words = norm(text).trim().split(' ').filter(Boolean);
  const filtered = modified || problems || only.length > 0;
  const found = new Map<string, SectionHit>();
  if (words.length === 0 && !filtered) return found;
  const labelKeys: string[] = [];
  for (const { node, key } of flat) {
    const labelHit = words.length > 0 && (words.every((w) => norm(sectionLabel(node)).includes(w)) || labelKeys.some((k) => isUnder(key, k)));
    if (labelHit) labelKeys.push(key);
    const whole = labelHit && !filtered;
    const ids = settingsRegistry
      .settingsIn(node.path)
      .filter((s) => {
        if (modified && !isModified(s, settings)) return false;
        if (problems && !problemOf(s, settings)) return false;
        if (only.length > 0 && !only.includes(s.id)) return false;
        if (labelHit) return true;
        const hay = norm([tr(s.label), settingDescriptionText(tr(s.description), labelOf), s.id].join(' '));
        return words.every((w) => hay.includes(w));
      })
      .map((s) => s.id);
    if (whole || ids.length > 0) found.set(key, { whole, ids });
  }
  return found;
}

/** The root section holding view `viewId`'s settings (by convention named like the view), or undefined when it has none. */
export const viewSettingsSection = (viewId: string): string | undefined =>
  settingsRegistry.sectionTree().some((n) => sectionKey(n.path) === viewId) ? viewId : undefined;

/** The section last shown; lives until the app restarts. */
let lastSection: string | undefined;

/**
 * Settings as a full page in the app content area (VS Code's settings editor), closed with Escape or the X. Header:
 * title, search, Open settings.json, close. The nav is the schema's section tree; every section, child ones too, is
 * its own page showing only its own settings (a parent with none lists links to its children). Keyboard › Shortcuts
 * holds the keybindings editor, which has its own filter; `initialSection` opens a section directly.
 * Every change saves at once (text on blur or Enter, Escape reverts); a rejected save leaves the old value and shows
 * the error on its row.
 */
export function SettingsModal({ settings, onChange, onReplace, onQuit, onClose, initialSection, onlyView }: Props & { onReplace: (next: Settings) => void; onClose: () => void; initialSection?: string; onlyView?: string }) {
  const flat = useMemo(() => {
    const tree = settingsRegistry.sectionTree();
    return flatten(onlyView ? tree.filter((n) => sectionKey(n.path) === viewSettingsSection(onlyView)) : tree);
  }, [onlyView]);
  const [startSection] = useState(() => {
    if (onlyView) return flat[0]?.key;
    const remembered = settings.rememberSettingsPage !== false && lastSection && flat.some((f) => f.key === lastSection) ? lastSection : undefined;
    return initialSection ?? remembered;
  });
  const [section, setSection] = useState(startSection ?? flat[0]?.key ?? 'general');
  useEffect(() => {
    if (!onlyView) lastSection = section;
  }, [section, onlyView]);
  // The initial section's ancestors start expanded, so the nav shows it; a view's root starts open.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const path = startSection?.split('.') ?? [];
    const open = path.slice(0, onlyView ? path.length : -1).map((_, i) => path.slice(0, i + 1).join('.'));
    return new Set(open);
  });
  const [query, setQuery] = useState('');
  const draft = settings;
  // The server's reason a save was refused, by setting id; shown on the row.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change: Change = (patch) => {
    const next = { ...settings, ...patch };
    const ids = settingsRegistry.settings().filter((d) => handled(d) && !deepEqual(valueOf(d, settings), valueOf(d, next))).map((d) => d.id);
    void Promise.resolve(onChange(patch)).then((err) => {
      if (ids.length === 0) return;
      setErrors((prev) => {
        const out = { ...prev };
        for (const id of ids) {
          if (err) out[id] = errorMessage(err as ApiError);
          else delete out[id];
        }
        return out;
      });
    });
  };
  // Escape returns to the previous view, unless a dialog, a toast or a field used the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-backdrop, .toasts > *')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';
  const hits = useMemo(() => searchSchema(flat, query, draft), [flat, query, draft]);
  const modifiedOnly = parseSettingsQuery(splitProblemsTag(query).rest).modified;
  const problemSettings = useMemo(() => settingsRegistry.settings().filter((d) => (!onlyView || isUnder(sectionKey(d.section), onlyView)) && problemOf(d, draft)), [draft, onlyView]);
  const [fileError, setFileError] = useState<string | null>(null);
  // Picks up edits made to settings.json outside the app.
  useEffect(() => {
    const timer = setInterval(() => {
      api.externalSettings().then((r) => { if (r.changed) onReplace(r.settings); }, () => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [onReplace]);
  const total = [...hits.values()].reduce((n, h) => n + h.ids.length, 0);

  /** Pages with an explicit `render` branch; keep in step with the switch below. */
  const OWN_PAGES = ['general', 'general.links', 'appearance', 'window', 'editor', 'editor.fileTypes', 'editor.externalEditors', 'keyboard.shortcuts', 'system.updates', 'system.backup'];

  /** Whether the section has settings or a card of its own (else a parent lists links to its children). */
  const hasOwn = (key: string): boolean =>
    OWN_PAGES.includes(key) || settingsRegistry.settingsIn(key.split('.')).length > 0 || !!views.settingsCards.cards[key];

  const render = (key: string): ReactNode => {
    switch (key) {
      case 'general': return <GeneralSection settings={draft} onChange={change} onQuit={onQuit} />;
      case 'general.links': return <LinksSettings settings={draft} onChange={change} />;
      case 'appearance':
        return (
          <>
            <section className="section">
              <div className="card form">
                <AppearanceFields value={draft} onChange={change} />
                <LayoutField value={draft} onChange={change} />
                <MainMenuField value={draft} onChange={change} />
                <DockField value={draft} onChange={change} />
                <IconsField value={draft} onChange={change} />
              </div>
            </section>
            <SettingRows ids={groupIds('appearance')} settings={draft} onChange={change} />
          </>
        );
      case 'window':
        return (
          <>
          <section className="section">
            <div className="card form">
              <ZoomField value={draft} onChange={change} />
            </div>
          </section>
          <SettingRows ids={groupIds('window')} settings={draft} onChange={change} />
          </>
        );
      case 'editor':
        return (
          <>
            <EditorCard settings={draft} onChange={change} />
            <SettingRows ids={groupIds('editor')} settings={draft} onChange={change} />
          </>
        );
      case 'editor.fileTypes': return <FileTypesCard value={draft.fileAssociations ?? []} onChange={(fileAssociations) => change({ fileAssociations })} />;
      case 'editor.externalEditors': return <EditorsCard />;
      case 'keyboard': return <SettingRows ids={groupIds('keyboard')} settings={draft} onChange={change} />;
      case 'keyboard.shortcuts': return <ShortcutsSection settings={settings} onChange={onChange} />;
      case 'system.updates': return <UpdatesCard />;
      case 'system.backup': return (
        <BackupCard
          onSettings={onReplace}
        />
      );
      default: {
        // A view's page for its section, else the section's schema rows.
        const Card = views.settingsCards.cards[key];
        if (Card) return <Card settings={draft} onChange={change} row={(id) => <SettingFieldById key={id} id={id} settings={draft} onChange={change} />} rows={(ids) => <SettingRows ids={[...ids]} settings={draft} onChange={change} />} />;
        const path = key.split('.');
        const defs = settingsRegistry.settingsIn(path);
        return defs.length > 0 ? <SettingRows ids={defs.map((d) => d.id)} settings={draft} onChange={change} /> : null;
      }
    }
  };

  // While searching, a nav click shows that whole section with the search kept; the matching rows are highlighted.
  const [picked, setPicked] = useState(false);
  const pickedPage = searching && picked;
  const open = (key: string) => {
    if (searching) setPicked(true);
    setSection(key);
    body.current?.scrollTo({ top: 0 });
  };
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  // A node shows when its ancestors are expanded; while searching, when it or a descendant has hits.
  const visible = (f: FlatNode) =>
    searching
      ? [...hits.keys()].some((k) => isUnder(k, f.key))
      : f.node.path.slice(0, -1).every((_, i) => expanded.has(sectionKey(f.node.path.slice(0, i + 1))));
  const selected = flat.find((f) => f.key === section) ?? flat[0];
  const markIds = pickedPage && selected && !hits.get(selected.key)?.whole ? hits.get(selected.key)?.ids : undefined;
  useEffect(() => {
    for (const row of body.current?.querySelectorAll<HTMLElement>('[data-setting]') ?? []) {
      row.classList.toggle('search-hit', !!markIds?.includes(row.dataset.setting ?? ''));
    }
  });
  // A node is marked when a setting in it (or under it) differs from its default.
  // `#setting.id#` links in descriptions: open the target's section (unless search already shows it), then its row.
  const reveal = useRevealSetting(body);
  // Up/Down/Home/End/PageUp/PageDown between rows; Enter or F2 into a row's control, Escape back to the row.
  useRovingList(body, '[data-setting]', { control: SETTING_ROW_CONTROLS });
  const links = useMemo<SettingLinks>(() => ({
    labelOf,
    onNavigate: (id) => {
      const def = settingsRegistry.setting(id);
      if (!def) return;
      const hit = hits.get(sectionKey(def.section));
      if (!hit || !(hit.whole || hit.ids.includes(id))) {
        setQuery('');
        setSection(sectionKey(def.section));
        setExpanded((prev) => new Set([...prev, ...def.section.slice(0, -1).map((_, i) => sectionKey(def.section.slice(0, i + 1)))]));
      }
      reveal(id);
    },
  }), [hits, reveal]);

  return (
    <div className="settings-screen">
      <SettingLinksProvider value={links}>
      <SettingErrorsContext.Provider value={errors}>
      <header className="settings-head">
        <h2>{t('settings.title')}</h2>
          <div className="settings-nav-search-box">
          <input
            className="settings-search settings-nav-search"
            type="search"
            value={query}
            placeholder={t('settings.search')}
            aria-label={t('settings.search')}
            onChange={(e) => { setQuery(e.target.value); setPicked(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              } else if (e.key === 'ArrowDown') {
                // Like VS Code: down from the search box goes into the settings.
                const first = body.current?.querySelector<HTMLElement>(`.field :is(${CONTROLS})`);
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          />
          <button
            type="button"
            className="settings-nav-filter"
            title={t('settings.search.modified')}
            aria-label={t('settings.search.modified')}
            aria-pressed={modifiedOnly}
            onClick={() => setQuery(toggleModifiedFilter)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" />
            </svg>
          </button>
          </div>
          {searching && <span className="settings-count">{t(total === 1 ? 'settings.search.count.one' : 'settings.search.count', { n: total })}</span>}
        <span className="settings-head-spacer" />
        {fileError && <span className="tone-err small">{fileError}</span>}
        <Button size="sm" icon="file" title={t('settings.openFile')} onClick={() => { setFileError(null); api.openSettingsFile().catch((err) => setFileError(errorMessage(errorOf(err)))); }}>{t('settings.openFile')}</Button>
        <IconButton icon="close" label={t('settings.close')} onClick={onClose} />
      </header>
      {problemSettings.length > 0 && (
        <div className="settings-problems" style={{ padding: '8px 16px' }}>
          <span className="tone-err">{t('settings.problems.banner', { n: problemSettings.length })}</span>
          <div className="settings-links">
            {problemSettings.map((d) => (
              <button key={d.id} type="button" className="setting-link" onClick={() => links.onNavigate(d.id)}>{tr(d.label, d.id)}</button>
            ))}
            <button type="button" className="setting-link" onClick={() => setQuery(PROBLEMS_TAG)}>{PROBLEMS_TAG}</button>
          </div>
        </div>
      )}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {flat.filter(visible).map((f) => {
            const parent = f.node.children.length > 0;
            const isOpen = searching || expanded.has(f.key);
            const active = (!searching || pickedPage) && section === f.key;
            return (
              <button title={t('settings.row.modified')}
                key={f.key}
                className={`settings-nav-item${active ? ' active' : ''}`}
                style={{ '--depth': f.depth } as CSSProperties}
                aria-current={active}
                aria-expanded={parent ? isOpen : undefined}
                onClick={() => {
                  if (parent && (!expanded.has(f.key) || active)) toggle(f.key);
                  open(f.key);
                }}
              >
                <span
                  className={`settings-nav-twisty${parent ? '' : ' leaf'}${isOpen ? ' open' : ''}`}
                  onClick={(e) => {
                    if (!parent || searching) return;
                    e.stopPropagation();
                    toggle(f.key);
                  }}
                >
                  ▶
                </span>
                {sectionLabel(f.node)}
                {searching && !!hits.get(f.key)?.ids.length && <span className="settings-nav-count">{hits.get(f.key)!.ids.length}</span>}
              </button>
            );
          })}
        </nav>
        <div className="scroll" ref={body}>
          {searching && !pickedPage
            ? flat.filter((f) => hits.has(f.key)).map((f) => {
                const hit = hits.get(f.key)!;
                return (
                  <div key={f.key} className="settings-group" data-section={f.key}>
                    <h3 className="settings-group-title">{f.trail.join(' › ')}</h3>
                    {hit.whole ? render(f.key) : <SettingRows ids={hit.ids} settings={draft} onChange={change} />}
                  </div>
                );
              })
            : selected && (
                <div key={`page-${selected.key}`} className="settings-page">
                  <h3 className="settings-group-title">{selected.trail.join(' › ')}</h3>
                  {hasOwn(selected.key) ? render(selected.key) : null}
                  {!hasOwn(selected.key) && selected.node.children.length > 0 && (
                    <div className="settings-links">
                      {selected.node.children.map((c) => (
                        <button key={sectionKey(c.path)} type="button" className="setting-link" onClick={() => { setExpanded((prev) => new Set([...prev, selected.key])); open(sectionKey(c.path)); }}>
                          {sectionLabel(c)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
          {onlyView && flat.length === 0 && <div className="settings-empty"><span className="muted">{t('settings.noViewSettings')}</span></div>}
          {searching && hits.size === 0 && (
            <div className="settings-empty">
              <span className="muted">{t('settings.search.none')}</span>
              <Button size="sm" variant="ghost" icon="close" title={t('settings.search.clear')} onClick={() => setQuery('')}>{t('settings.search.clear')}</Button>
            </div>
          )}
        </div>
      </div>
      </SettingErrorsContext.Provider>
      </SettingLinksProvider>
    </div>
  );
}

/** One schema setting rendered as a row. */
function Row({ id, settings, onChange }: { id: string; settings: Settings; onChange: Change }) {
  return <SettingRow def={settingsRegistry.setting(id)!} settings={settings} onChange={onChange} />;
}

/** A schema setting, with the hand-written field its view gives it (custom ones always have one). */
function SettingField({ def, settings, onChange }: { def: SettingDef<Settings>; settings: Settings; onChange: Change }) {
  const Field = views.settingsCards.fields[def.id];
  if (Field) return <Field def={def} settings={settings} onChange={onChange} />;
  return def.kind === 'custom' ? null : <SettingRow def={def} settings={settings} onChange={onChange} />;
}

/** The setting `id` as a row; nothing when it is not registered. */
function SettingFieldById({ id, settings, onChange }: { id: string; settings: Settings; onChange: Change }) {
  const def = settingsRegistry.setting(id);
  return def ? <SettingField def={def} settings={settings} onChange={onChange} /> : null;
}

/** Schema settings as one card of rows (search results, sections with no screen of their own). */
const groupIds = (group: string) => settingsRegistry.settingsIn([group]).filter((d) => d.id.startsWith(`${group}.`)).map((d) => d.id);

function SettingRows({ ids, settings, onChange }: { ids: string[]; settings: Settings; onChange: Change }) {
  return (
    <section className="section">
      <div className="card form">
        {ids.map((id) => <SettingField key={id} def={settingsRegistry.setting(id)!} settings={settings} onChange={onChange} />)}
      </div>
    </section>
  );
}

// What ArrowDown in the search box focuses first.
const CONTROLS = 'input, select, textarea, button';

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ');

function GeneralSection({ settings, onChange, onQuit }: Props) {
  return (
    <>
      <div className="card form">
        <label className="field">
          <span className="mono-label">{t('settings.language')}</span>
          <select value={settings.language ?? detectLanguage()} onChange={(e) => onChange({ language: e.target.value as Language })}>
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <Row id="general.autostart" settings={settings} onChange={onChange} />
        <Row id="general.closeToTray" settings={settings} onChange={onChange} />
        <Row id="general.port" settings={settings} onChange={onChange} />
        <Row id="general.rememberSettingsPage" settings={settings} onChange={onChange} />
        <Row id="general.confirmCloseDirty" settings={settings} onChange={onChange} />
        <Row id="general.toastDuration" settings={settings} onChange={onChange} />
        <Row id="general.browser" settings={settings} onChange={onChange} />
        <Row id="general.startScreen" settings={settings} onChange={onChange} />
      </div>
      {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
    </>
  );
}

/** Every command of the app, with the keys the user can change; a change applies at once. It has its own filter. */
function ShortcutsSection({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const keys = useKeybindings();
  if (!keys) return null;
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : views.has(scope) ? views.label(scope) : t('nav.home'));
  return <KeybindingsEditor defs={keys.defs} keymap={settings.keybindings ?? {}} onChange={(keybindings) => onChange({ keybindings })} scopeLabel={scopeLabel} />;
}


/** Saving text files, like VS Code's `files.*` settings; the Explorer's file tabs read them. */
function EditorCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.saving')}</h4>
      <div className="card form">
        <Row id="files.autoSave" settings={settings} onChange={onChange} />
        <Row id="files.trimTrailingWhitespace" settings={settings} onChange={onChange} />
        <Row id="files.insertFinalNewline" settings={settings} onChange={onChange} />
      </div>
    </section>
  );
}

/**
 * Where closing the window doesn't stop the app: browser and app mode, and with the tray (the
 * setting, which applies after a restart; until then the tray menu or the close button quits).
 */
function GeneralCard({ onQuit }: { onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const quit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { ok } = await api.quit();
      if (ok) onQuit();
      else setBusy(false);
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="card form">
        <div className="field">
          <div className="row">
            <Button size="sm" variant="danger" icon="square" title={t('settings.quit')} disabled={busy} onClick={quit}>
              {t('settings.quit')}
            </Button>
          </div>
          <span className="muted">{t(isDesktop ? 'settings.quit.hintTray' : 'settings.quit.hint', { name: APP.name })}</span>
        </div>
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

const ASSOCIATION_TARGETS = ['log', 'txt', 'json', 'md', 'sql', 'xml', 'yaml', 'properties', 'csv', 'html', 'js', 'java', 'sh', 'env', 'zip'] as const;

/** Name patterns opened as another file type; a row applies once its pattern is valid. */
function FileTypesCard({ value, onChange }: { value: FileAssociation[]; onChange: (next: FileAssociation[]) => void }) {
  const [rows, setRows] = useState<FileAssociation[]>(value);
  const update = (next: FileAssociation[]) => {
    setRows(next);
    const valid = validFileAssociations(next.filter((r) => r.pattern.trim()));
    if (valid) onChange(valid);
  };
  const targetLabel = (as: string) => (ASSOCIATION_TARGETS.includes(as as never) ? t(`settings.files.as.${as}` as MessageKey) : `.${as}`);
  return (
    <section className="section">
      <div className="card form">
        <span className="muted">{t('settings.files.hint')}</span>
        {rows.length === 0 && <span className="muted">{t('settings.files.empty')}</span>}
        {rows.map((row, i) => (
          <div key={i} className="row">
            <input
              value={row.pattern}
              placeholder="*.log.*"
              aria-label={t('settings.files.pattern')}
              spellCheck={false}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)))}
            />
            <select value={row.as} aria-label={t('settings.files.as')} onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, as: e.target.value } : r)))}>
              {!ASSOCIATION_TARGETS.includes(row.as as never) && <option value={row.as}>{targetLabel(row.as)}</option>}
              {ASSOCIATION_TARGETS.map((as) => <option key={as} value={as}>{targetLabel(as)}</option>)}
            </select>
            <Button size="xs" variant="ghost" icon="trash" title={t('settings.files.remove')} onClick={() => update(rows.filter((_, j) => j !== i))}>{t('settings.files.remove')}</Button>
          </div>
        ))}
        <div className="row">
          <Button size="sm" icon="plus" title={t('settings.files.add')} onClick={() => setRows([...rows, { pattern: '', as: 'log' }])}>{t('settings.files.add')}</Button>
        </div>
      </div>
    </section>
  );
}

function EditorsCard() {
  const state = useAsync(() => api.editors(), []);
  const [list, setList] = useState<EditorInfo[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async (job: () => Promise<EditorInfo[]>) => {
    setBusy(true);
    setError(null);
    try {
      setList(await job());
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const editors = list ?? state.data;
  return (
    <section className="section">
      <div className="card form">
        {!editors && !state.error && <Spinner small />}
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} compact />}
        {editors && (
          <div className="editors">
            {editors.map((editor) => (
              <Fragment key={editor.id}>
                <span className="mono-label">{editor.name}</span>
                <span className="mono editor-path">{editor.path ?? t('settings.editors.notFound')}</span>
                <Button size="sm" title={t('settings.editors.choose')} disabled={busy} onClick={() => run(async () => {
                  const path = await dialogs.pickFile({
                    title: `${t('settings.editors.choose')} (${editor.name})`,
                    purpose: 'editor',
                    filters: /windows/i.test(navigator.userAgent) ? [{ name: 'Programs', patterns: ['*.exe'] }] : undefined,
                  });
                  return path === null ? editors : api.pickEditor(editor.id, path);
                })}>
                  {t('settings.editors.choose')}
                </Button>
                {editor.custom ? (
                  <Button size="sm" variant="ghost" icon="rotate-ccw" title={t('settings.editors.reset')} disabled={busy} onClick={() => run(() => api.resetEditor(editor.id))}>
                    {t('settings.editors.reset')}
                  </Button>
                ) : (
                  <span />
                )}
              </Fragment>
            ))}
          </div>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

function UpdatesCard() {
  const info = useAsync(() => api.info(), []);
  const i = info.data;
  return (
    <section className="section">
      <div className="card form">
        {!i && !info.error && <Spinner small />}
        {info.error && <ErrorBanner error={info.error} onRetry={info.reload} compact />}
        {i && (
          <div className="field">
            <span>{t('settings.update.current', { version: i.version })}</span>
            <span className="muted">{t('settings.update.howTo')}</span>
            {i.repo && (
              <div className="row">
                <Button size="sm" icon="download" onClick={() => window.open(`https://github.com/${i.repo}/releases`, '_blank', 'noreferrer')}>
                  {t('settings.update.openReleases')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const STORE_LABELS:Record<string, MessageKey> = {
  projects: 'settings.backup.store.projects',
  dbConnections: 'settings.backup.store.dbConnections',
  requests: 'settings.backup.store.requests',
};
const storeLabel = (name: string) => (Object.hasOwn(STORE_LABELS, name) ? t(STORE_LABELS[name]!) : name);

const toggled = (list: string[], name: string) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);

type Inspected = Extract<BackupInfo, { token: string }>;
type Imported = { settings: boolean; stores: Record<string, ImportResult> };

function BackupCard({ onSettings }: { onSettings: (settings: Settings) => void }) {
  const parts = useAsync(() => api.backupParts(), []);
  const [settings, setSettings] = useState(true);
  const [stores, setStores] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);

  const chosen = stores ?? parts.data?.stores ?? [];
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="card form">
        {!parts.data && !parts.error && <Spinner small />}
        {parts.error && <ErrorBanner error={parts.error} onRetry={parts.reload} compact />}
        {parts.data && (
          <div className="field">
            <span className="mono-label">{t('settings.backup.parts')}</span>
            <div className="chips">
              <button title={t('settings.backup.settings')} className={`chip${settings ? ' chip-on' : ''}`} onClick={() => setSettings(!settings)}>
                {t('settings.backup.settings')}
              </button>
              {parts.data.stores.map((name) => (
                <button key={name} title={storeLabel(name)} className={`chip${chosen.includes(name) ? ' chip-on' : ''}`} onClick={() => setStores(toggled(chosen, name))}>
                  {storeLabel(name)}
                </button>
              ))}
            </div>
            <span className="muted">{t('settings.backup.hint')}</span>
            <div className="row">
              <Button size="sm" icon="download" title={t('settings.backup.export')}
                disabled={busy || (!settings && chosen.length === 0)}
                onClick={() => run(async () => {
                  const d = new Date();
                  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  const target = await dialogs.saveAs({
                    title: t('settings.backup.export'),
                    purpose: 'backup',
                    suggestedName: `${APP.id}-backup-${day}.json`,
                    filters: [{ name: 'JSON', patterns: ['*.json'] }],
                  });
                  if (target !== null) setSaved((await api.exportBackup(settings, chosen, target)).path);
                })}
              >
                {t('settings.backup.export')}
              </Button>
              <Button size="sm" icon="download" title={t('settings.backup.import')}
                disabled={busy}
                onClick={() => run(async () => {
                  const path = await dialogs.pickFile({ title: t('settings.backup.import'), purpose: 'backup', filters: [{ name: 'JSON', patterns: ['*.json'] }] });
                  if (path === null) return;
                  const info = await api.inspectBackup(path);
                  if (info.token !== null) setInspected(info);
                })}
              >
                {t('settings.backup.import')}
              </Button>
            </div>
            {saved && <span className="muted">{t('settings.backup.saved', { path: saved })}</span>}
          </div>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
      {inspected && <ImportDialog info={inspected} onSettings={onSettings} onClose={() => setInspected(null)} />}
    </section>
  );
}

function ImportDialog({ info, onSettings, onClose }: { info: Inspected; onSettings: (settings: Settings) => void; onClose: () => void }) {
  const [settings, setSettings] = useState(info.settings);
  const [stores, setStores] = useState(info.stores.filter((s) => s.known).map((s) => s.name));
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Imported | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api.importBackup(info.token, settings, stores, mode);
      setResult(done);
      if (done.settings) onSettings(await api.settings());
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
    <Button variant="primary" title={t('settings.backup.close')} onClick={onClose}>{t('settings.backup.close')}</Button>
  ) : (
    <>
      <Button title={t('dialog.cancel')} onClick={onClose}>{t('dialog.cancel')}</Button>
      <Button variant="primary" title={t('settings.backup.importNow')} disabled={busy || (!settings && stores.length === 0)} onClick={start}>
        {t('settings.backup.importNow')}
      </Button>
    </>
  );
  const date = info.exportedAt ? new Date(info.exportedAt).toLocaleString() : '?';

  return (
    <Modal title={t('settings.backup.importTitle')} onClose={onClose} footer={footer}>
      <div className="form">
        <span className="muted">{t('settings.backup.from', { date, version: info.appVersion || '?' })}</span>
        {result ? (
          <ImportSummary result={result} />
        ) : (
          <>
            <div className="field">
              <span className="mono-label">{t('settings.backup.parts')}</span>
              <div className="chips">
                {info.settings && (
                  <button title={t('settings.backup.settings')} className={`chip${settings ? ' chip-on' : ''}`} onClick={() => setSettings(!settings)}>
                    {t('settings.backup.settings')}
                  </button>
                )}
                {info.stores.map((s) => (
                  <button
                    key={s.name}
                    className={`chip${stores.includes(s.name) ? ' chip-on' : ''}`}
                    disabled={!s.known}
                    title={s.known ? undefined : t('settings.backup.unknown')}
                    onClick={() => setStores(toggled(stores, s.name))}
                  >
                    {storeLabel(s.name)} ({s.count})
                  </button>
                ))}
              </div>
              {info.stores.some((s) => !s.known) && <span className="muted">{t('settings.backup.unknownHint')}</span>}
            </div>
            <div className="field">
              <span className="mono-label">{t('settings.backup.mode')}</span>
              <div className="chips">
                {(['merge', 'replace'] as const).map((m) => (
                  <button key={m} title={t(m === 'merge' ? 'settings.backup.merge' : 'settings.backup.replace')} className={`chip${mode === m ? ' chip-on' : ''}`} onClick={() => setMode(m)}>
                    {t(m === 'merge' ? 'settings.backup.merge' : 'settings.backup.replace')}
                  </button>
                ))}
              </div>
              <span className="muted">{t(mode === 'merge' ? 'settings.backup.merge.hint' : 'settings.backup.replace.hint')}</span>
            </div>
          </>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </Modal>
  );
}

function ImportSummary({ result }: { result: Imported }) {
  return (
    <>
      {result.settings && <span>{t('settings.backup.settingsDone')}</span>}
      {Object.entries(result.stores).map(([name, r]) => (
        <div key={name} className="field">
          <span className="mono-label">{storeLabel(name)}</span>
          <span>{t('settings.backup.counts', { added: r.added, updated: r.updated, removed: r.removed })}</span>
          {r.skipped.map((s, i) => (
            <span key={i} className="tone-err small">
              {t('settings.backup.skipped', { id: s.id ?? '?', reason: errorMessage({ kind: 'invalid', code: s.code, message: s.message }) })}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
