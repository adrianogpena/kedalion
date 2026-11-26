import { authHeader, sourceFetch, type ResolvedConnection } from '../../server';
import { pickFieldIds, type FieldIds } from './map';

type Raw = Record<string, any>;

const trimBase = (conn: ResolvedConnection): string => conn.baseUrl.replace(/\/+$/, '');

/** Headers of every Jira request: basic auth with a user (Cloud), bearer without (Server / Data Center PAT). */
export const jiraHeaders = (conn: ResolvedConnection): Record<string, string> => ({
  Authorization: authHeader(conn, 'jira'),
  Accept: 'application/json',
});

/** `POST /rest/api/3/search/jql` request; `nextPageToken` asks for the page after the previous one. */
export function searchV3Request(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number, nextPageToken?: string): { url: string; init: RequestInit } {
  const body: Raw = { jql, maxResults: max, fields };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  return {
    url: `${trimBase(conn)}/rest/api/3/search/jql`,
    init: { method: 'POST', headers: { ...jiraHeaders(conn), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  };
}

/** `GET /rest/api/2/search` request; `startAt` skips the issues of the previous pages. */
export function searchV2Request(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number, validateQuery?: 'warn', startAt = 0): { url: string; init: RequestInit } {
  const q = new URLSearchParams({ jql, maxResults: String(max), fields: fields.join(',') });
  if (startAt > 0) q.set('startAt', String(startAt));
  if (validateQuery) q.set('validateQuery', validateQuery);
  return { url: `${trimBase(conn)}/rest/api/2/search?${q}`, init: { headers: jiraHeaders(conn) } };
}

/** Whether a failed request means the endpoint does not exist (the v3 to v2 fallback). */
export function isNotFound(err: unknown): boolean {
  const detail = (err as { opts?: { detail?: string } } | null)?.opts?.detail;
  return typeof detail === 'string' && detail.startsWith('404');
}

/** Whether a failed request was rejected as a bad request (400), e.g. a JQL naming a missing key. */
export function isBadRequest(err: unknown): boolean {
  const detail = (err as { opts?: { detail?: string } } | null)?.opts?.detail;
  return typeof detail === 'string' && detail.startsWith('400');
}

const noV3 = new Set<string>();
const noApproxCount = new Set<string>();

async function json(res: Response): Promise<Raw> {
  return (await res.json()) as Raw;
}

/** Largest page Jira returns; bigger `maxResults` are cut silently. */
const PAGE = 100;

/** Up to `max` issues of `jql` on v3, paged with `nextPageToken`. */
async function searchV3(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number, signal: AbortSignal): Promise<Raw[]> {
  const out: Raw[] = [];
  let token: string | undefined;
  while (out.length < max) {
    const r = searchV3Request(conn, jql, fields, Math.min(PAGE, max - out.length), token);
    const page = await json(await sourceFetch(r.url, r.init, { signal }));
    const issues = (page.issues ?? []) as Raw[];
    out.push(...issues);
    token = typeof page.nextPageToken === 'string' ? page.nextPageToken : undefined;
    if (!token || page.isLast === true || !issues.length) break;
  }
  return out.slice(0, max);
}

/** Up to `max` issues of `jql` on v2, paged with `startAt`. */
async function searchV2(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number, signal: AbortSignal): Promise<Raw[]> {
  const out: Raw[] = [];
  while (out.length < max) {
    const r = searchV2Request(conn, jql, fields, Math.min(PAGE, max - out.length), undefined, out.length);
    const page = await json(await sourceFetch(r.url, r.init, { signal }));
    const issues = (page.issues ?? []) as Raw[];
    out.push(...issues);
    if (!issues.length || (typeof page.total === 'number' && out.length >= page.total)) break;
  }
  return out.slice(0, max);
}

/** Up to `max` issues matching `jql` with `fields`, paged by 100; v3 first, v2 when v3 answers 404 (remembered per server). */
export async function search(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number, signal: AbortSignal): Promise<Raw[]> {
  const base = trimBase(conn);
  if (!noV3.has(base)) {
    try {
      return await searchV3(conn, jql, fields, max, signal);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      noV3.add(base);
    }
  }
  return searchV2(conn, jql, fields, max, signal);
}

const KEY_CHUNK = 100;
/** How long a key Jira rejected stays out of the key searches. */
const BAD_KEY_MS = 10 * 60_000;
/** `<base>|<KEY>` of rejected keys, to the time they may be tried again. */
const badKeys = new Map<string, number>();
const noV2 = new Set<string>();

const badKeyId = (base: string, key: string) => `${base}|${key.toUpperCase()}`;

/** Whether a failed request means the endpoint is not there (404, or 410 for a retired API). */
const isMissing = (err: unknown): boolean => {
  const detail = (err as { opts?: { detail?: string } } | null)?.opts?.detail;
  return typeof detail === 'string' && (detail.startsWith('404') || detail.startsWith('410'));
};

/**
 * Issues of one chunk of keys; on a 400 (a deleted, moved or forbidden key) retried on v2 with `validateQuery=warn`
 * (unless v2 is known missing), then split in halves searched one after the other. A single key still rejected is remembered.
 */
async function searchChunk(conn: ResolvedConnection, chunk: string[], fields: readonly string[], signal: AbortSignal): Promise<Raw[]> {
  const base = trimBase(conn);
  const jql = `key in (${chunk.join(',')})`;
  let failure: unknown;
  try {
    return await search(conn, jql, fields, chunk.length, signal);
  } catch (err) {
    if (!isBadRequest(err)) throw err;
    failure = err;
  }
  if (!noV2.has(base)) {
    try {
      const r = searchV2Request(conn, jql, fields, chunk.length, 'warn');
      return ((await json(await sourceFetch(r.url, r.init, { signal }))).issues ?? []) as Raw[];
    } catch (err) {
      if (signal.aborted) throw err;
      if (isMissing(err)) noV2.add(base);
      else failure = err;
    }
  }
  if (chunk.length === 1) {
    if (isBadRequest(failure)) badKeys.set(badKeyId(base, chunk[0]!), Date.now() + BAD_KEY_MS);
    throw failure;
  }
  const mid = Math.ceil(chunk.length / 2);
  const out: Raw[] = [];
  let ok = false;
  let first: unknown;
  for (const half of [chunk.slice(0, mid), chunk.slice(mid)]) {
    try {
      out.push(...(await searchChunk(conn, half, fields, signal)));
      ok = true;
    } catch (err) {
      if (signal.aborted) throw err;
      first ??= err;
    }
  }
  if (!ok) throw first;
  return out;
}

/** Issues of `keys`, searched in parallel chunks of 100; failed chunks are skipped, throws only when every chunk failed. Keys rejected in the last 10 min are left out. */
export async function searchKeys(conn: ResolvedConnection, allKeys: readonly string[], fields: readonly string[], signal: AbortSignal): Promise<Raw[]> {
  const base = trimBase(conn);
  const now = Date.now();
  for (const [k, until] of badKeys) if (until <= now) badKeys.delete(k);
  const keys = allKeys.filter((k) => !badKeys.has(badKeyId(base, k)));
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += KEY_CHUNK) chunks.push(keys.slice(i, i + KEY_CHUNK));
  const results = await Promise.allSettled(chunks.map((c) => searchChunk(conn, c, fields, signal)));
  if (results.length && results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/** How many issues match `jql`: `approximate-count` on v3, `total` of v2 when that is missing. */
export async function count(conn: ResolvedConnection, jql: string, signal: AbortSignal): Promise<number> {
  const base = trimBase(conn);
  if (!noV3.has(base) && !noApproxCount.has(base)) {
    try {
      const res = await sourceFetch(`${base}/rest/api/3/search/approximate-count`, { method: 'POST', headers: { ...jiraHeaders(conn), 'Content-Type': 'application/json' }, body: JSON.stringify({ jql }) }, { signal });
      return Number((await json(res)).count ?? 0);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      noApproxCount.add(base);
    }
  }
  const r = searchV2Request(conn, jql, ['summary'], 0);
  try {
    return Number((await json(await sourceFetch(r.url, r.init, { signal }))).total ?? 0);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    return (await search(conn, jql, ['summary'], 100, signal)).length;
  }
}

/** `GET /rest/agile/1.0<path>`. */
export async function agile(conn: ResolvedConnection, path: string, signal: AbortSignal): Promise<Raw> {
  return json(await sourceFetch(`${trimBase(conn)}/rest/agile/1.0${path}`, { headers: jiraHeaders(conn) }, { signal }));
}

/** `GET /rest/api/2<path>`, for lists that are not issues (favourite filters). */
export async function apiGet(conn: ResolvedConnection, path: string, signal: AbortSignal): Promise<unknown> {
  const res = await sourceFetch(`${trimBase(conn)}/rest/api/2${path}`, { headers: jiraHeaders(conn) }, { signal });
  return res.json();
}

const fieldCache = new Map<string, Promise<FieldIds>>();

/** `promise`, rejected early when `signal` aborts (the promise itself keeps running). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * The story points and sprint field ids of the server, read once per connection for the server's life.
 * The shared request has its own timeout; a caller's abort only rejects that caller.
 */
export function fieldIds(conn: ResolvedConnection, signal: AbortSignal): Promise<FieldIds> {
  const key = `${trimBase(conn)}|${conn.user ?? ''}`;
  let hit = fieldCache.get(key);
  if (!hit) {
    hit = sourceFetch(`${trimBase(conn)}/rest/api/2/field`, { headers: jiraHeaders(conn) }, { signal: AbortSignal.timeout(15_000) })
      .then(async (res) => pickFieldIds(await res.json()))
      .catch(() => {
        fieldCache.delete(key);
        return {};
      });
    fieldCache.set(key, hit);
  }
  return untilAborted(hit, signal);
}
