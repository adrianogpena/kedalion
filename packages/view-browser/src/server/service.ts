import { mkdirSync } from 'node:fs';
import { readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  answerDialog,
  applyCertPolicy,
  type BrowserTabs,
  type CdpClient,
  type CdpSession,
  chooseOption,
  connectCdp,
  type ConsoleLog,
  createConsoleLog,
  createNetworkLog,
  createTabs,
  type LaunchedBrowser,
  launchBrowser,
  mapInput,
  type NetworkLog,
  selectAt,
  setFiles,
  startScreencast,
  type TabInfo,
  type UiInputEvent,
  watchDownloads,
  watchPage,
} from '@kedalion/cdp';
import { writeFileAtomic } from '@kedalion/platform';
import { invalid } from '@kedalion/server-core';
import type { ServerMsg } from '../protocol.ts';
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
  open(url?: string): Promise<TabInfo>;
  close(id: string): Promise<void>;
  activate(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  action(id: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void>;
  evaluate(id: string, expression: string): Promise<EvalResult>;
  /** URL of the DevTools frontend of a tab (frameable). */
  devtoolsUrl(id: string): string;
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
  const perTab = new Map<string, TabLogs & { offPage: () => void }>();
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

  const snapshotMsg = (): ServerMsg => ({ type: 'tabs', tabs: tabs?.list() ?? [], ...(tabs?.active() ? { active: tabs.active()! } : {}) });

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
    } catch {
      return { urls: [], active: -1 };
    }
  }

  function restartFrames(): void {
    stopFrames?.();
    stopFrames = undefined;
    const active = tabs?.active();
    if (!tabs || !active || !viewport || viewers === 0) return;
    const tab = active;
    stopFrames = startScreencast(tabs.session(tab), { width: viewport.w, height: viewport.h, dpr: viewport.dpr }, (data, meta) =>
      emit({ type: 'frame', tab, data, w: meta.deviceWidth, h: meta.deviceHeight }),
    );
  }

  function attachTab(id: string, session: CdpSession): void {
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
    perTab.set(id, { console: consoleLog, network, offPage });
  }

  function dropTab(id: string): void {
    const t = perTab.get(id);
    if (!t) return;
    t.console.dispose();
    t.network.dispose();
    t.offPage();
    perTab.delete(id);
    for (const [k, v] of choosers) if (v.tab === id) choosers.delete(k);
    for (const [k, v] of selects) if (v.tab === id) selects.delete(k);
  }

  async function certPolicy(url: string): Promise<void> {
    if (client) await applyCertPolicy(client, url, opts.settings().ignoreLocalCertErrors).catch(() => false);
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
      t.on('activated', (id) => {
        emit(snapshotMsg());
        restartFrames();
        scheduleSave();
        const url = t.list().find((x) => x.id === id)?.url;
        if (url) void certPolicy(url);
      }),
      await watchDownloads(cdp, { downloadPath: downloadsDir }, (e) => {
        void (async () => {
          const name = e.suggestedFilename || e.guid;
          if (e.state === 'started') emit({ type: 'download', name, path: e.path, done: false });
          else if (e.state === 'completed') {
            const target = await uniquePath(downloadsDir, name, (p) => Bun.file(p).exists());
            await rename(e.path, target).catch(() => undefined);
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
      await certPolicy(saved.urls[saved.active] ?? '');
      const ids: string[] = [];
      for (const url of saved.urls) ids.push((await t.open(url, { activate: false })).id);
      for (const id of preexisting) await t.close(id).catch(() => undefined);
      if (ids[saved.active]) await t.activate(ids[saved.active]!);
    } else if (t.list().length === 0) {
      await t.open(s.home, { activate: true });
    }
    emit(snapshotMsg());
    restartFrames();
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
    async open(url) {
      const target = url ?? opts.settings().home;
      await certPolicy(target);
      return requireTabs().open(target, { activate: true });
    },
    close: (id) => requireTabs().close(id),
    async activate(id) {
      await requireTabs().activate(id);
    },
    async navigate(id, url) {
      await certPolicy(url);
      await requireTabs().navigate(id, url);
    },
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
