import type { CdpSession } from './client.ts';

export type StorageKind = 'local' | 'session';

export interface StorageItem {
  key: string;
  value: string;
}

export interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  /** Unix seconds; omitted for a session cookie. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** Origin of an http(s) URL, or undefined for pages without storage (about:, chrome:, data:). */
export function originOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** DOMStorage addresses a store by origin; newer Chrome versions may require the storage key instead. */
async function storageCall(session: CdpSession, origin: string, kind: StorageKind, method: string, params: object = {}): Promise<any> {
  const isLocalStorage = kind === 'local';
  try {
    return await session.send(method, { storageId: { securityOrigin: origin, isLocalStorage }, ...params });
  } catch (first) {
    try {
      const tree = await session.send('Page.getFrameTree');
      const key = await session.send('Storage.getStorageKeyForFrame', { frameId: tree.frameTree.frame.id });
      return await session.send(method, { storageId: { storageKey: key.storageKey, isLocalStorage }, ...params });
    } catch {
      throw first;
    }
  }
}

export async function getStorageItems(session: CdpSession, origin: string, kind: StorageKind): Promise<StorageItem[]> {
  const r = await storageCall(session, origin, kind, 'DOMStorage.getDOMStorageItems');
  return ((r.entries ?? []) as string[][]).map(([key, value]) => ({ key: String(key), value: String(value ?? '') }));
}

export async function setStorageItem(session: CdpSession, origin: string, kind: StorageKind, key: string, value: string): Promise<void> {
  await storageCall(session, origin, kind, 'DOMStorage.setDOMStorageItem', { key, value });
}

export async function removeStorageItem(session: CdpSession, origin: string, kind: StorageKind, key: string): Promise<void> {
  await storageCall(session, origin, kind, 'DOMStorage.removeDOMStorageItem', { key });
}

export async function clearStorage(session: CdpSession, origin: string, kind: StorageKind): Promise<void> {
  await storageCall(session, origin, kind, 'DOMStorage.clear');
}

export async function listIndexedDb(session: CdpSession, origin: string): Promise<string[]> {
  await session.send('IndexedDB.enable').catch(() => undefined);
  const r = await session.send('IndexedDB.requestDatabaseNames', { securityOrigin: origin });
  return ((r.databaseNames ?? []) as unknown[]).map(String);
}

export async function deleteIndexedDb(session: CdpSession, origin: string, name: string): Promise<void> {
  await session.send('IndexedDB.deleteDatabase', { securityOrigin: origin, databaseName: name });
}

/** Cookies, web storage, IndexedDB, cache storage and service workers of the origin; optionally the HTTP cache too. */
export async function clearSiteData(session: CdpSession, origin: string, opts: { cache?: boolean } = {}): Promise<void> {
  await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  if (opts.cache) await session.send('Network.clearBrowserCache');
}

/** Creates or overwrites a cookie; throws when the browser rejects it. */
export async function setCookie(session: CdpSession, c: CookieInput, pageUrl: string): Promise<void> {
  const params: Record<string, unknown> = {
    name: c.name,
    value: c.value,
    path: c.path || '/',
    ...(c.domain ? { domain: c.domain } : { url: pageUrl }),
    ...(c.expires !== undefined ? { expires: c.expires } : {}),
    ...(c.httpOnly ? { httpOnly: true } : {}),
    ...(c.secure ? { secure: true } : {}),
    ...(c.sameSite ? { sameSite: c.sameSite } : {}),
  };
  const r = await session.send('Network.setCookie', params);
  if (r.success === false) throw new Error('The browser rejected the cookie (check domain, Secure and SameSite).');
}
