import { request } from '@kedalion/ui';
import type { Emulation, InterceptRule, StorageItem, StorageKind, TabInfo } from '@kedalion/cdp';

/** The server calls the Browser screen makes; the live state (frames, tabs, dialogs) comes over the socket. */
export interface BrowserClient {
  socketTicket: () => Promise<{ ticket: string }>;
  openTab: (url?: string) => Promise<{ tab: TabInfo }>;
  closeTab: (id: string) => Promise<unknown>;
  navigate: (id: string, input: { url: string } | { action: 'back' | 'forward' | 'reload' | 'stop' }) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  setFiles: (tab: string, id: string, paths: string[]) => Promise<unknown>;
  cookies: (tab: string, scope: CookieScope) => Promise<{ cookies: BrowserCookie[] }>;
  deleteCookie: (tab: string, cookie: { name: string; domain: string; path: string }) => Promise<unknown>;
  clearCookies: (tab: string, scope: CookieScope) => Promise<{ removed: number }>;
  setCookie: (tab: string, cookie: CookieDraft) => Promise<unknown>;
  storage: (tab: string) => Promise<StorageSnapshot>;
  setStorageItem: (tab: string, kind: StorageKind, key: string, value: string) => Promise<unknown>;
  removeStorageItem: (tab: string, kind: StoreKind, key: string) => Promise<unknown>;
  clearStorage: (tab: string, kind: StoreKind) => Promise<unknown>;
  clearSiteData: (tab: string, cache: boolean) => Promise<unknown>;
  rules: () => Promise<{ rules: InterceptRule[] }>;
  setRules: (rules: InterceptRule[]) => Promise<{ rules: InterceptRule[] }>;
  emulation: (tab: string) => Promise<{ emulation: Emulation }>;
  setEmulation: (tab: string, emulation: Emulation) => Promise<{ emulation: Emulation }>;
  exportHar: (tab: string) => Promise<{ path: string; count: number }>;
}

export type StoreKind = StorageKind | 'indexeddb';

export interface StorageSnapshot {
  origin: string;
  local: StorageItem[];
  session: StorageItem[];
  indexedDb: string[];
}

export interface CookieDraft {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export type CookieScope = 'page' | 'all';

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export const browserClient: BrowserClient = {
  socketTicket: () => request<{ ticket: string }>('POST', '/api/browser/socket-ticket'),
  openTab: (url) => request<{ tab: TabInfo }>('POST', '/api/browser/tabs', {}, url === undefined ? {} : { url }),
  closeTab: (id) => request('POST', '/api/browser/tabs/close', {}, { id }),
  navigate: (id, input) => request('POST', '/api/browser/navigate', {}, { id, ...input }),
  openExternal: (url) => request('POST', '/api/browser/open-external', {}, { url }),
  setFiles: (tab, id, paths) => request('POST', '/api/browser/files', {}, { tab, id, paths }),
  cookies: (tab, scope) => request<{ cookies: BrowserCookie[] }>('GET', `/api/browser/cookies?tab=${encodeURIComponent(tab)}&scope=${scope}`),
  deleteCookie: (tab, cookie) => request('POST', '/api/browser/cookies/delete', {}, { tab, ...cookie }),
  clearCookies: (tab, scope) => request<{ removed: number }>('POST', '/api/browser/cookies/clear', {}, { tab, scope }),
  setCookie: (tab, cookie) => request('POST', '/api/browser/cookies/set', {}, { tab, cookie }),
  storage: (tab) => request<StorageSnapshot>('GET', `/api/browser/storage?tab=${encodeURIComponent(tab)}`),
  setStorageItem: (tab, kind, key, value) => request('POST', '/api/browser/storage/set', {}, { tab, kind, key, value }),
  removeStorageItem: (tab, kind, key) => request('POST', '/api/browser/storage/remove', {}, { tab, kind, key }),
  clearStorage: (tab, kind) => request('POST', '/api/browser/storage/clear', {}, { tab, kind }),
  clearSiteData: (tab, cache) => request('POST', '/api/browser/site-data/clear', {}, { tab, cache }),
  rules: () => request<{ rules: InterceptRule[] }>('GET', '/api/browser/rules'),
  setRules: (rules) => request<{ rules: InterceptRule[] }>('POST', '/api/browser/rules', {}, { rules }),
  emulation: (tab) => request<{ emulation: Emulation }>('GET', `/api/browser/emulation?tab=${encodeURIComponent(tab)}`),
  setEmulation: (tab, emulation) => request<{ emulation: Emulation }>('POST', '/api/browser/emulation', {}, { tab, emulation }),
  exportHar: (tab) => request<{ path: string; count: number }>('POST', '/api/browser/network/har', {}, { tab }),
};

let current: BrowserClient = browserClient;

/** Set by `browserView`; the screen calls the server through `browserApi`. */
export const bindBrowserClient = (client: BrowserClient) => {
  current = client;
};

export const browserApi: BrowserClient = new Proxy({} as BrowserClient, {
  get: (_, key) => current[key as keyof BrowserClient],
});
