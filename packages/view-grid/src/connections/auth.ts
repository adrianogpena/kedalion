import { SourceError, sourceFetch } from './errors';
import { GITHUB_API, type ConnectionStore, type ConnectionType } from './store';

/** What a source needs to call a service. */
export interface ResolvedConnection {
  baseUrl: string;
  user?: string;
  token: string;
}

export interface SpawnResult {
  code: number;
  stdout: string;
}

/** Runs a command; rejects when it cannot start (e.g. `gh` is not installed). */
export type Spawn = (cmd: string[]) => Promise<SpawnResult>;

export const bunSpawn: Spawn = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', windowsHide: true });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout };
};

/** The `Authorization` header value: Jira with a user is basic auth (email + API token), otherwise bearer. */
export function authHeader(c: { user?: string; token: string }, type: ConnectionType): string {
  if (type === 'jira' && c.user) return `Basic ${Buffer.from(`${c.user}:${c.token}`).toString('base64')}`;
  return `Bearer ${c.token}`;
}

/** The host `gh auth token --hostname` needs for a GitHub API base URL, or undefined for github.com. */
export function ghHostname(baseUrl: string): string | undefined {
  const host = new URL(baseUrl).host;
  return host === new URL(GITHUB_API).host || host === 'github.com' ? undefined : host;
}

/** The token of the `gh` CLI; `not-configured` when `gh` is missing or not logged in. */
export async function ghToken(baseUrl: string, spawn: Spawn = bunSpawn): Promise<string> {
  const host = ghHostname(baseUrl);
  let res: SpawnResult;
  try {
    res = await spawn(['gh', 'auth', 'token', ...(host ? ['--hostname', host] : [])]);
  } catch {
    throw SourceError('not-configured', 'The GitHub CLI (gh) is not installed.');
  }
  const token = res.stdout.trim();
  if (res.code !== 0 || !token) throw SourceError('not-configured', 'The GitHub CLI (gh) has no token; run gh auth login.');
  return token;
}

/** Resolves connection `id` of `type` for a source (the first one of `type` when `id` is empty); none, or the wrong type, is `not-configured`. */
export async function resolveConnection(store: ConnectionStore, id: string, type: ConnectionType, spawn: Spawn = bunSpawn): Promise<ResolvedConnection> {
  const c = id ? await store.get(id) : await store.first(type);
  if (!c || c.type !== type) throw SourceError('not-configured', 'The connection is not set up.');
  const token = c.token || (type === 'github' ? await ghToken(c.baseUrl, spawn) : '');
  if (!token) throw SourceError('not-configured', 'The connection has no token.');
  return { baseUrl: c.baseUrl, ...(c.user ? { user: c.user } : {}), token };
}

export interface TestResult {
  ok: boolean;
  user?: string;
  error?: { code: string; message: string };
}

/** Calls the service's "who am I" endpoint with the connection's credentials. */
export async function testConnection(store: ConnectionStore, id: string, spawn: Spawn = bunSpawn, signal?: AbortSignal): Promise<TestResult> {
  const c = await store.get(id);
  if (!c) return { ok: false, error: { code: 'source-not-configured', message: 'The connection is not set up.' } };
  try {
    const r = await resolveConnection(store, id, c.type, spawn);
    const url = c.type === 'github' ? `${r.baseUrl}/user` : c.type === 'todoist' ? `${r.baseUrl}/projects?limit=1` : `${r.baseUrl}/rest/api/2/myself`;
    const res = await sourceFetch(url, { headers: { Authorization: authHeader(r, c.type), Accept: 'application/json', 'User-Agent': 'kedalion' } }, { signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const user = [body.login, body.displayName, body.name, body.emailAddress].find((v): v is string => typeof v === 'string' && v !== '');
    return { ok: true, user };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (!e.code?.startsWith('source-')) throw err;
    return { ok: false, error: { code: e.code, message: e.message ?? '' } };
  }
}
