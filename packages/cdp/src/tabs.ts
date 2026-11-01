import type { CdpClient, CdpSession } from './client.ts';

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  openerId?: string;
}

export type TabsEvent = 'tab' | 'closed' | 'activated';

export interface TabsOptions {
  /** Called once per attached tab, before the tab is announced. */
  onAttach?: (id: string, session: CdpSession) => void | Promise<void>;
}

export interface BrowserTabs {
  list(): TabInfo[];
  open(url: string, opts?: { activate?: boolean }): Promise<TabInfo>;
  close(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  back(id: string): Promise<void>;
  forward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  session(id: string): CdpSession;
  active(): string | undefined;
  on(event: 'tab', cb: (tab: TabInfo) => void): () => void;
  on(event: 'closed' | 'activated', cb: (id: string) => void): () => void;
}

interface Tab {
  info: TabInfo;
  sessionId: string;
}

const ENABLE = ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'DOM.enable'];

export async function createTabs(client: CdpClient, opts: TabsOptions = {}): Promise<BrowserTabs> {
  const tabs = new Map<string, Tab>();
  const bySession = new Map<string, Tab>();
  const attaching = new Map<string, Promise<Tab | undefined>>();
  const handlers: Record<string, Set<(arg: any) => void>> = { tab: new Set(), closed: new Set(), activated: new Set() };
  let activeId: string | undefined;

  const emit = (event: TabsEvent, arg: unknown) => {
    for (const cb of [...handlers[event]!]) cb(arg);
  };
  const get = (id: string): Tab => {
    const tab = tabs.get(id);
    if (!tab) throw new Error(`Unknown tab ${id}`);
    return tab;
  };
  const snapshot = (tab: Tab): TabInfo => ({ ...tab.info });

  const refreshHistory = async (tab: Tab) => {
    try {
      const h = await client.send('Page.getNavigationHistory', undefined, tab.sessionId);
      tab.info.canGoBack = h.currentIndex > 0;
      tab.info.canGoForward = h.currentIndex < h.entries.length - 1;
    } catch {
      return;
    }
    emit('tab', snapshot(tab));
  };

  const setActive = (id: string | undefined) => {
    if (activeId === id) return;
    activeId = id;
    if (id) emit('activated', id);
  };

  const attach = (targetInfo: any): Promise<Tab | undefined> => {
    const id: string = targetInfo.targetId;
    if (targetInfo.type !== 'page') return Promise.resolve(undefined);
    const existing = attaching.get(id);
    if (existing) return existing;
    const p = (async () => {
      const { sessionId } = await client.send('Target.attachToTarget', { targetId: id, flatten: true });
      const tab: Tab = {
        sessionId,
        info: {
          id,
          url: targetInfo.url ?? '',
          title: targetInfo.title ?? '',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          ...(targetInfo.openerId ? { openerId: targetInfo.openerId } : {}),
        },
      };
      tabs.set(id, tab);
      bySession.set(sessionId, tab);
      await Promise.all(ENABLE.map((m) => client.send(m, {}, sessionId).catch(() => undefined)));
      await opts.onAttach?.(id, client.session(sessionId));
      await refreshHistory(tab);
      emit('tab', snapshot(tab));
      if (!activeId || targetInfo.openerId) setActive(id);
      return tab;
    })().catch(() => {
      attaching.delete(id);
      return undefined;
    });
    attaching.set(id, p);
    return p;
  };

  const remove = (id: string) => {
    attaching.delete(id);
    const tab = tabs.get(id);
    if (!tab) return;
    tabs.delete(id);
    bySession.delete(tab.sessionId);
    emit('closed', id);
    if (activeId === id) {
      activeId = undefined;
      const next = [...tabs.keys()].pop();
      if (next) setActive(next);
    }
  };

  const update = (sessionId: string | undefined, patch: Partial<TabInfo>, history = false) => {
    const tab = sessionId ? bySession.get(sessionId) : undefined;
    if (!tab) return;
    Object.assign(tab.info, patch);
    emit('tab', snapshot(tab));
    if (history) void refreshHistory(tab);
  };

  client.on('Target.targetCreated', (p) => void attach(p.targetInfo));
  client.on('Target.targetInfoChanged', (p) => {
    const tab = tabs.get(p.targetInfo.targetId);
    if (!tab) return;
    tab.info.url = p.targetInfo.url;
    tab.info.title = p.targetInfo.title;
    emit('tab', snapshot(tab));
  });
  client.on('Target.targetDestroyed', (p) => remove(p.targetId));
  client.on('Page.frameStartedLoading', (_p, sid) => update(sid, { loading: true }));
  client.on('Page.frameStoppedLoading', (_p, sid) => update(sid, { loading: false }, true));
  client.on('Page.frameNavigated', (p, sid) => {
    if (p.frame?.parentId) return;
    update(sid, { url: p.frame.url }, true);
  });
  client.on('Page.navigatedWithinDocument', (p, sid) => update(sid, { url: p.url }, true));

  await client.send('Target.setDiscoverTargets', { discover: true });
  await Promise.all([...attaching.values()]);

  const step = async (id: string, delta: number) => {
    const tab = get(id);
    const h = await client.send('Page.getNavigationHistory', undefined, tab.sessionId);
    const entry = h.entries[h.currentIndex + delta];
    if (entry) await client.send('Page.navigateToHistoryEntry', { entryId: entry.id }, tab.sessionId);
  };

  const api: BrowserTabs = {
    list: () => [...tabs.values()].map(snapshot),
    active: () => activeId,
    async open(url, o = {}) {
      const { targetId } = await client.send('Target.createTarget', { url });
      let tab = await attach({ targetId, type: 'page', url });
      if (!tab) tab = tabs.get(targetId);
      if (!tab) throw new Error('Could not open the tab');
      if (o.activate !== false) await api.activate(targetId);
      return snapshot(tab);
    },
    async close(id) {
      get(id);
      await client.send('Target.closeTarget', { targetId: id });
      remove(id);
    },
    async activate(id) {
      get(id);
      await client.send('Target.activateTarget', { targetId: id });
      setActive(id);
    },
    async navigate(id, url) {
      await client.send('Page.navigate', { url }, get(id).sessionId);
    },
    back: (id) => step(id, -1),
    forward: (id) => step(id, 1),
    async reload(id) {
      await client.send('Page.reload', {}, get(id).sessionId);
    },
    async stop(id) {
      await client.send('Page.stopLoading', {}, get(id).sessionId);
    },
    session: (id) => client.session(get(id).sessionId),
    on(event: TabsEvent, cb: (arg: any) => void) {
      handlers[event]!.add(cb);
      return () => {
        handlers[event]!.delete(cb);
      };
    },
  };
  return api;
}
