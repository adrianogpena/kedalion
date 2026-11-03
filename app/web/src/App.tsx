import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PALETTES } from '@kedalion/server-core/palettes';
import { CommandPalette, DEFAULT_LINK_SETTINGS, installLinkRouter, LinkContextMenu, type LinkTarget, DialogHost, detectLanguage, effectiveKeys, ErrorBanner, GLOBAL, AppFrame, IconButton, isDesktop, KeybindingProvider, LayoutProvider, type PaletteItem, popOut, popoutView, usePopouts,setFileAssociations, setLanguage, setViewTitle, Sidebar, Spinner, titleWithBadge, ToastProvider, type ApiError, errorMessage, errorOf, useToast, useAsync, useCommand, useCommandPalette, useHashRoute, useHeartbeat, useKeybindings, useRunCommand, useTheme, useTitleBadge,useViewTitle,useZen, useZoom, DesignSwitcher, useDesignLayout, useBridge, CommandBar, ActivityStrip, useDossier, chapterOfScreen, DossierChapterPage } from '@kedalion/ui';
import { EditorOptionsContext } from '@kedalion/editor/options';
import { APP } from '../../app';
import { api, type Settings } from './api';
import { commandById, commands, KEYS_COMMAND, navCommandId, POPOUT_COMMAND, SETTINGS_COMMAND } from './commands';
import { type MessageKey, t } from './i18n';
import { appearanceSettingsOf, editorSettingsOf, generalSettingsOf, keyboardSettingsOf, linkSettingsOf, windowSettingsOf } from './settings';
import { SettingsModal, viewSettingsSection } from './screens/SettingsModal';
import { views, type ScreenId } from './views';

// Retrying can't revive a used launch code or a stale token; the user has to open the app again.
const SESSION_ERRORS = ['invalidCode', 'invalidToken'];

// Settings is a full page in the content area over the current screen (kept mounted), not a screen; 'keys' opens it at Keyboard › Shortcuts. App links
// (toasts, second instances) still open them with `#/settings` and `#/keys`; `#/settings/<section key>` opens a section.
type Overlay = 'settings' | 'keys' | `settings/${string}`;
const overlayOfHash = (): Overlay | null => {
  const m = /^#\/?(settings|keys)(?:\/([\w.-]+))?\/?$/.exec(window.location.hash);
  if (!m) return null;
  return m[1] === 'settings' && m[2] ? `settings/${m[2]}` : (m[1] as Overlay);
};

/** Loads the settings first, so the first paint already has the right theme and language. */
export function App() {
  const boot = useAsync(() => api.settings(), []);
  if (boot.data?.language) setLanguage(boot.data.language);

  if (boot.error) {
    return <div className="boot"><ErrorBanner error={boot.error} onRetry={SESSION_ERRORS.includes(boot.error.code ?? '') ? undefined : boot.reload} /></div>;
  }
  if (!boot.data) {
    return <div className="boot"><Spinner /> <span className="muted">{t('common.loading')}</span></div>;
  }
  return <Shell initialSettings={boot.data} />;
}

function Shell({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [overlay, setOverlay] = useState(overlayOfHash);
  const shown = useRef<ScreenId>('dashboard');
  // Before useHashRoute, so this listener runs first: it puts the shown screen back in the hash for the router.
  useEffect(() => {
    const take = () => {
      const open = overlayOfHash();
      if (!open) return;
      window.history.replaceState(null, '', `#/${shown.current}`);
      setOverlay(open);
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);
  const pv = popoutView() as ScreenId | undefined;
  const [routed, rawGo] = useHashRoute(views.ids, generalSettingsOf(settings).startScreen as ScreenId);
  const screen = pv && views.has(pv) ? pv : routed;
  const go = useCallback((id: ScreenId) => { if (!pv || id === pv) rawGo(id); }, [pv, rawGo]);
  shown.current = screen;
  setLanguage(settings.language ?? detectLanguage());
  setFileAssociations(settings.fileAssociations);
  return (
    <KeybindingProvider defs={commands(views)} keymap={settings.keybindings ?? {}} scope={screen} sequenceTimeout={keyboardSettingsOf(settings).chordTimeout}>
      <Main settings={settings} setSettings={setSettings} screen={screen} go={go} overlay={overlay} setOverlay={setOverlay} />
    </KeybindingProvider>
  );
}

interface MainProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  screen: ScreenId;
  go: (screen: ScreenId) => void;
  overlay: Overlay | null;
  setOverlay: (overlay: Overlay | null) => void;
}

function Main({ settings: saved, setSettings, screen, go, overlay, setOverlay }: MainProps) {
  const designLayout = useDesignLayout();
  const settings = useMemo(() => (designLayout === 'current' ? saved : { ...saved, layout: designLayout }), [saved, designLayout]);
  const [stopped, setStopped] = useState(false);
  useHeartbeat();
  const palette = useCommandPalette();
  const shellBridge = useBridge(settings.layout);
  const shellDossier = useDossier(settings.layout).active;

  const { kind } = useTheme(settings);
  useZoom(settings.zoom);
  const appearance = appearanceSettingsOf(settings);
  const editorOptions = useMemo(() => editorSettingsOf(settings), [settings.editor]);
  const windowOptions = useMemo(() => windowSettingsOf(settings), [settings.window]);
  const general = useMemo(() => generalSettingsOf(settings), [settings.general]);

  useEffect(() => {
    const root = document.documentElement;
    const set = (name: string, value: string | undefined) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
    set('--font-sans', appearance.uiFontFamily.trim());
    set('--font-mono', appearance.editorFontFamily.trim());
    set('--editor-font-size', appearance.editorFontSize ? `${appearance.editorFontSize}px` : undefined);
    set('--editor-line-height', appearance.editorLineHeight ? String(appearance.editorLineHeight) : undefined);
    set('--editor-ligatures', appearance.editorLigatures ? 'normal' : 'none');
    root.dataset.reduceMotion = String(appearance.reduceMotion);
  }, [appearance.uiFontFamily, appearance.editorFontFamily, appearance.editorFontSize, appearance.editorLineHeight, appearance.editorLigatures, appearance.reduceMotion]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.tabSizing = windowOptions.tabSizing;
    root.dataset.tabClose = windowOptions.tabCloseButton;
    root.dataset.tabIcons = String(windowOptions.tabIcons);
    root.dataset.statusBar = String(windowOptions.statusBar);
  }, [windowOptions]);

  const inPopout = popoutView() !== undefined;
  const popouts = usePopouts();

  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  useEffect(
    () =>
      installLinkRouter({
        settings: () => (latestSettings.current.links ? linkSettingsOf(latestSettings.current) : DEFAULT_LINK_SETTINGS),
        open: (url, target) => {
          if (target === 'internal' && !inPopout) views.link('browser', { url });
          else api.openExternal(url).catch(() => {});
        },
      }),
    [inPopout],
  );
  const openLink = useCallback(
    (url: string, target: LinkTarget) => {
      if (target === 'internal' && !inPopout) views.link('browser', { url });
      else api.openExternal(url).catch(() => {});
    },
    [inPopout],
  );
  const popped = popouts.views;
  const titleBadge = useTitleBadge();
  const viewTitle = useViewTitle();
  useEffect(() => { setViewTitle(undefined); }, [screen]);
  useEffect(() => {
    if (inPopout && views.has(screen)) { document.title = titleWithBadge(viewTitle ?? views.label(screen), titleBadge); return; }
    const base = viewTitle ? `${viewTitle} — ${APP.name}` : views.has(screen) ? `${views.label(screen)} · ${APP.name}` : APP.name;
    document.title = titleWithBadge(base, titleBadge);
  }, [screen, settings.language, titleBadge, viewTitle]);

  /** A save the server rejected as invalid (e.g. a hook command not allowed); shown once, then the stored settings come back. */
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  /** Saves at once; resolves to the error when the server rejected the patch as invalid (the stored settings come back), else null. */
  const saveSeq = useRef(0);
  const save = useCallback((patch: Partial<Settings>): Promise<ApiError | null> => {
    const seq = ++saveSeq.current;
    setSettings((s) => ({ ...s, ...patch }));
    return api.saveSettings(patch).then(
      () => null,
      (e: unknown) => {
        const err = errorOf(e);
        if (err.kind !== 'invalid') return null; // preferences are best-effort
        setSaveError(err);
        // A save started after this one wins: its change must not be overwritten by this rollback.
        api.settings().then((s) => { if (saveSeq.current === seq) setSettings(s); }, () => {});
        return err;
      },
    );
  }, []);
  /** Takes settings already stored on the server (external edit, backup import) as they are: no merge, no save. */
  const replace = useCallback((next: Settings) => setSettings(next), []);

  const navItems = views.nav.flatMap((s) => s.items);
  // The nav list is a constant, so the hooks run in the same order every render.
  const firstFree = (skip?: string) => navItems.find((i) => i.id !== skip && !popped.has(i.id))?.id;
  const goView = (id: ScreenId) => {
    if (popped.has(id)) void popOut(id, views.label(id));
    else {
      setOverlay(null);
      go(id);
    }
  };
  const popOutShown = () => {
    void popOut(screen, views.label(screen)).then((ok) => {
      const free = ok ? firstFree(screen) : undefined;
      if (free) go(free);
    });
  };
  // A view popped out elsewhere (or a hash pointing at one) leaves the main window.
  useEffect(() => {
    if (inPopout || !popped.has(screen)) return;
    const free = firstFree();
    if (free) go(free);
  }, [popped, screen, inPopout]);
  for (const item of navItems) useCommand(commandById(navCommandId(item.id)), () => goView(item.id), { enabled: !inPopout });
  useCommand(commandById(SETTINGS_COMMAND), () => setOverlay('settings'));
  useCommand(commandById(KEYS_COMMAND), () => { if (!inPopout) setOverlay('keys'); });
  useCommand(commandById(POPOUT_COMMAND), popOutShown, { enabled: !inPopout && popouts.supported });
  const zen = useZen();
  const keys = useKeybindings();
  const runCommand = useRunCommand();
  const chordOf = (id: string) => (keys ? effectiveKeys(keys.defs, keys.keymap).get(id)?.[0] : undefined);

  const quit = useCallback(() => { api.quit().then(({ ok }) => { if (ok) setStopped(true); }).catch(() => { /* already gone */ }); }, []);
  const nextTheme = kind === 'dark' ? 'light' : 'dark';
  const items = useMemo<PaletteItem[]>(() => {
    const goTo = inPopout ? [] : navItems.map((i): PaletteItem => ({
      id: `go:${i.id}`, group: t('palette.group.go'), label: views.label(i.id), hint: chordOf(navCommandId(i.id)), keywords: [i.id], run: () => goView(i.id),
    }));
    const overlays: PaletteItem[] = [
      { id: 'app:settings', group: t('palette.group.go'), label: t('nav.settings'), hint: chordOf(SETTINGS_COMMAND), keywords: ['settings', 'preferences'], run: () => setOverlay('settings') },
      ...(inPopout ? [] : [{ id: 'app:keys', group: t('palette.group.go'), label: t('nav.keys'), hint: chordOf(KEYS_COMMAND), keywords: ['keybindings', 'shortcuts', 'keys'], run: () => setOverlay('keys') }]),
    ];
    const toggle: PaletteItem = {
      id: 'theme:toggle', group: t('palette.group.theme'), label: t(`nav.theme.${nextTheme}`), keywords: ['theme', 'dark', 'light'],
      run: () => save({ theme: nextTheme }),
    };
    const palettes = PALETTES.map((p): PaletteItem => ({
      id: `palette:${p.id}`, group: t('palette.group.theme'), label: t('palette.theme', { name: p.label }), keywords: ['theme', p.family, p.kind],
      run: () => save({ theme: p.kind, ...(p.kind === 'dark' ? { paletteDark: p.id } : { paletteLight: p.id }) }),
    }));
    const quitItem: PaletteItem[] = isDesktop ? [] : [{
      id: 'app:quit', group: t('palette.group.app'), label: t('palette.quit', { name: APP.name }), keywords: ['quit', 'exit', 'stop'], run: quit,
    }];
    const viewItems = (keys?.defs ?? []).filter((d) => d.scope === keys!.scope && d.scope !== GLOBAL).map((d): PaletteItem => ({
      id: `cmd:${d.id}`, group: views.label(keys!.scope), label: d.label, hint: chordOf(d.id), keywords: [d.id], run: () => void runCommand(d.id),
    }));
    return [...goTo, ...overlays, ...viewItems, toggle, ...palettes, ...quitItem];
  }, [go, save, quit, nextTheme, settings.language, keys, setOverlay, inPopout, popped]);

  if (stopped) return <div className="boot"><span>{t('app.stopped', { name: APP.name })}</span></div>;

  const sections = views.nav.map((s) => ({
    title: t(s.group as MessageKey),
    items: s.items.map((i) => ({ ...i, label: views.label(i.id), hint: chordOf(navCommandId(i.id)) })),
  }));
  const settingsChord = chordOf(SETTINGS_COMMAND);
  const settingsTitle = settingsChord ? `${t('nav.settings')} (${settingsChord})` : t('nav.settings');

  const popOutChord = chordOf(POPOUT_COMMAND);
  const popOutTitle = popOutChord ? `${t('window.popOut')} (${popOutChord})` : t('window.popOut');
  const gear = (
    <IconButton icon="settings" label={settingsTitle} pressed={!!overlay} onClick={() => setOverlay('settings')} />
  );
  const footer = (
    <>
      {popouts.supported && !inPopout && (
        <IconButton icon="popout" label={popOutTitle} onClick={() => void runCommand(POPOUT_COMMAND)} />
      )}
      {gear}
      <IconButton icon="search" label={t('nav.palette')} onClick={() => palette.setOpen(true)} />
    </>
  );
  const popoutTools = viewSettingsSection(screen) ? gear : undefined;

  const bridge = shellBridge && !inPopout;
  const sidebarNode = inPopout ? undefined : <Sidebar name={APP.name} sections={sections} current={screen} onSelect={goView} footer={footer} popped={popped as ReadonlySet<ScreenId>} poppedHint={t('window.poppedHint')} />;
  const viewProps = { settings, onSave: save, go: go as (id: string) => void };
  // Dossier: the Requests chapter shows both of its screens on one page; the pane in use is the current screen.
  const chapter = shellDossier && !inPopout ? chapterOfScreen(screen) : undefined;
  const pair = chapter?.id === 'requests' ? chapter.screens.filter((id) => views.has(id) && !(popped as ReadonlySet<string>).has(id)) : [];
  const screenNode = pair.length === 2
    ? <DossierChapterPage chapter="requests" current={screen} onFocusPane={(id) => goView(id as ScreenId)} panes={pair.map((id) => ({ id, label: views.label(id as ScreenId), node: views.render(id, viewProps) }))} />
    : views.render(screen, viewProps);
  const mainNode = (
    <main className="main">
      <div className="main-view" data-link-scope={`view:${screen}`} hidden={!!overlay}>{screenNode}</div>
      {overlay && (
        <SettingsModal key={overlay} settings={settings} onChange={save} onReplace={replace} onQuit={() => setStopped(true)} onClose={() => setOverlay(null)} onlyView={inPopout ? screen : undefined} initialSection={inPopout ? undefined : overlay === 'keys' ? 'keyboard.shortcuts' : overlay.startsWith('settings/') ? overlay.slice('settings/'.length) : undefined} />
      )}
    </main>
  );
  const frameSidebar = bridge
    ? <CommandBar name={APP.name} items={navItems.map((i) => ({ id: i.id, label: views.label(i.id), icon: i.icon }))} current={screen} onSelect={(id) => goView(id as ScreenId)} onSearch={() => palette.setOpen(true)} tools={footer} />
    : sidebarNode;
  const frameBody = bridge
    ? <div className="design-a-body">{mainNode}<ActivityStrip /></div>
    : mainNode;

  return (
    <LayoutProvider layout={settings.layout} icons={settings.icons} mainMenu={settings.mainMenu} dock={settings.dock}>
    <ToastProvider defaultTimeout={general.toastDuration}>
      <DialogHost />
      <LinkContextMenu open={openLink} />
      <SaveErrorToast error={saveError} onShown={() => setSaveError(null)} />
      <EditorOptionsContext.Provider value={editorOptions}>
      <views.Providers settings={settings} go={go as (id: string) => void}>
      <AppFrame
        zen={zen}
        popout={inPopout}
        tools={inPopout ? popoutTools : footer}
        sidebar={frameSidebar}
      >
        {frameBody}
        <DesignSwitcher views={['shell', 'dashboard', 'explorer', 'git', 'workbench', 'rest', 'terminal']} />
        {palette.open && <CommandPalette items={items} initialQuery={palette.initialQuery} onClose={() => palette.setOpen(false)} />}
      </AppFrame>
      </views.Providers>
      </EditorOptionsContext.Provider>
    </ToastProvider>
    </LayoutProvider>
  );
}

function SaveErrorToast({ error, onShown }: { error: ApiError | null; onShown: () => void }) {
  const toast = useToast();
  useEffect(() => {
    if (!error) return;
    toast({ message: errorMessage(error), kind: 'error' });
    onShown();
  }, [error, toast, onShown]);
  return null;
}
