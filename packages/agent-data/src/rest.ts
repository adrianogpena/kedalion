import type { KeptBody } from '@kedalion/server-mods';
import type { HttpResponseInfo, RestEnvVar } from '@kedalion/server-core/protocol';
import { cellText, grepLines, jsonPick } from './format.ts';
import { failResult, type McpTool, textResult, type ToolResult } from './mcp.ts';

export interface RestEnvironment {
  id: string;
  name: string;
  vars: RestEnvVar[];
}

export interface RestDeps {
  /** `POST /api/http/send` without the route: `{ request, environment?, vars? }`, `{{name}}` resolved before sending. */
  send(input: Record<string, unknown>, signal?: AbortSignal): Promise<HttpResponseInfo>;
  /** The kept body of a response id (the last few), or undefined. */
  body(id: string): KeptBody | undefined;
  environments(): Promise<RestEnvironment[]>;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const DEFAULT_BODY = 6000;
const SHOWN_HEADERS = ['content-type', 'location', 'www-authenticate', 'retry-after', 'etag', 'x-request-id', 'content-disposition'];

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), min), max) : fallback);
const strings = (v: unknown): Array<[string, string]> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, x]) => [k, String(x)] as [string, string]) : []);
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
const isTextual = (type: string, bytes: Uint8Array) => /json|xml|text|javascript|html|yaml|csv|x-www-form/i.test(type) || !bytes.subarray(0, 1000).includes(0);

/** The body as text for reading: JSON re-indented (two spaces), anything else as it is. */
function readable(text: string, contentType: string): string {
  if (/json/i.test(contentType) || /^\s*[[{]/.test(text)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {}
  }
  return text;
}

/** One expectation check line per failure; empty when everything held. */
function failures(args: Record<string, unknown>, res: HttpResponseInfo, text: string | undefined): { failed: string[]; checks: number } {
  const failed: string[] = [];
  let checks = 0;
  if (typeof args.expectStatus === 'string' && args.expectStatus.trim()) {
    checks++;
    const ok = args.expectStatus.split(',').some((p) => {
      const want = p.trim().toLowerCase();
      return /^\dxx$/.test(want) ? String(res.status)[0] === want[0] : Number(want) === res.status;
    });
    if (!ok) failed.push(`status ${res.status}, expected ${args.expectStatus}`);
  }
  if (typeof args.expectBody === 'string') {
    checks++;
    if (!(text ?? '').includes(args.expectBody)) failed.push(`body does not contain "${cellText(args.expectBody, 60)}"`);
  }
  if (args.expectJson && typeof args.expectJson === 'object') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text ?? '');
    } catch {
      parsed = undefined;
    }
    for (const [path, want] of Object.entries(args.expectJson as Record<string, unknown>)) {
      checks++;
      const got = parsed === undefined ? undefined : jsonPick(parsed, path);
      if (got === undefined || (typeof got === 'object' && got !== null ? JSON.stringify(got) : String(got)) !== String(want)) failed.push(`${path} is ${got === undefined ? 'missing' : cellText(got, 60)}, expected ${cellText(want, 60)}`);
    }
  }
  return { failed, checks };
}

/** The part of a body a caller asked for: `select` (JSON path), `grep`, then the window `offset`/`limit`. */
function view(text: string, contentType: string, a: Record<string, unknown>, defaultLimit: number): { out: string; total: number; end: number } {
  let shown = readable(text, contentType);
  if (typeof a.select === 'string' && a.select) {
    try {
      const picked = jsonPick(JSON.parse(text), a.select);
      shown = picked === undefined ? `(no value at ${a.select})` : typeof picked === 'string' ? picked : JSON.stringify(picked, null, 2);
    } catch {
      shown = '(body is not JSON; select ignored)\n' + shown;
    }
  }
  if (typeof a.grep === 'string' && a.grep) shown = grepLines(shown, a.grep) || `(no line contains "${a.grep}")`;
  const offset = num(a.offset, 0, 0, shown.length);
  const limit = num(a.limit, defaultLimit, 100, 20_000);
  return { out: shown.slice(offset, offset + limit), total: shown.length, end: offset + limit };
}

const VIEW_PROPS = {
  select: { type: 'string', description: 'JSON path of the body to return, e.g. $.items[0].id (body must be JSON).' },
  grep: { type: 'string', description: 'Return only lines containing this text (case-insensitive), with one line of context.' },
  offset: { type: 'integer', description: 'Start character of the returned window (default 0).' },
  limit: { type: 'integer', description: `Window size in characters (default ${DEFAULT_BODY}, max 20000).` },
} as const;

/** The REST tools: send a request, read more of a response, list environments. */
export function restTools(deps: RestDeps): McpTool[] {
  async function send(args: Record<string, unknown>): Promise<ToolResult> {
    const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
    if (!(METHODS as readonly string[]).includes(method)) return failResult(`Unknown method ${method}. Use ${METHODS.join(', ')}.`);
    let url = String(args.url);
    const query = strings(args.query);
    if (query.length) url += (url.includes('?') ? '&' : '?') + query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const headers = strings(args.headers);
    const request: Record<string, unknown> = { method, url, headers };
    const form = strings(args.form);
    if (form.length) {
      request.bodyKind = 'form';
      request.form = form;
    } else if (typeof args.body === 'string') {
      request.body = args.body;
      if (/^\s*[[{]/.test(args.body) && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json']);
    }
    if (typeof args.timeoutMs === 'number') request.timeoutMs = args.timeoutMs;
    if (typeof args.insecure === 'boolean') request.insecure = args.insecure;
    if (typeof args.followRedirects === 'boolean') request.followRedirects = args.followRedirects;

    const input: Record<string, unknown> = { request };
    const named = typeof args.environment === 'string' && args.environment.trim() !== '';
    if (!named) {
      const given = new Set(Object.keys(args.vars && typeof args.vars === 'object' ? args.vars : {}));
      const text = [url, ...headers.flat(), ...form.flat(), typeof args.body === 'string' ? args.body : ''].join(' ');
      const open = [...new Set([...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!))].filter((n) => !n.startsWith('$') && !given.has(n));
      if (open.length) {
        const all = await deps.environments();
        return failResult(`The request uses {{${open.join('}}, {{')}}} but no environment was given. Ask the user which environment to use; do not choose one. Saved: ${all.map((e) => e.name).join(', ') || 'none'}`);
      }
    }
    if (named) {
      const all = await deps.environments();
      const want = String(args.environment).trim().toLowerCase();
      const env = all.find((e) => e.id === args.environment) ?? all.find((e) => e.name.toLowerCase() === want);
      if (!env) throw new Error(`Unknown environment "${args.environment}". Saved: ${all.map((e) => e.name).join(', ') || 'none'}`);
      input.environment = env.id;
    }
    if (args.vars && typeof args.vars === 'object') input.vars = Object.fromEntries(strings(args.vars));

    const res = await deps.send(input);
    const kept = deps.body(res.id);
    const text = res.text ?? (kept && isTextual(res.contentType, kept.bytes) ? new TextDecoder().decode(kept.bytes) : undefined);
    const lines = [`${res.status} ${res.statusText}  ${res.totalMs} ms  ${size(res.size)}${res.truncated ? ' (cut at the size limit)' : ''}  ${method} ${res.url}${res.redirected ? ' (redirected)' : ''}`];
    const shownHeaders = args.allHeaders === true ? res.headers : res.headers.filter(([k]) => SHOWN_HEADERS.includes(k.toLowerCase()));
    if (shownHeaders.length) lines.push(`headers: ${shownHeaders.map(([k, v]) => `${k.toLowerCase()}=${cellText(v, 150)}`).join('; ')}`);
    const setCookies = res.headers.filter(([k]) => k.toLowerCase() === 'set-cookie').length;
    if (setCookies && args.allHeaders !== true) lines.push(`set-cookie: ${setCookies} (allHeaders=true shows them)`);
    if (text === undefined) lines.push(`body: binary, ${size(res.size)}; not shown`);
    else if (text === '') lines.push('body: empty');
    else {
      const v = view(text, res.contentType, args, DEFAULT_BODY);
      lines.push(`body${v.total > v.end ? ` (chars ${num(args.offset, 0, 0, v.total)}-${v.end} of ${v.total}; rest: rest_body id=${res.id} offset=${v.end})` : ''}:`, v.out);
    }
    const { failed, checks } = failures(args, res, text);
    if (checks) lines.push(failed.length ? `ASSERT FAIL (${checks - failed.length}/${checks} passed): ${failed.join('; ')}` : `ASSERT PASS (${checks}/${checks})`);
    const out = textResult(lines.filter((l) => l !== '').join('\n'), `Use select, grep or rest_body id=${res.id}.`);
    return failed.length ? { ...out, isError: true } : out;
  }

  return [
    {
      name: 'rest_send',
      description: `Send one HTTP request from the Kedalion server and return the status line, timing, key headers and the body (JSON re-indented, cut to ${DEFAULT_BODY} chars with the command to read the rest). {{name}} in the url, headers, body and form is replaced from the chosen environment (secret values are used but never shown), plus {{$uuid}}, {{$timestamp}}, {{$isoTimestamp}}, {{$randomInt}}. Set expectStatus/expectBody/expectJson to turn it into a test: the result ends with ASSERT PASS or ASSERT FAIL and a failure is returned as an error. Responses are not stored as saved requests.`,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL, may contain {{variables}}.' },
          method: { type: 'string', description: `${METHODS.join(', ')} (any case). Default GET.` },
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Request headers, name to value. Content-Type: application/json is added for a body that starts with { or [.' },
          query: { type: 'object', additionalProperties: { type: 'string' }, description: 'Query parameters, appended to the URL and encoded.' },
          body: { type: 'string', description: 'Raw request body (not for GET/HEAD).' },
          form: { type: 'object', additionalProperties: { type: 'string' }, description: 'Fields of a urlencoded form body (instead of body).' },
          environment: { type: 'string', description: 'Environment name or id from rest_environments. Required when the request uses {{variables}}: use the one the user or the session context named, otherwise ask the user, never choose.' },
          vars: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra variables for {{name}}; they win over the environment.' },
          timeoutMs: { type: 'integer', description: 'Default 60000, 1000 to 300000.' },
          insecure: { type: 'boolean', description: 'Skip TLS certificate checks (default false).' },
          followRedirects: { type: 'boolean', description: 'Default true.' },
          allHeaders: { type: 'boolean', description: 'Show every response header, not only the key ones.' },
          expectStatus: { type: 'string', description: 'Expected status: 200, 2xx, or a list like 200,201.' },
          expectBody: { type: 'string', description: 'Text the body must contain.' },
          expectJson: { type: 'object', additionalProperties: { type: 'string' }, description: 'JSON path to expected value (compared as text), e.g. {"$.status": "ok", "$.items[0].id": "7"}.' },
          ...VIEW_PROPS,
        },
        required: ['url'],
      },
      run: send,
    },
    {
      name: 'rest_body',
      description: 'Read more of a response that rest_send cut, by the id it printed: a window (offset, limit), a JSON path (select) or matching lines (grep). Only the last 10 responses are kept.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The response id printed by rest_send.' }, ...VIEW_PROPS }, required: ['id'] },
      async run(args) {
        const kept = deps.body(String(args.id));
        if (!kept) return failResult('That response is no longer kept (only the last 10 are). Send the request again.');
        if (!isTextual(kept.contentType, kept.bytes)) return failResult(`Binary body (${size(kept.bytes.length)}, ${kept.contentType || 'unknown type'}); it cannot be shown.`);
        const v = view(new TextDecoder().decode(kept.bytes), kept.contentType, args, DEFAULT_BODY);
        return textResult(`${v.total > v.end || num(args.offset, 0, 0, v.total) > 0 ? `chars ${num(args.offset, 0, 0, v.total)}-${Math.min(v.end, v.total)} of ${v.total}${v.total > v.end ? `; next offset=${v.end}` : ''}\n` : ''}${v.out}`, 'Lower limit.');
      },
    },
    {
      name: 'rest_environments',
      description: 'List the saved REST environments and their variables: plain values are shown, secret ones only as set or unset. Use a name as `environment` in rest_send.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const all = await deps.environments();
        if (all.length === 0) return textResult('No environments. {{$uuid}}, {{$timestamp}}, {{$isoTimestamp}} and {{$randomInt}} still work.');
        return textResult(
          all
            .map((e) => `${e.name}: ${e.vars.filter((v) => v.enabled).map((v) => (v.secret ? `${v.name}=<secret ${v.set ? 'set' : 'unset'}>` : `${v.name}=${cellText(v.value, 80)}`)).join(', ') || 'no variables'}`)
            .join('\n'),
        );
      },
    },
  ];
}
