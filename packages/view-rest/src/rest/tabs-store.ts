import { useEffect, useSyncExternalStore } from 'react';
import { draftToSpec, emptyDraft, type HttpRequestDraft } from '@kedalion/editor';
import type { HttpResponseInfo } from '@kedalion/server-core/protocol';
import { type ApiError, errorOf } from '@kedalion/ui';
import { restApi as api } from '../client';
import type { RestTabsFile, SavedRequest } from '../settings';


/** A REST tab as the tabs store keeps it (no Authorization value). */
export interface RestTab {
  id: string;
  draft: HttpRequestDraft;
  savedId?: string;
  /** Saved request's name, or an imported request's name. */
  title?: string;
}

/** Per-tab state that lives only for the app's lifetime. */
export interface TabRuntime {
  auth: string;
  /** Set when the tab came from an import or `openRestTab`; `auth` tells the auth field to accept a value. */
  imported?: { name: string; auth: boolean };
  response?: HttpResponseInfo;
  error?: ApiError;
  sending: boolean;
  savedPath?: string;
  /** Pinned response the Diff view compares the live one with; kept across sends, dropped on unpin or close. */
  baseline?: HttpResponseInfo;
  view?: 'live' | 'diff';
}

interface Snapshot {
  tabs: RestTab[];
  active: string;
  runtime: Record<string, TabRuntime>;
  /** The last open attempt found every tab with unsaved work at the cap. */
  full?: boolean;
  /** Reading the stored tabs failed; nothing is saved until a later load succeeds. */
  loadError?: ApiError;
  /** The last save of the tabs failed. */
  saveError?: ApiError;
}

/** Saved requests as the REST screen last loaded them; until known, a tab with a saved id counts as dirty. */
let savedList: SavedRequest[] | undefined;

const MAX_TABS = 30;
const SAVE_DELAY_MS = 500;
/** The server refuses bodies over 1 MB; large drafts lose their body in the stored copy first. */
const MAX_FILE_CHARS = 950_000;

const newId = () => crypto.randomUUID();
const blankRuntime = (): TabRuntime => ({ auth: '', sending: false });
const freshTab = (): RestTab => ({ id: newId(), draft: emptyDraft() });

let snap: Snapshot = (() => {
  const tab = freshTab();
  return { tabs: [tab], active: tab.id, runtime: {} };
})();
let loaded = false;
let loading: Promise<void> | undefined;
/** Tabs opened before the stored ones arrived; they are kept after the stored ones. */
let touched = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function set(next: Partial<Snapshot>, persist = true) {
  snap = { ...snap, ...next };
  if (persist) {
    touched = true;
    scheduleSave();
  }
  emit();
}

function fileOf(): RestTabsFile {
  const tabs = snap.tabs.map((t) => ({ ...t, draft: { ...t.draft } }));
  let size = JSON.stringify(tabs).length;
  for (const tab of [...tabs].sort((a, b) => b.draft.body.length - a.draft.body.length)) {
    if (size <= MAX_FILE_CHARS) break;
    size -= tab.draft.body.length;
    tab.draft.body = '';
  }
  return { version: 1, tabs, active: snap.active };
}

function scheduleSave() {
  if (!loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      void api.saveRestTabs(fileOf()).then(
        () => snap.saveError && set({ saveError: undefined }, false),
        (err) => set({ saveError: errorOf(err) }, false),
      ),
    SAVE_DELAY_MS,
  );
}

function ensureLoaded() {
  loading ??= api
    .restTabs()
    .then((file) => {
      const stored = file?.tabs ?? [];
      loaded = true;
      if (snap.loadError) set({ loadError: undefined }, false);
      if (!stored.length) {
        if (touched) scheduleSave();
        return;
      }
      if (!touched) {
        const active = stored.some((t) => t.id === file?.active) ? file!.active! : stored[0]!.id;
        set({ tabs: stored.slice(0, MAX_TABS), active }, false);
        return;
      }
      const ids = new Set(snap.tabs.map((t) => t.id));
      const blank = (t: RestTab) => !t.savedId && !t.title && !isNonEmpty(t.draft);
      const opened = snap.tabs.filter((t) => !blank(t) || t.id === snap.active);
      const merged = [...stored.filter((t) => !ids.has(t.id)), ...opened];
      while (merged.length > MAX_TABS) {
        const clean = merged.findIndex((t) => t.id !== snap.active && !dirtyNow(t));
        merged.splice(clean < 0 ? 0 : clean, 1);
      }
      set({ tabs: merged });
    })
    .catch((err) => {
      // A failed read must not look empty: saving stays off (loaded false) so stored tabs are not overwritten; the next use retries.
      loading = undefined;
      set({ loadError: errorOf(err) }, false);
    });
  return loading;
}

const sameDraft = (a: HttpRequestDraft, b: HttpRequestDraft) => JSON.stringify(a) === JSON.stringify(b);
const isNonEmpty = (draft: HttpRequestDraft) => !sameDraft(draft, emptyDraft());

/** Whether `tab` differs from its saved request, or is unsaved and not empty. */
export function isDirty(tab: RestTab, saved: SavedRequest[] | undefined): boolean {
  if (!tab.savedId) return isNonEmpty(tab.draft);
  const record = saved?.find((r) => r.id === tab.savedId);
  return record ? !sameDraft(tab.draft, record.request) : false;
}

export const runtimeOf = (id: string): TabRuntime => snap.runtime[id] ?? blankRuntime();

function setRuntime(id: string, patch: Partial<TabRuntime>) {
  set({ runtime: { ...snap.runtime, [id]: { ...runtimeOf(id), ...patch } } }, false);
}

const dirtyNow = (tab: RestTab) => (tab.savedId && !savedList ? true : isDirty(tab, savedList));

/** Adds `tab` as the active one; at the cap the oldest clean, inactive tab goes. False when every tab has unsaved work. */
function append(tab: RestTab, runtime?: Partial<TabRuntime>): boolean {
  void ensureLoaded();
  let tabs = snap.tabs;
  if (tabs.length >= MAX_TABS) {
    const drop = tabs.find((t) => t.id !== snap.active && !dirtyNow(t) && !runtimeOf(t.id).sending);
    if (!drop) {
      set({ full: true }, false);
      return false;
    }
    controllers.get(drop.id)?.abort();
    controllers.delete(drop.id);
    tabs = tabs.filter((t) => t.id !== drop.id);
  }
  tabs = [...tabs, tab];
  const keep = new Set(tabs.map((t) => t.id));
  const rt = Object.fromEntries(Object.entries(snap.runtime).filter(([id]) => keep.has(id)));
  if (runtime) rt[tab.id] = { ...blankRuntime(), ...runtime };
  set({ tabs, active: tab.id, runtime: rt, full: false });
  return true;
}

/**
 * Opens `draft` in a new unsaved REST tab and makes it active; `auth` stays in memory only.
 * Works whether the REST screen is shown or not; the caller then shows it (`go('rest')`).
 */
export function openRestTab(draft: HttpRequestDraft, auth?: string, name?: string): string | null {
  const id = newId();
  const added = append({ id, draft, ...(name ? { title: name } : {}) }, { auth: auth ?? '', imported: { name: name ?? '', auth: auth !== undefined } });
  return added ? id : null;
}

/** Id of the open tab showing saved request `savedId`. */
export function tabOfSaved(savedId: string): string | undefined {
  return snap.tabs.find((t) => t.savedId === savedId)?.id;
}

export const restTabs = {
  /** The REST screen passes its saved list so the cap knows which tabs are clean. */
  setSaved(list: SavedRequest[] | undefined) {
    savedList = list;
  },
  dismissFull() {
    if (snap.full) set({ full: false }, false);
  },
  newTab() {
    append(freshTab());
  },
  /** Focuses the tab of saved request `item`, or opens one. */
  openSaved(item: SavedRequest) {
    const tab = snap.tabs.find((t) => t.savedId === item.id);
    if (tab) set({ active: tab.id });
    else append({ id: newId(), draft: item.request, savedId: item.id, title: item.name });
  },
  activate(id: string) {
    if (snap.tabs.some((t) => t.id === id)) set({ active: id });
  },
  close(id: string) {
    const index = snap.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    controllers.get(id)?.abort();
    controllers.delete(id);
    let tabs = snap.tabs.filter((t) => t.id !== id);
    if (!tabs.length) tabs = [freshTab()];
    const active = snap.active === id ? tabs[Math.min(index, tabs.length - 1)]!.id : snap.active;
    const { [id]: _, ...runtime } = snap.runtime;
    set({ tabs, active, runtime, full: false });
  },
  update(id: string, patch: Partial<Omit<RestTab, 'id'>>) {
    set({ tabs: snap.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  },
  /** Replaces tab `id`'s content with an imported request. */
  loadImported(id: string, draft: HttpRequestDraft, name: string, auth?: string) {
    set({ tabs: snap.tabs.map((t) => (t.id === id ? { id, draft, ...(name ? { title: name } : {}) } : t)) });
    setRuntime(id, { auth: auth ?? '', imported: { name, auth: auth !== undefined }, response: undefined, error: undefined });
  },
  /** Marks tab `id` as showing saved `record`; its Authorization value now lives in the secret store. */
  markSaved(id: string, record: SavedRequest) {
    set({ tabs: snap.tabs.map((t) => (t.id === id ? { id, draft: t.draft, savedId: record.id, title: record.name } : t)) });
    setRuntime(id, { auth: '', imported: undefined });
  },
  /** Saved request `savedId` was renamed or deleted (`record` undefined). */
  savedChanged(savedId: string, record?: SavedRequest) {
    set({
      tabs: snap.tabs.map((t) => {
        if (t.savedId !== savedId) return t;
        if (record) return { ...t, title: record.name };
        const { savedId: _, title: __, ...rest } = t;
        return rest;
      }),
    });
  },
  setRuntime,
  /** Stores tab `id`'s current response as its baseline. */
  pinBaseline(id: string) {
    const response = runtimeOf(id).response;
    if (response) setRuntime(id, { baseline: response });
  },
  unpinBaseline(id: string) {
    setRuntime(id, { baseline: undefined, view: 'live' });
  },
  setResponseView(id: string, view: 'live' | 'diff') {
    setRuntime(id, { view });
  },
  /** Sends tab `id` with REST environment `environment` (id); `extraHeaders` (e.g. a typed Authorization value) go after the draft's headers. */
  async send(id: string, extraHeaders?: Array<[string, string]>, environment?: string, vars?: Record<string, string>) {
    const tab = snap.tabs.find((t) => t.id === id);
    if (!tab || runtimeOf(id).sending) return;
    const abort = new AbortController();
    controllers.set(id, abort);
    setRuntime(id, { sending: true, error: undefined, savedPath: undefined });
    try {
      const spec = draftToSpec(tab.draft);
      if (extraHeaders) spec.headers.push(...extraHeaders);
      const response = await api.send(spec, tab.savedId, abort.signal, { environment: environment || undefined, draft: tab.draft, ...(vars && Object.keys(vars).length ? { vars } : {}) });
      if (!abort.signal.aborted) setRuntime(id, { response });
    } catch (err) {
      if (!abort.signal.aborted) setRuntime(id, { response: undefined, error: errorOf(err) });
    } finally {
      if (controllers.get(id) === abort) {
        controllers.delete(id);
        if (snap.tabs.some((t) => t.id === id)) setRuntime(id, { sending: false });
      }
    }
  },
  cancel(id: string) {
    controllers.get(id)?.abort();
    controllers.delete(id);
    setRuntime(id, { sending: false });
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => snap;

/** The open tabs, the active id and per-tab runtime state; loads the stored tabs on first use. */
export function useRestTabs(): Snapshot {
  useEffect(() => void ensureLoaded(), []);
  return useSyncExternalStore(subscribe, getSnapshot);
}
