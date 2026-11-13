import { mkdirSync } from 'node:fs';
import { copyFile, link, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import {
  answerDialog,
  applyEmulation,
  isLocalHost,
  watchCertificateErrors,
  type BrowserTabs,
  type CdpClient,
  type CdpSession,
  chooseOption,
  clearSiteData,
  clearStorage,
  connectCdp,
  type ConsoleLog,
  type CookieInput,
  createConsoleLog,
  createInterceptor,
  createNetworkLog,
  createTabs,
  deleteIndexedDb,
  type Emulation,
  getStorageItems,
  type Interceptor,
  type InterceptRule,
  type LaunchedBrowser,
  launchBrowser,
  listIndexedDb,
  mapInput,
  type NetworkDetail,
  type NetworkLog,
  originOf,
  removeStorageItem,
  selectAt,
  setCookie,
  setFiles,
  setStorageItem,
  startScreencast,
  type StorageItem,
  type StorageKind,
  type TabInfo,
  type UiInputEvent,
  watchDownloads,
  watchPage,
} from '@kedalion/cdp';
import { writeFileAtomic } from '@kedalion/platform';
import { invalid } from '@kedalion/server-core';
import type { ServerMsg } from '../protocol.ts';
import { isEmulating } from '../devices.ts';
import { buildHar } from './har.ts';
import type { BrowserSettings } from './settings.ts';

export interface BrowserServiceOptions {
  profileDir: string;
  dataDir: string;
  /** Origin of the app server, allowed to open the debugging socket. */
  origin: () => string | undefined;
  settings: () => BrowserSettings;
}

export interface TabLogs {
  console: ConsoleLog;
  network: NetworkLog;
}

export type CookieScope = 'page' | 'all';

export interface StorageSnapshot {
  origin: string;
  local: StorageItem[];
  session: StorageItem[];
  indexedDb: string[];
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; undefined for a session cookie. */
  expires?: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

const toCookie = (c: any): BrowserCookie => ({
  name: String(c.name),
  value: String(c.value ?? ''),
  domain: String(c.domain ?? ''),
  path: String(c.path ?? '/'),
  ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
  size: Number(c.size ?? 0),
  httpOnly: !!c.httpOnly,
  secure: !!c.secure,
  ...(c.sameSite ? { sameSite: String(c.sameSite) } : {}),
});

export interface EvalResult {
  ok: boolean;
  text: string;
  type?: string;
}

export interface BrowserService {
  /** Starts the browser when it is not running (lazy; also restarts it after an unexpected exit). */
  ensure(): Promise<void>;
  /** The tabs; call after `ensure`. */
  tabs(): BrowserTabs;
  /** Console and network logs of a tab; undefined for an unknown tab. */
  logs(tab: string): TabLogs | undefined;
  activeTab(): string | undefined;
  /** Opens a tab; `activate: false` keeps the current tab in front. */
  open(url?: string, opts?: { activate?: boolean }): Promise<TabInfo>;
  close(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<string | undefined>;
  action(id: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>;
  evaluate(id: string, expression: string): Promise<EvalResult>;
  /** URL of the DevTools frontend of a tab (frameable). */
  devtoolsUrl(id: string): string;
  /** Cookies of the tab's page (`page`) or of the whole browser profile (`all`). */
  cookies(id: string, scope: CookieScope): Promise<BrowserCookie[]>;
  /** Creates or overwrites a cookie in the tab's browser profile. */
  setCookie(id: string, cookie: CookieInput): Promise<void>;
  /** localStorage, sessionStorage and IndexedDB names of the tab's origin. */
  storage(id: string): Promise<StorageSnapshot>;
  setStorageItem(id: string, kind: StorageKind, key: string, value: string): Promise<void>;
  /** Removes one item (`key`), or the IndexedDB database of that name. */
  removeStorageItem(id: string, kind: StorageKind | 'indexeddb', key: string): Promise<void>;
  clearStorage(id: string, kind: StorageKind | 'indexeddb'): Promise<void>;
  /** Cookies, storage, IndexedDB, caches and service workers of the tab's origin (and the HTTP cache when `cache`). */
  clearSiteData(id: string, cache: boolean): Promise<void>;
  /** The request rules, applied to every tab. */
  rules(): InterceptRule[];
  setRules(rules: InterceptRule[]): void;
  emulation(id: string): Emulation;
  setEmulation(id: string, e: Emulation): Promise<void>;
  /** Writes the tab's network log as a HAR file into Downloads; returns the path and the request count. */
  exportHar(id: string): Promise<{ path: string; count: number }>;
  /** Deletes one cookie. */
  deleteCookie(id: string, cookie: { name: string; domain: string; path: string }): Promise<void>;
  /** Deletes the cookies of the scope; returns how many were removed. */
  clearCookies(id: string, scope: CookieScope): Promise<number>;
  setViewport(v: { w: number; h: number; dpr: number }): void;
  /** Frames are sent only while a viewer is connected. */
  setViewers(count: number): void;
  input(ev: UiInputEvent): Promise<void>;
  chooseOption(id: string, value: string): Promise<void>;
  answerDialog(tab: string, accept: boolean, text?: string): Promise<void>;
  setFiles(tab: string, id: string, paths: string[]): Promise<void>;
  onEvent(cb: (msg: ServerMsg) => void): () => void;
  /** Closes the browser. */
  stop(): Promise<void>;
}

interface TabsFile {
  version: 1;
  tabs: string[];
  active?: string;
}

const SAVE_DELAY_MS = 300;
const CLICK_ABOVE = 'left';

function uniquePath(dir: string, name: string, taken: (p: string) => Promise<boolean>): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const next = async (n: number): Promise<string> => {
    const p = join(dir, n === 0 ? name : `${base} (${n})${ext}`);
    return (await taken(p)) ? next(n + 1) : p;
  };
  return next(0);
}

export function createBrowserService(opts: BrowserServiceOptions): BrowserService {
  const listeners = new Set<(msg: ServerMsg) => void>();
  const emit = (msg: ServerMsg) => {
    for (const l of listeners) l(msg);
  };
  const tabsFile = join(opts.dataDir, 'tabs.json');
  const downloadsDir = join(homedir(), 'Downloads');

  let launched: LaunchedBrowser | undefined;
  let client: CdpClient | undefined;
  let tabs: BrowserTabs | undefined;
  let starting: Promise<void> | undefined;
  let stopping = false;
  let offs: Array<() => void> = [];
  const perTab = new Map<string, TabLogs & { offPage: () => void; interceptor: Interceptor }>();
  const emulations = new Map<string, Emulation>();
  let rules: InterceptRule[] = [];
  const choosers = new Map<string, { tab: string; backendNodeId: number }>();
  const selects = new Map<string, { tab: string; nodeRef: string }>();
  let nextId = 1;
  let viewport: { w: number; h: number; dpr: number } | undefined;
  let viewers = 0;
  let stopFrames: (() => void) | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const requireTabs = (): BrowserTabs => {
    if (!tabs) throw invalid('browserNotRunning', 'The browser is not running');
    return tabs;
  };

  const storageTarget = (id: string): { origin: string; session: CdpSession } => {
    const t = requireTabs();
    const origin = originOf(t.list().find((x) => x.id === id)?.url ?? '');
    if (!origin) throw invalid('badRequest', 'This page has no web storage.');
    return { origin, session: t.session(id) };
  };

  const snapshotMsg =(): ServerMsg => ({ type: 'tabs', tabs: tabs?.list() ?? [], ...(tabs?.active() ? { active: tabs.active()! } : {}) });

  async function saveNow(): Promise<void> {
    if (!tabs) return;
    const file: TabsFile = { version: 1, tabs: tabs.list().map((t) => t.url) };
    const active = tabs.list().findIndex((t) => t.id === tabs!.active());
    if (active >= 0) file.active = String(active);
    await writeFileAtomic(tabsFile, JSON.stringify(file)).catch(() => undefined);
  }
  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
  }
  async function readSaved(): Promise<{ urls: string[]; active: number }> {
    try {
      const raw = JSON.parse(await readFile(tabsFile, 'utf8')) as Partial<TabsFile>;
      const urls = Array.isArray(raw.tabs) ? raw.tabs.filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
      const active = Number(raw.active);
      return { urls, active: Number.isInteger(active) && active >= 0 && active < urls.length ? active : urls.length - 1 };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') await copyFile(tabsFile, `${tabsFile}.bak`).catch(() => undefined);
      return { urls: [], active: -1 };
    }
  }

  function restartFrames(): void {
    stopFrames?.();
    stopFrames = undefined;
    const active = tabs?.active();
    if (!tabs || !active || !viewport || viewers === 0) return;
    const tab = active;
    const emu = emulations.get(tab);
    const size = emu?.width && emu.height ? { width: emu.width, height: emu.height, dpr: emu.dpr ?? 1, mobile: !!emu.mobile } : { width: viewport.w, height: viewport.h, dpr: viewport.dpr };
    stopFrames = startScreencast(tabs.session(tab), size, (data, meta) =>
      emit({ type: 'frame', tab, data, w: meta.deviceWidth, h: meta.deviceHeight }),
    );
  }

  async function attachTab(id: string, session: CdpSession): Promise<void> {
    const offCert = await watchCertificateErrors(session, () => opts.settings().ignoreLocalCertErrors);
    const consoleLog = createConsoleLog(session, {});
    const network = createNetworkLog(session, {});
    consoleLog.on('entry', (e) => emit({ type: 'console', tab: id, entries: [e] }));
    network.on('entry', (e) => emit({ type: 'network', tab: id, entries: [e] }));
    const offPage = watchPage(session, {
      onDialog: (d) => emit({ type: 'dialog', tab: id, kind: d.type, message: d.message, ...(d.defaultPrompt ? { defaultPrompt: d.defaultPrompt } : {}) }),
      onFileChooser: (f) => {
        const chooserId = String(nextId++);
        choosers.set(chooserId, { tab: id, backendNodeId: f.backendNodeId });
        emit({ type: 'fileChooser', tab: id, id: chooserId, multiple: f.multiple });
      },
    });
    perTab.set(id, { console: consoleLog, network, offPage: () => { offCert(); offPage(); }, interceptor: createInterceptor(session, rules) });
  }

  function dropTab(id: string): void {
    const t = perTab.get(id);
    if (!t) return;
    t.console.dispose();
    t.network.dispose();
    t.offPage();
    t.interceptor.dispose();
    perTab.delete(id);
    emulations.delete(id);
    for (const [k, v] of choosers) if (v.tab === id) choosers.delete(k);
    for (const [k, v] of selects) if (v.tab === id) selects.delete(k);
  }

  /** Opens a tab; a local address loads after the tab's certificate handler is in place, so the first load is covered. */
  async function openTab(t: BrowserTabs, url: string, activate: boolean) {
    if (!isLocalHost(url)) return t.open(url, { activate });
    const tab = await t.open('about:blank', { activate });
    await t.navigate(tab.id, url);
    return tab;
  }

  function reset(): void {
    for (const off of offs) off();
    offs = [];
    stopFrames?.();
    stopFrames = undefined;
    for (const id of [...perTab.keys()]) dropTab(id);
    tabs = undefined;
    client = undefined;
    launched = undefined;
  }

  async function start(): Promise<void> {
    const s = opts.settings();
    mkdirSync(opts.profileDir, { recursive: true });
    mkdirSync(opts.dataDir, { recursive: true });
    const browser = await launchBrowser({
      profileDir: opts.profileDir,
      allowOrigin: opts.origin() ?? 'http://127.0.0.1',
      ...(s.executable ? { executable: s.executable } : {}),
      hideAutomation: s.hideAutomation,
    });
    let cdp: CdpClient;
    try {
      cdp = await connectCdp(browser.wsUrl);
    } catch (e) {
      browser.kill();
      throw e;
    }
    launched = browser;
    client = cdp;
    try {
      const saved = await readSaved();
      const t = await createTabs(cdp, { onAttach: attachTab });
      tabs = t;
      const preexisting = t.list().map((x) => x.id);
      offs.push(
        t.on('tab', () => {
          emit(snapshotMsg());
          scheduleSave();
        }),
        t.on('closed', (id) => {
          dropTab(id);
          emit(snapshotMsg());
          scheduleSave();
        }),
        t.on('activated', () => {
          emit(snapshotMsg());
          restartFrames();
          scheduleSave();
        }),
        await watchDownloads(cdp, { downloadPath: downloadsDir }, (e) => {
          void (async () => {
            let name = basename(e.suggestedFilename || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
            if (!name || name === '.' || name === '..') name = e.guid;
            if (e.state === 'started') emit({ type: 'download', name, path: e.path, done: false });
            else if (e.state === 'completed') {
              let target = e.path;
              try {
                const taken = (p: string) => Bun.file(p).exists();
                let moved = false;
                for (let i = 0; i < 5 && !moved; i++) {
                  const candidate = await uniquePath(downloadsDir, name, taken);
                  if (!resolve(candidate).startsWith(resolve(downloadsDir) + sep)) throw new Error('download path escapes the folder');
                  try {
                    await link(e.path, candidate);
                    await unlink(e.path).catch(() => undefined);
                    target = candidate;
                    moved = true;
                  } catch (err) {
                    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
                  }
                }
              } catch {
                target = e.path;
              }
              emit({ type: 'download', name, path: target, done: true });
            }
          })();
        }),
      );
      void browser.exited.then(() => {
        if (launched !== browser) return;
        if (!stopping) void saveNow().finally(reset);
        else reset();
      });
      if (saved.urls.length) {
        const ids: string[] = [];
        for (const url of saved.urls) ids.push((await openTab(t, url, false)).id);
        for (const id of preexisting) await t.close(id).catch(() => undefined);
        if (ids[saved.active]) await t.activate(ids[saved.active]!);
      } else if (t.list().length === 0) {
        await t.open(s.home, { activate: true });
      }
      emit(snapshotMsg());
      restartFrames();
    } catch (e) {
      reset();
      cdp.close();
      browser.kill();
      throw e;
    }
  }

  const service: BrowserService = {
    ensure() {
      if (tabs) return Promise.resolve();
      stopping = false;
      starting ??= start().finally(() => {
        starting = undefined;
      });
      return starting;
    },
    tabs: requireTabs,
    logs: (tab) => perTab.get(tab),
    activeTab: () => tabs?.active(),
    async open(url, o) {
      const target = url ?? opts.settings().home;
      return openTab(requireTabs(), target, o?.activate ?? true);
    },
    close: (id) => requireTabs().close(id),
    async activate(id) {
      await requireTabs().activate(id);
    },
    navigate: (id, url) => requireTabs().navigate(id, url),
    async action(id, action) {
      await requireTabs()[action](id);
    },
    async evaluate(id, expression) {
      const r = await requireTabs()
        .session(id)
        .send('Runtime.evaluate', { expression, replMode: true, awaitPromise: true, generatePreview: true, userGesture: true, returnByValue: false });
      if (r.exceptionDetails) {
        return { ok: false, text: String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'Error') };
      }
      const o = r.result ?? {};
      const text = o.value !== undefined ? (typeof o.value === 'string' ? o.value : JSON.stringify(o.value)) : (o.description ?? o.type ?? 'undefined');
      return { ok: true, text: String(text), ...(o.type ? { type: String(o.type) } : {}) };
    },
    devtoolsUrl(id) {
      if (!launched) throw invalid('browserNotRunning', 'The browser is not running');
      const host = `127.0.0.1:${launched.port}`;
      return `http://${host}/devtools/inspector.html?ws=${host}/devtools/page/${encodeURIComponent(id)}`;
    },
    async cookies(id, scope) {
      const t = requireTabs();
      if (scope === 'all') {
        if (!client) throw invalid('browserNotRunning', 'The browser is not running');
        const r = await client.send('Storage.getCookies');
        return ((r.cookies ?? []) as unknown[]).map(toCookie);
      }
      const url = t.list().find((x) => x.id === id)?.url;
      if (!url || !/^https?:/i.test(url)) return [];
      const r = await t.session(id).send('Network.getCookies', { urls: [url] });
      return ((r.cookies ?? []) as unknown[]).map(toCookie);
    },
    async deleteCookie(id, cookie) {
      await requireTabs().session(id).send('Network.deleteCookies', { name: cookie.name, domain: cookie.domain, path: cookie.path });
    },
    async clearCookies(id, scope) {
      const list = await service.cookies(id, scope);
      if (scope === 'all') {
        await client!.send('Storage.clearCookies');
        return list.length;
      }
      const session = requireTabs().session(id);
      for (const c of list) await session.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
      return list.length;
    },
    async setCookie(id, cookie) {
      const t = requireTabs();
      await setCookie(t.session(id), cookie as CookieInput, t.list().find((x) => x.id === id)?.url ?? '');
    },
    async storage(id) {
      const { origin, session } = storageTarget(id);
      const [local, sessionItems, indexedDb] = await Promise.all([
        getStorageItems(session, origin, 'local').catch(() => [] as StorageItem[]),
        getStorageItems(session, origin, 'session').catch(() => [] as StorageItem[]),
        listIndexedDb(session, origin).catch(() => [] as string[]),
      ]);
      return { origin, local, session: sessionItems, indexedDb };
    },
    async setStorageItem(id, kind, key, value) {
      const { origin, session } = storageTarget(id);
      await setStorageItem(session, origin, kind, key, value);
    },
    async removeStorageItem(id, kind, key) {
      const { origin, session } = storageTarget(id);
      if (kind === 'indexeddb') await deleteIndexedDb(session, origin, key);
      else await removeStorageItem(session, origin, kind, key);
    },
    async clearStorage(id, kind) {
      const { origin, session } = storageTarget(id);
      if (kind === 'indexeddb') for (const name of await listIndexedDb(session, origin)) await deleteIndexedDb(session, origin, name);
      else await clearStorage(session, origin, kind);
    },
    async clearSiteData(id, cache) {
      const { origin, session } = storageTarget(id);
      await service.clearCookies(id, 'page');
      await clearSiteData(session, origin, { cache });
    },
    rules: () => rules,
    setRules(next) {
      rules = next;
      for (const t of perTab.values()) t.interceptor.setRules(rules);
    },
    emulation: (id) => emulations.get(id) ?? {},
    async setEmulation(id, e) {
      const session = requireTabs().session(id);
      if (isEmulating(e)) emulations.set(id, e);
      else emulations.delete(id);
      await applyEmulation(session, e);
      emit({ type: 'emulation', tab: id, emulation: e });
      if (tabs?.active() === id) restartFrames();
    },
    async exportHar(id) {
      const logs = perTab.get(id);
      if (!logs) throw invalid('notFound', 'Unknown tab.');
      const entries = logs.network.entries();
      const details = new Map<number, NetworkDetail | undefined>();
      for (const e of entries) details.set(e.id, await logs.network.detail(e.id).catch(() => undefined));
      const host = (() => {
        try {
          return (new URL(requireTabs().list().find((x) => x.id === id)?.url ?? '').hostname || 'page').replace(/[^\w.-]/g, '_');
        } catch {
          return 'page';
        }
      })();
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const path = await uniquePath(downloadsDir, `kedalion-${host}-${stamp}.har`, (p) => Bun.file(p).exists());
      await writeFileAtomic(path, JSON.stringify(buildHar(entries, details), null, 2));
      return { path, count: entries.length };
    },
    setViewport(v) {
      viewport = v;
      restartFrames();
    },
    setViewers(count) {
      const was = viewers;
      viewers = count;
      if ((was === 0) !== (count === 0)) restartFrames();
    },
    async input(ev) {
      const t = requireTabs();
      const id = t.active();
      if (!id) return;
      const session = t.session(id);
      for (const c of mapInput(ev)) await session.send(c.method, c.params);
      if (ev.type === 'mouse' && ev.action === 'up' && (ev.button ?? CLICK_ABOVE) === 'left') {
        const sel = await selectAt(session, ev.x, ev.y).catch(() => null);
        if (sel && sel.options.length) {
          const selId = String(nextId++);
          selects.set(selId, { tab: id, nodeRef: sel.nodeRef });
          emit({ type: 'select', tab: id, id: selId, options: sel.options });
        }
      }
    },
    async chooseOption(id, value) {
      const s = selects.get(id);
      if (!s) throw invalid('badRequest', 'Unknown select');
      selects.delete(id);
      await chooseOption(requireTabs().session(s.tab), s.nodeRef, value);
    },
    async answerDialog(tab, accept, text) {
      await answerDialog(requireTabs().session(tab), accept, text);
    },
    async setFiles(tab, id, paths) {
      const c = choosers.get(id);
      if (!c || c.tab !== tab) throw invalid('badRequest', 'Unknown file chooser');
      choosers.delete(id);
      await setFiles(requireTabs().session(tab), c.backendNodeId, paths);
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async stop() {
      stopping = true;
      clearTimeout(saveTimer);
      await saveNow();
      const b = launched;
      const c = client;
      reset();
      c?.close();
      b?.kill();
    },
  };
  return service;
}
