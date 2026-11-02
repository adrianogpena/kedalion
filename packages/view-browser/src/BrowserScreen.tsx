import { useEffect, useRef, useState } from 'react';
import type { Emulation, TabInfo } from '@kedalion/cdp';
import { Button, ContextMenu, copyNotify, IconButton, Tabs, ToolbarSep, useCommand, useViewRequest } from '@kedalion/ui';
import { browserApi } from './client';
import { BROWSER_ACTIONS, type BrowserCommandAction, browserCommandDef } from './commands';
import { ConsolePane, useBrowserLogs } from './ConsolePane';
import { CookiesPane } from './CookiesPane';
import { DevicePane } from './DevicePane';
import { copyMcpConfig, DevToolsPane, type DevToolsPosition, openDevTools, Resizer, useStoredSize } from './DevToolsPane';
import { Favorites, isEmptyTabUrl } from './Favorites';
import { NetworkPane } from './NetworkPane';
import { RulesPane } from './RulesPane';
import { StoragePane } from './StoragePane';
import { t } from './i18n';
import { normalizeAddress } from './address';
import { BrowserOverlays } from './overlays';
import { Viewport } from './Viewport';
import { useBrowserSocket } from './web/useBrowserSocket';
import './browser.css';

type DockTab = 'console' | 'network' | 'cookies' | 'storage' | 'rules' | 'device';
const DOCK_TABS: DockTab[] = ['console', 'network', 'cookies', 'storage', 'rules', 'device'];

/** The Browser view: tab strip, toolbar and the page of the active tab, driven through the server's socket. */
export function BrowserScreen({ home }: { home: string }) {
  const socket = useBrowserSocket();
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [active, setActive] = useState<string | undefined>();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const tab = tabs.find((x) => x.id === active);
  const { subscribe, send, status } = socket;
  const logs = useBrowserLogs(socket, tab?.id, tab?.url);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('console');
  const [dockHeight, setDockHeight] = useStoredSize('kedalion.browser.dockHeight', 240);
  const [devtools, setDevtools] = useState<string | null>(null);
  const [devtoolsPosition, setDevtoolsPosition] = useState<DevToolsPosition>('right');

  const [emulation, setEmulation] = useState<Emulation>({});

  useEffect(() => setDevtools(null), [active]);

  useEffect(() => {
    setEmulation({});
    if (!active) return;
    let stale = false;
    void browserApi.emulation(active).then((r) => !stale && setEmulation(r.emulation)).catch(() => {});
    return () => {
      stale = true;
    };
  }, [active]);

  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type === 'emulation' && msg.tab === active) setEmulation(msg.emulation);
      }),
    [subscribe, active],
  );

  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type !== 'tabs') return;
        setTabs(msg.tabs);
        setActive(msg.active);
      }),
    [subscribe],
  );

  const activate = (id: string) => {
    setActive(id);
    send({ type: 'activate', tab: id });
  };
  const open = async (url?: string) => {
    try {
      const { tab: created } = await browserApi.openTab(url ?? home);
      activate(created.id);
    } catch {
      // The server reports failures on the socket.
    }
  };
  const close = (id: string) => void browserApi.closeTab(id).catch(() => {});
  const go = (input: { url: string } | { action: 'back' | 'forward' | 'reload' | 'stop' }) => {
    if (tab) void browserApi.navigate(tab.id, input).catch(() => {});
  };
  const step = (delta: number) => {
    const i = tabs.findIndex((x) => x.id === active);
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    if (next) activate(next.id);
  };

  const toggleDevtools = async (forceOpen = false, panel?: string) => {
    if (!tab) return;
    if (devtools && !forceOpen) {
      setDevtools(null);
      return;
    }
    try {
      const r = await openDevTools(tab.id, panel);
      setDevtools(r.mode === 'iframe' ? r.url : null);
    } catch {
      // The request layer reports the failure.
    }
  };

  const run: Record<BrowserCommandAction, () => void> = {
    focusUrl: () => {
      urlInput.current?.focus();
      urlInput.current?.select();
    },
    newTab: () => void open(),
    closeTab: () => tab && close(tab.id),
    nextTab: () => step(1),
    prevTab: () => step(-1),
    reload: () => go({ action: 'reload' }),
    devtools: () => void toggleDevtools(),
    back: () => go({ action: 'back' }),
    forward: () => go({ action: 'forward' }),
  };
  for (const action of BROWSER_ACTIONS) useCommand(browserCommandDef(action), run[action], { enabled: action !== 'devtools' || !!tab });

  const { request, take } = useViewRequest<{ url: string }>('browser');
  useEffect(() => {
    if (!request) return;
    const { url } = take() ?? request;
    void open(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const shown = draft ?? tab?.url ?? '';
  const label = (x: TabInfo) => x.title || x.url || t('browser.tab.untitled');

  return (
    <div className="browser">
      <div className="tabbar" role="tablist" aria-label={t('browser.tabs')}>
        <div className="tabs-strip">
          {tabs.map((x) => (
            <div
              key={x.id}
              role="tab"
              aria-selected={x.id === active}
              className={`tab-chip${x.id === active ? ' active' : ''}`}
              title={x.url || label(x)}
              onClick={() => activate(x.id)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && close(x.id)}
            >
              <span className="tab-title">{label(x)}</span>
              <IconButton className="tab-close" icon="close" size="xs" label={t('browser.tab.close')} onClick={(e) => {
                e.stopPropagation();
                close(x.id);
              }} />
            </div>
          ))}
        </div>
        <IconButton className="tab-new" icon="plus" label={t('browser.tab.new')} onClick={() => void open()} />
      </div>
      <div className="browser-toolbar">
        <IconButton icon="back" label={t('browser.back')} disabled={!tab?.canGoBack} onClick={() => go({ action: 'back' })} />
        <IconButton icon="forward" label={t('browser.forward')} disabled={!tab?.canGoForward} onClick={() => go({ action: 'forward' })} />
        <IconButton
          icon={tab?.loading ? 'close' : 'refresh'}
          label={t(tab?.loading ? 'browser.stop' : 'browser.reload')}
          disabled={!tab}
          onClick={() => go({ action: tab?.loading ? 'stop' : 'reload' })}
        />
        <input
          ref={urlInput}
          className="browser-url"
          type="text"
          spellCheck={false}
          aria-label={t('browser.address')}
          placeholder={t('browser.address.placeholder')}
          disabled={!tab}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              go({ url: normalizeAddress(e.currentTarget.value) });
              setDraft(null);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        <ToolbarSep />
        <IconButton icon="code" label={t('browser.devtools')} disabled={!tab} pressed={!!devtools} onClick={() => void toggleDevtools()} />
        <IconButton icon="log" label={t('browser.panes')} disabled={!tab} pressed={dockOpen} onClick={() => setDockOpen((v) => !v)} />
        <IconButton icon="more" label={t('browser.menu')} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right, y: r.bottom });
        }} />
      </div>
      <div className="browser-body">
        <div className="browser-main">
          {status !== 'open' && <div className="browser-status">{t(status === 'connecting' ? 'browser.connecting' : 'browser.disconnected')}</div>}
          {status === 'open' && !tab && (
            <div className="browser-status">
              {t('browser.empty')} <Button size="sm" icon="plus" onClick={() => void open()}>{t('browser.tab.new')}</Button>
            </div>
          )}
          {status === 'open' && !tab && <Favorites onOpen={(url) => void open(url)} />}
          {tab && (
            <div className="browser-stage">
              <Viewport socket={socket} tab={tab.id} loading={tab.loading} pointer={pointer} {...(emulation.width && emulation.height ? { device: { w: emulation.width, h: emulation.height } } : {})} />
              {status === 'open' && isEmptyTabUrl(tab.url) && !tab.loading && <Favorites onOpen={(url) => go({ url })} />}
            </div>
          )}
          {dockOpen && tab && (
            <div className="browser-dock" style={{ height: dockHeight }}>
              <Resizer axis="y" size={dockHeight} onSize={setDockHeight} min={100} />
              <Tabs
                idPrefix="browser-dock"
                active={dockTab}
                onChange={(id) => setDockTab(id as DockTab)}
                tabs={DOCK_TABS.map((id) => ({
                  id,
                  label: id === 'console' && logs.errors ? `${t('browser.console')} (${logs.errors})` : t(`browser.dock.${id}` as const),
                }))}
              />
              <div className="browser-dock-body" role="tabpanel" id={`browser-dock-panel-${dockTab}`} aria-labelledby={`browser-dock-tab-${dockTab}`}>
                {dockTab === 'console' ? (
                  <ConsolePane key={tab.id} tab={tab.id} logs={logs} onSource={() => void toggleDevtools(true, 'sources')} />
                ) : dockTab === 'network' ? (
                  <NetworkPane key={tab.id} tab={tab.id} logs={logs} />
                ) : dockTab === 'cookies' ? (
                  <CookiesPane key={tab.id} tab={tab.id} url={tab.url} />
                ) : dockTab === 'storage' ? (
                  <StoragePane key={tab.id} tab={tab.id} url={tab.url} />
                ) : dockTab === 'rules' ? (
                  <RulesPane />
                ) : (
                  <DevicePane key={tab.id} tab={tab.id} emulation={emulation} />
                )}
              </div>
            </div>
          )}
          {devtools && devtoolsPosition === 'bottom' && (
            <DevToolsPane url={devtools} position="bottom" onPosition={setDevtoolsPosition} onClose={() => setDevtools(null)} />
          )}
        </div>
        {devtools && devtoolsPosition === 'right' && (
          <DevToolsPane url={devtools} position="right" onPosition={setDevtoolsPosition} onClose={() => setDevtools(null)} />
        )}
      </div>
      <BrowserOverlays socket={socket} pointer={pointer} />
      {menu && (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { id: 'external', label: t('browser.menu.external'), icon: 'popout', disabled: !tab, run: () => tab && void browserApi.openExternal(tab.url).catch(() => {}) },
            { id: 'copy', label: t('browser.menu.copyUrl'), icon: 'copy', disabled: !tab, run: () => tab && void copyNotify(tab.url) },
            'sep',
            { id: 'home', label: t('browser.menu.home'), icon: 'plus', run: () => void open() },
            { id: 'mcp', label: t('browser.menu.copyMcp'), icon: 'copy', run: () => void copyMcpConfig() },
          ]}
        />
      )}
    </div>
  );
}
