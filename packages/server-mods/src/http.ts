import { extname } from 'node:path';
import { writeFileAtomic } from '@kedalion/platform';
import { AppError, forbidden, invalid, isRecord, type Routes } from '@kedalion/server-core';
import {
  HTTP_MAX_BODY_BYTES,
  HTTP_MAX_BODY_CHARS,
  HTTP_MAX_FORM_FIELDS,
  HTTP_MAX_HEADERS,
  HTTP_MAX_URL_CHARS,
  HTTP_METHODS,
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
  REST_VAR_REFERENCE,
  type HttpMethod,
  type HttpRequestDraft,
  type HttpRequestSpec,
  type HttpResponseInfo,
  type RestHistoryEntry,
} from '@kedalion/server-core/protocol';
import { isBinary } from './bytes.ts';
import type { DialogPicks } from './file-dialog.ts';
import { variableResolver, type VariableResolver } from './rest-env.ts';

export interface HttpExecutorOptions {
  /** Most body bytes read; the rest is cut and the response is marked `truncated`. */
  maxBodyBytes?: number;
  /** How many response bodies stay available to `body`/save; the oldest is dropped. */
  keep?: number;
  fetchImpl?: typeof fetch;
}

export interface KeptBody {
  bytes: Uint8Array;
  contentType: string;
  /** The final URL. */
  url: string;
}

/** A request as the executor gets it: `secretHeaderNames` lists headers added from a secret, dropped when a redirect leaves the origin. */
export interface HttpExecSpec extends HttpRequestSpec {
  secretHeaderNames?: string[];
}

const MAX_REDIRECTS = 10;
const CROSS_ORIGIN_DROP = ['authorization', 'cookie', 'proxy-authorization'];

export interface HttpExecutor {
  send(spec: HttpExecSpec, signal?: AbortSignal): Promise<HttpResponseInfo>;
  body(id: string): KeptBody | undefined;
}

export interface HttpRoutesOptions {
  /**
   * Headers to add for a saved request's secret, for names the request doesn't have; the values never reach the client.
   * `url` is the resolved URL being sent; `resolve` substitutes the environment in other text (unknown names stay as they are).
   * The returned values are resolved by the route; an unknown name there is `unknownVariable`.
   */
  secretHeaders?: (ref: string, url: string, resolve: (text: string) => string) => Promise<Array<[string, string]>>;
  /** The variables of environment `id` for `{{name}}` (secrets included); throws for an unknown id. */
  environmentVars?: (id: string) => Promise<Record<string, string>>;
  /** Names of the secret variables of environment `id`; headers referencing one are dropped when a redirect leaves the origin. */
  secretVars?: (id: string) => Promise<string[]>;
  /** Called once per send, failures included (status 0 and `error`), with the unresolved request minus Authorization. */
  onSend?: (entry: Omit<RestHistoryEntry, 'id'>) => unknown;
  /** The in-app file dialog's picks: `save` takes a `target` that is in `saveTargets`. Missing: every save is refused. */
  picks?: Pick<DialogPicks, 'saveTargets'>;
}

const MAX_HEADER_NAME_CHARS = 200;
const MAX_HEADER_VALUE_CHARS = 8192;
const DEFAULT_TIMEOUT_MS = 60_000;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE_BAD = /[\r\n\0]/;

const badRequest = () => invalid('badRequest', 'Invalid request.');
const formChars = (rows: Array<{ name: string; value: string }>) => rows.reduce((n, r) => n + r.name.length + r.value.length, 0);
const validTimeout = (ms: unknown): ms is number => typeof ms === 'number' && Number.isInteger(ms) && ms >= HTTP_TIMEOUT_MIN_MS && ms <= HTTP_TIMEOUT_MAX_MS;

/** The request as a fresh, fully defaulted spec; throws an `invalid` AppError for anything out of range (never clamps). */
export function validateRequest(input: unknown): HttpRequestSpec {
  if (!isRecord(input)) throw badRequest();
  const { method, url, headers = [], body, bodyKind, form, timeoutMs = DEFAULT_TIMEOUT_MS, insecure = false, followRedirects = true } = input;
  if (typeof method !== 'string') throw badRequest();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) throw invalid('badMethod', 'This HTTP method is not supported.');
  if (typeof url !== 'string') throw badRequest();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('badUrl', 'Enter a valid http:// or https:// URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw invalid('badUrl', 'Enter a valid http:// or https:// URL.');
  if (!Array.isArray(headers)) throw badRequest();
  const pairs: Array<[string, string]> = headers.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') throw badRequest();
    return [pair[0], pair[1]];
  });
  if (pairs.length > HTTP_MAX_HEADERS || pairs.some(([name, value]) => !HEADER_NAME.test(name) || HEADER_VALUE_BAD.test(value))) {
    throw invalid('badHeader', 'A header name or value is not valid.');
  }
  if (body !== undefined && (typeof body !== 'string' || body.length > HTTP_MAX_BODY_CHARS)) throw badRequest();
  let fields: Array<[string, string]> = [];
  if (bodyKind !== undefined) {
    if ((bodyKind !== 'form' && bodyKind !== 'multipart') || body !== undefined || !Array.isArray(form) || form.length > HTTP_MAX_FORM_FIELDS) throw badRequest();
    fields = form.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') throw badRequest();
      return [pair[0], pair[1]];
    });
    if (formChars(fields.map(([name, value]) => ({ name, value }))) > HTTP_MAX_BODY_CHARS) throw badRequest();
  } else if (form !== undefined) throw badRequest();
  if ((body || fields.length) && (method === 'GET' || method === 'HEAD')) throw invalid('bodyNotAllowed', 'GET and HEAD requests cannot have a body.');
  if (!validTimeout(timeoutMs)) throw badRequest();
  if (typeof insecure !== 'boolean' || typeof followRedirects !== 'boolean') throw badRequest();
  const spec: HttpRequestSpec = { method: method as HttpMethod, url, headers: pairs, timeoutMs, insecure, followRedirects };
  if (body) spec.body = body;
  if (fields.length) {
    spec.bodyKind = bodyKind as 'form' | 'multipart';
    spec.form = fields;
  }
  return spec;
}

const resolvePairs = (list: unknown, resolve: (text: string) => string, names: boolean) =>
  Array.isArray(list)
    ? list.map((pair) =>
        Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string'
          ? [names ? resolve(pair[0]) : pair[0], resolve(pair[1])]
          : pair,
      )
    : list;

/**
 * Raw send input with `{{name}}` resolved in the URL, header values, body and form fields; other
 * values are left for `validateRequest` to reject. Unknown names are collected in `vars.missing`.
 */
export function resolveRequest(input: unknown, vars: VariableResolver): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = { ...input };
  if (typeof out.url === 'string') out.url = vars.resolve(out.url);
  if (typeof out.body === 'string') out.body = vars.resolve(out.body);
  out.headers = resolvePairs(out.headers, vars.resolve, false);
  out.form = resolvePairs(out.form, vars.resolve, true);
  if (out.headers === undefined) delete out.headers;
  if (out.form === undefined) delete out.form;
  return out;
}

const BODY_LANGS = ['json', 'xml', 'text', 'form', 'multipart'] as const;
const badSavedRequest = () => invalid('badSavedRequest', 'The request is not valid.');

/**
 * A saved request draft as a fresh object; throws `badSavedRequest` for anything out of range.
 * Looser than `validateRequest` (an empty or unfinished URL can be saved), but within its limits.
 */
export function validateDraft(raw: unknown): HttpRequestDraft {
  if (!isRecord(raw)) throw badSavedRequest();
  const { method, url, headers, body, bodyLang, form, authKind, timeoutMs, insecure, followRedirects } = raw;
  if (!(HTTP_METHODS as readonly unknown[]).includes(method)) throw badSavedRequest();
  if (typeof url !== 'string' || url.length > HTTP_MAX_URL_CHARS) throw badSavedRequest();
  if (!Array.isArray(headers) || headers.length > HTTP_MAX_HEADERS) throw badSavedRequest();
  if (typeof body !== 'string' || body.length > HTTP_MAX_BODY_CHARS) throw badSavedRequest();
  if (!(BODY_LANGS as readonly unknown[]).includes(bodyLang)) throw badSavedRequest();
  const out: HttpRequestDraft = {
    method: method as HttpMethod,
    url,
    headers: headers.map((h) => {
      if (
        !isRecord(h) ||
        typeof h.name !== 'string' ||
        h.name.length > MAX_HEADER_NAME_CHARS ||
        typeof h.value !== 'string' ||
        h.value.length > MAX_HEADER_VALUE_CHARS ||
        typeof h.enabled !== 'boolean'
      ) {
        throw badSavedRequest();
      }
      return { name: h.name, value: h.value, enabled: h.enabled };
    }),
    body,
    bodyLang: bodyLang as HttpRequestDraft['bodyLang'],
  };
  if (form !== undefined) {
    if (!Array.isArray(form) || form.length > HTTP_MAX_FORM_FIELDS) throw badSavedRequest();
    out.form = form.map((f) => {
      if (!isRecord(f) || typeof f.name !== 'string' || typeof f.value !== 'string') throw badSavedRequest();
      return { name: f.name, value: f.value };
    });
    if (formChars(out.form) > HTTP_MAX_BODY_CHARS) throw badSavedRequest();
  }
  if (authKind !== undefined) {
    if (authKind !== 'basic' && authKind !== 'bearer') throw badSavedRequest();
    out.authKind = authKind;
  }
  if (timeoutMs !== undefined) {
    if (!validTimeout(timeoutMs)) throw badSavedRequest();
    out.timeoutMs = timeoutMs;
  }
  if (insecure !== undefined) {
    if (typeof insecure !== 'boolean') throw badSavedRequest();
    out.insecure = insecure;
  }
  if (followRedirects !== undefined) {
    if (typeof followRedirects !== 'boolean') throw badSavedRequest();
    out.followRedirects = followRedirects;
  }
  return out;
}

const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization']);

/** A copy of the draft without Authorization and Proxy-Authorization headers. */
export function withoutAuthorization(draft: HttpRequestDraft): HttpRequestDraft {
  return { ...draft, headers: draft.headers.filter((h) => !AUTH_HEADERS.has(h.name.trim().toLowerCase())) };
}

const pairsOf = (list: unknown) =>
  Array.isArray(list) ? list.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string') : [];

/**
 * The draft the history keeps for a send body: its `draft` when valid, else one built from the
 * unresolved `request` (body language from Content-Type). Null when neither is usable.
 */
export function historyDraft(body: Record<string, unknown>): HttpRequestDraft | null {
  try {
    if (body.draft !== undefined) return withoutAuthorization(validateDraft(body.draft));
  } catch {
    // fall back to the request
  }
  const req = body.request;
  if (!isRecord(req)) return null;
  const headers = pairsOf(req.headers);
  const type = (headers.find(([n]) => n.toLowerCase() === 'content-type')?.[1] ?? '').toLowerCase();
  const scheme = headers.find(([n]) => n.toLowerCase() === 'authorization')?.[1].trim().split(/\s+/)[0]?.toLowerCase();
  const kind = req.bodyKind === 'form' || req.bodyKind === 'multipart' ? req.bodyKind : undefined;
  const raw: Record<string, unknown> = {
    method: req.method,
    url: req.url,
    headers: headers.map(([name, value]) => ({ name, value, enabled: true })),
    body: typeof req.body === 'string' ? req.body : '',
    bodyLang: kind ?? (type.includes('json') ? 'json' : type.includes('xml') ? 'xml' : 'text'),
    timeoutMs: req.timeoutMs,
    insecure: req.insecure,
    followRedirects: req.followRedirects,
  };
  if (kind) raw.form = pairsOf(req.form).map(([name, value]) => ({ name, value }));
  if (scheme === 'basic' || scheme === 'bearer') raw.authKind = scheme;
  try {
    return withoutAuthorization(validateDraft(raw));
  } catch {
    return null;
  }
}

const isTextType = (contentType: string) => {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return (
    type === '' ||
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type === 'application/x-www-form-urlencoded'
  );
};

/**
 * The HTTP engine of the base: sends a validated request from the server (no CORS, and the
 * session token never leaves) and keeps the last `keep` response bodies for saving.
 */
export function httpExecutor(opts: HttpExecutorOptions = {}): HttpExecutor {
  const { maxBodyBytes = HTTP_MAX_BODY_BYTES, keep = 10, fetchImpl = fetch } = opts;
  const kept = new Map<string, KeptBody>();

  async function read(res: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBodyBytes - total;
      if (value.length > room) {
        chunks.push(value.subarray(0, room));
        total += room;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.length;
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return { bytes, truncated };
  }

  return {
    async send(spec, signal) {
      const timeout = AbortSignal.timeout(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const started = performance.now();
      let headers = spec.headers;
      let body: string | URLSearchParams | FormData | undefined = spec.body;
      if (spec.bodyKind && spec.form) {
        if (spec.bodyKind === 'multipart') {
          const data = new FormData();
          for (const [name, value] of spec.form) data.append(name, value);
          body = data;
          headers = headers.filter(([name]) => name.toLowerCase() !== 'content-type');
        } else {
          body = new URLSearchParams(spec.form);
          if (!headers.some(([name]) => name.toLowerCase() === 'content-type')) {
            headers = [...headers, ['Content-Type', 'application/x-www-form-urlencoded']];
          }
        }
      }
      const follow = spec.followRedirects !== false;
      // With secret headers, redirects are followed by hand so the secrets never reach another origin.
      const manualFollow = follow && (spec.secretHeaderNames?.length ?? 0) > 0;
      const secretNames = new Set((spec.secretHeaderNames ?? []).map((n) => n.toLowerCase()));
      const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        let url = spec.url;
        let method: string = spec.method;
        let hops = 0;
        const origin = new URL(spec.url).origin;
        let res: Response;
        for (;;) {
          res = await fetchImpl(url, {
            method,
            headers,
            body,
            redirect: follow && !manualFollow ? 'follow' : 'manual',
            signal: fetchSignal,
            tls: { rejectUnauthorized: !spec.insecure },
          });
          const location = res.headers.get('location');
          if (!manualFollow || res.status < 300 || res.status >= 400 || res.status === 304 || !location) break;
          if (hops >= MAX_REDIRECTS) throw invalid('httpFailed', 'Too many redirects.');
          hops++;
          await res.body?.cancel().catch(() => {});
          const next = new URL(location, url);
          if (next.protocol !== 'http:' && next.protocol !== 'https:') throw invalid('httpFailed', 'A redirect went to an unsupported URL.');
          if (res.status === 303 ? method !== 'HEAD' : (res.status === 301 || res.status === 302) && method === 'POST') {
            method = 'GET';
            body = undefined;
            headers = headers.filter(([name]) => !['content-type', 'content-length'].includes(name.toLowerCase()));
          }
          if (next.origin !== origin) {
            headers = headers.filter(([name]) => !secretNames.has(name.toLowerCase()) && !CROSS_ORIGIN_DROP.includes(name.toLowerCase()));
          }
          url = next.href;
        }
        const ms = Math.round(performance.now() - started);
        const { bytes, truncated } = await read(res);
        const totalMs = Math.round(performance.now() - started);
        const contentType = res.headers.get('content-type') ?? '';
        const id = crypto.randomUUID();
        const finalUrl = res.url || url;
        kept.set(id, { bytes, contentType, url: finalUrl });
        while (kept.size > keep) kept.delete(kept.keys().next().value as string);
        const info: HttpResponseInfo = {
          id,
          status: res.status,
          statusText: res.statusText,
          url: finalUrl,
          redirected: res.redirected || hops > 0,
          headers: [...res.headers],
          ms,
          totalMs,
          size: bytes.length,
          truncated,
          contentType,
          fileName: suggestedName(finalUrl, contentType),
        };
        if (isTextType(contentType) && !isBinary(bytes)) info.text = new TextDecoder().decode(bytes);
        else info.binary = true;
        return info;
      } catch (err) {
        if (signal?.aborted) throw err;
        if (timeout.aborted) throw invalid('httpTimeout', 'The request timed out.');
        if (err instanceof AppError) throw err;
        throw new AppError('invalid', 'httpFailed', 'The request failed.', { detail: err instanceof Error ? err.message : String(err) });
      }
    },
    body: (id) => kept.get(id),
  };
}

const EXTENSIONS: Array<[string, string]> = [
  ['json', '.json'],
  ['html', '.html'],
  ['xml', '.xml'],
  ['text/', '.txt'],
];

/** A file name for a saved response: the last segment of the URL path, made safe, with an extension from the content type when it has none. */
export function suggestedName(url: string, contentType: string): string {
  let name = new URL(url).pathname.split('/').pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not valid percent-encoding: keep the name as it is.
  }
  name = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .replace(/[. ]+$/, '');
  if (name === '') name = 'response';
  if (extname(name) === '') {
    const type = contentType.toLowerCase();
    name += EXTENSIONS.find(([part]) => type.includes(part))?.[1] ?? '';
  }
  return name;
}

/** Captured chain values from a send body: string values only, at most 100 names, 64 KB each. */
function validVars(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [name, value] of Object.entries(raw).slice(0, 100)) {
    if (typeof value === 'string' && value.length <= 65536) out[name] = value;
  }
  return out;
}

/** `POST /api/http/send` (`HttpSendInput`: `{ request, secretRef?, environment? }`, `{{name}}` resolved before sending) and `POST /api/http/save` (`{ id, target }`, `target` is the path the in-app save dialog returned). */
export function httpRoutes(executor: HttpExecutor, opts: HttpRoutesOptions = {}): Routes {
  const { secretHeaders, environmentVars, secretVars, onSend, picks } = opts;

  async function send(body: Record<string, unknown>, signal: AbortSignal): Promise<HttpResponseInfo> {
    const values = { ...(typeof body.environment === 'string' && environmentVars ? await environmentVars(body.environment) : {}), ...validVars(body.vars) };
    const vars = variableResolver(values);
    const request = resolveRequest(body.request, vars);
    vars.check();
    const spec: HttpExecSpec = validateRequest(request);
    // Cookie and headers whose raw value references a secret variable stay on the request's origin.
    const secretVarNames = new Set(typeof body.environment === 'string' && secretVars ? await secretVars(body.environment) : []);
    const added: string[] = [];
    for (const [name, raw] of pairsOf(isRecord(body.request) ? body.request.headers : undefined)) {
      const refsSecret = [...raw.matchAll(REST_VAR_REFERENCE)].some((m) => secretVarNames.has(m[1]!));
      if ((name.toLowerCase() === 'cookie' || refsSecret) && !added.includes(name)) added.push(name);
    }
    if (typeof body.secretRef === 'string' && secretHeaders) {
      const have = new Set(spec.headers.map(([name]) => name.toLowerCase()));
      const loose = variableResolver(values);
      for (const [name, raw] of await secretHeaders(body.secretRef, spec.url, loose.resolve)) {
        if (have.has(name.toLowerCase())) continue;
        const value = vars.resolve(raw);
        vars.check();
        if (HEADER_VALUE_BAD.test(value)) throw invalid('badHeader', 'A header name or value is not valid.');
        have.add(name.toLowerCase());
        spec.headers.push([name, value]);
        added.push(name);
      }
    }
    if (added.length > 0) spec.secretHeaderNames = added;
    return executor.send(spec, signal);
  }

  return {
    'POST /api/http/send': async ({ req, json }) => {
      const body = await json();
      if (!isRecord(body) || (body.environment !== undefined && typeof body.environment !== 'string')) throw badRequest();
      if (!onSend) return send(body, req.signal);
      const at = Date.now();
      const record = (status: number, ms: number, error?: string) => {
        const draft = historyDraft(body);
        if (!draft) return;
        const entry: Omit<RestHistoryEntry, 'id'> = { at, method: draft.method, url: draft.url, status, ms, draft };
        if (error) entry.error = error;
        try {
          void Promise.resolve(onSend(entry)).catch(() => {});
        } catch {
          // history must never fail a send
        }
      };
      try {
        const res = await send(body, req.signal);
        record(res.status, res.totalMs);
        return res;
      } catch (err) {
        record(0, Date.now() - at, err instanceof AppError ? err.code : 'error');
        throw err;
      }
    },

    'POST /api/http/save': async ({ json }) => {
      const body = await json();
      if (!isRecord(body) || typeof body.id !== 'string') throw badRequest();
      const response = executor.body(body.id);
      if (!response) throw invalid('responseGone', 'This response is no longer kept; send the request again.');
      const path = body.target;
      if (typeof path !== 'string' || !picks?.saveTargets.take(path)) throw forbidden('notASaveTarget', 'Choose where to save first.');
      await writeFileAtomic(path, response.bytes);
      return { path, bytes: response.bytes.length };
    },
  };
}
