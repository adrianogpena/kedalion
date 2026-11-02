import { request } from '@kedalion/ui';
import type { TabInfo } from '@kedalion/cdp';

/** The server calls the Browser screen makes; the live state (frames, tabs, dialogs) comes over the socket. */
export interface BrowserClient {
  socketTicket: () => Promise<{ ticket: string }>;
  openTab: (url?: string) => Promise<{ tab: TabInfo }>;
  closeTab: (id: string) => Promise<unknown>;
  navigate: (id: string, input: { url: string } | { action: 'back' | 'forward' | 'reload' | 'stop' }) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  setFiles: (tab: string, id: string, paths: string[]) => Promise<unknown>;
}

export const browserClient: BrowserClient = {
  socketTicket: () => request<{ ticket: string }>('POST', '/api/browser/socket-ticket'),
  openTab: (url) => request<{ tab: TabInfo }>('POST', '/api/browser/tabs', {}, url === undefined ? {} : { url }),
  closeTab: (id) => request('POST', '/api/browser/tabs/close', {}, { id }),
  navigate: (id, input) => request('POST', '/api/browser/navigate', {}, { id, ...input }),
  openExternal: (url) => request('POST', '/api/browser/open-external', {}, { url }),
  setFiles: (tab, id, paths) => request('POST', '/api/browser/files', {}, { tab, id, paths }),
};

let current: BrowserClient = browserClient;

/** Set by `browserView`; the screen calls the server through `browserApi`. */
export const bindBrowserClient = (client: BrowserClient) => {
  current = client;
};

export const browserApi: BrowserClient = new Proxy({} as BrowserClient, {
  get: (_, key) => current[key as keyof BrowserClient],
});
