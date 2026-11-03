import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { AppError, RouteContext } from '@kedalion/server-core';
import { pickedPaths } from './dialogs.ts';
import { httpExecutor, httpRoutes, suggestedName, validateDraft, validateRequest } from './http.ts';

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/echo') {
        return Response.json({ method: req.method, headers: Object.fromEntries(req.headers), body: await req.text() });
      }
      if (path === '/big') return new Response(new Uint8Array(12_000_000).fill(97), { headers: { 'content-type': 'text/plain' } });
      if (path === '/slow') {
        await Bun.sleep(3000);
        return new Response('late');
      }
      if (path === '/redirect') return new Response(null, { status: 302, headers: { location: '/echo' } });
      if (path === '/bin') return new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'application/octet-stream' } });
      return new Response('nope', { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const spec = (path: string, extra: Record<string, unknown> = {}) => validateRequest({ method: 'GET', url: base + path, headers: [], ...extra });
const code = async (promise: Promise<unknown>) => ((await promise.catch((e) => e)) as AppError).code;

test('echo round trip sends the method, body and custom headers and never the session token', async () => {
  const res = await httpExecutor().send(
    spec('/echo', { method: 'POST', body: '{"a":1}', headers: [['x-custom', 'yes'], ['content-type', 'application/json']] }),
  );
  expect(res.status).toBe(200);
  expect(res.binary).toBeUndefined();
  const echoed = JSON.parse(res.text!);
  expect(echoed.method).toBe('POST');
  expect(echoed.body).toBe('{"a":1}');
  expect(echoed.headers['x-custom']).toBe('yes');
  expect(echoed.headers).not.toHaveProperty('x-kedalion-token');
});

test('a body above maxBodyBytes is cut and marked truncated', async () => {
  const res = await httpExecutor({ maxBodyBytes: 1_000 }).send(spec('/big'));
  expect(res.truncated).toBe(true);
  expect(res.size).toBe(1_000);
  const full = await httpExecutor().send(spec('/big'));
  expect(full.truncated).toBe(true);
  expect(full.size).toBe(10_000_000);
});

test('a slow response ends in httpTimeout', async () => {
  expect(await code(httpExecutor().send(spec('/slow', { timeoutMs: 1000 })))).toBe('httpTimeout');
});

test('redirects are followed by default and kept as 302 when disabled', async () => {
  const followed = await httpExecutor().send(spec('/redirect'));
  expect(followed.status).toBe(200);
  expect(followed.redirected).toBe(true);
  expect(followed.url).toBe(`${base}/echo`);
  const manual = await httpExecutor().send(spec('/redirect', { followRedirects: false }));
  expect(manual.status).toBe(302);
});

test('secret headers are dropped when a followed redirect leaves the origin', async () => {
  const other = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/away') return new Response(null, { status: 302, headers: { location: `${base}/echo` } });
      if (path === '/same') return new Response(null, { status: 307, headers: { location: '/away' } });
      return new Response('nope', { status: 404 });
    },
  });
  try {
    const headers: Array<[string, string]> = [['X-Api-Key', 'k'], ['Authorization', 'Bearer s'], ['x-plain', 'p']];
    const res = await httpExecutor().send({
      ...validateRequest({ method: 'POST', url: `http://127.0.0.1:${other.port}/same`, headers, body: 'b' }),
      secretHeaderNames: ['X-Api-Key'],
    });
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);
    expect(res.url).toBe(`${base}/echo`);
    const echoed = JSON.parse(res.text!);
    expect(echoed.method).toBe('GET');
    expect(echoed.headers).not.toHaveProperty('x-api-key');
    expect(echoed.headers).not.toHaveProperty('authorization');
    expect(echoed.headers['x-plain']).toBe('p');
  } finally {
    other.stop(true);
  }
});

test('a binary body has no text', async () => {
  const res = await httpExecutor().send(spec('/bin'));
  expect(res.binary).toBe(true);
  expect(res.text).toBeUndefined();
  expect(res.size).toBe(4);
});

test('a client abort is rethrown as is', async () => {
  const controller = new AbortController();
  const sending = httpExecutor().send(spec('/slow'), controller.signal);
  controller.abort();
  expect(await code(sending)).not.toBe('httpTimeout');
  expect(controller.signal.aborted).toBe(true);
});

test('a refused port is httpFailed', async () => {
  const closed = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
  const url = `http://127.0.0.1:${closed.port}/`;
  closed.stop(true);
  const err = (await httpExecutor().send(validateRequest({ method: 'GET', url })).catch((e) => e)) as AppError;
  expect(err.code).toBe('httpFailed');
  expect(err.opts.detail).toBeTruthy();
});

test('validateRequest refuses what the executor must not send', () => {
  const fail = (input: Record<string, unknown>) => {
    try {
      validateRequest({ method: 'GET', url: 'http://localhost/', ...input });
    } catch (err) {
      return (err as AppError).code;
    }
    return 'ok';
  };
  expect(fail({ url: 'file:///c:/x' })).toBe('badUrl');
  expect(fail({ url: 'nonsense' })).toBe('badUrl');
  expect(fail({ method: 'TRACE' })).toBe('badMethod');
  expect(fail({ headers: [['x-a', 'a\r\nb: c']] })).toBe('badHeader');
  expect(fail({ headers: [['bad name', 'a']] })).toBe('badHeader');
  expect(fail({ headers: Array.from({ length: 101 }, (_, i) => [`h${i}`, 'v']) })).toBe('badHeader');
  expect(fail({ headers: 'x' })).toBe('badRequest');
  expect(fail({ headers: [['only-name']] })).toBe('badRequest');
  expect(fail({ body: 'x' })).toBe('bodyNotAllowed');
  expect(fail({ method: 'POST', body: 'x'.repeat(900_001) })).toBe('badRequest');
  expect(fail({ method: 'POST', body: 5 })).toBe('badRequest');
  expect(fail({ timeoutMs: 999 })).toBe('badRequest');
  expect(fail({ timeoutMs: 1.5 })).toBe('badRequest');
  expect(fail({ insecure: 'yes' })).toBe('badRequest');
  expect(fail({ method: 'POST', body: 'x'.repeat(900_000) })).toBe('ok');
});

test('validateRequest builds a fresh object with the defaults', () => {
  const input = { method: 'POST', url: 'http://localhost/', headers: [['a', 'b']], body: 'x', extra: 1 };
  const out = validateRequest(input);
  expect(out).toEqual({ method: 'POST', url: 'http://localhost/', headers: [['a', 'b']], body: 'x', timeoutMs: 60_000, insecure: false, followRedirects: true });
  expect(out.headers).not.toBe(input.headers);
});

test('validateDraft refuses drafts out of range and returns a fresh object', () => {
  const draft = { method: 'POST', url: 'http://localhost/', headers: [{ name: 'a', value: 'b', enabled: true }], body: 'x', bodyLang: 'json' };
  const fail = (input: Record<string, unknown>) => {
    try {
      validateDraft({ ...draft, ...input });
    } catch (err) {
      return (err as AppError).code;
    }
    return 'ok';
  };
  expect(fail({ headers: Array.from({ length: 101 }, () => ({ name: 'h', value: 'v', enabled: true })) })).toBe('badSavedRequest');
  expect(fail({ timeoutMs: 1500.5 })).toBe('badSavedRequest');
  expect(fail({ insecure: 'yes' })).toBe('badSavedRequest');
  expect(fail({ url: 'x'.repeat(4097) })).toBe('badSavedRequest');
  expect(fail({ url: '', timeoutMs: 300_000 })).toBe('ok');
  const input = { ...draft, extra: 1 };
  const out = validateDraft(input);
  expect(out).toEqual(draft as typeof out);
  expect(out).not.toBe(input);
  expect(out.headers[0]).not.toBe(draft.headers[0]);
});

test('validateDraft keeps form rows and authKind and refuses bad ones', () => {
  const draft = {
    method: 'POST',
    url: 'http://localhost/',
    headers: [],
    body: '',
    bodyLang: 'multipart',
    form: [{ name: 'a', value: '1' }],
    authKind: 'bearer',
  };
  expect(validateDraft({ ...draft, extra: 1 })).toEqual(draft as ReturnType<typeof validateDraft>);
  expect(validateDraft({ ...draft, bodyLang: 'form' }).bodyLang).toBe('form');
  const fail = (input: Record<string, unknown>) => {
    try {
      validateDraft({ ...draft, ...input });
    } catch (err) {
      return (err as AppError).code;
    }
    return 'ok';
  };
  expect(fail({ bodyLang: 'yaml' })).toBe('badSavedRequest');
  expect(fail({ authKind: 'digest' })).toBe('badSavedRequest');
  expect(fail({ form: [{ name: 'a', value: 1 }] })).toBe('badSavedRequest');
  expect(fail({ form: Array.from({ length: 101 }, () => ({ name: 'f', value: 'v' })) })).toBe('badSavedRequest');
  expect(fail({ form: [{ name: 'a', value: 'x'.repeat(900_000) }] })).toBe('badSavedRequest');
});

test('validateRequest checks form bodies', () => {
  const fail = (input: Record<string, unknown>) => {
    try {
      validateRequest({ method: 'POST', url: 'http://localhost/', ...input });
    } catch (err) {
      return (err as AppError).code;
    }
    return 'ok';
  };
  expect(fail({ bodyKind: 'form', form: [['a', 'b']] })).toBe('ok');
  expect(fail({ bodyKind: 'xml', form: [['a', 'b']] })).toBe('badRequest');
  expect(fail({ bodyKind: 'form', form: [['a']] })).toBe('badRequest');
  expect(fail({ bodyKind: 'form', form: [['a', 'b']], body: 'x' })).toBe('badRequest');
  expect(fail({ form: [['a', 'b']] })).toBe('badRequest');
  expect(fail({ method: 'GET', bodyKind: 'multipart', form: [['a', 'b']] })).toBe('bodyNotAllowed');
});

test('form bodies are sent urlencoded and as multipart text fields', async () => {
  const form: Array<[string, string]> = [['a', '1 2'], ['b', 'x&y']];
  const urlencoded = JSON.parse((await httpExecutor().send(spec('/echo', { method: 'POST', bodyKind: 'form', form }))).text!);
  expect(urlencoded.headers['content-type']).toBe('application/x-www-form-urlencoded');
  expect(urlencoded.body).toBe('a=1+2&b=x%26y');
  const own = JSON.parse(
    (await httpExecutor().send(spec('/echo', { method: 'POST', bodyKind: 'form', form, headers: [['Content-Type', 'application/x-www-form-urlencoded; charset=utf-8']] }))).text!,
  );
  expect(own.headers['content-type']).toBe('application/x-www-form-urlencoded; charset=utf-8');
  const multipart = JSON.parse(
    (await httpExecutor().send(spec('/echo', { method: 'POST', bodyKind: 'multipart', form, headers: [['content-type', 'text/plain']] }))).text!,
  );
  expect(multipart.headers['content-type']).toStartWith('multipart/form-data; boundary=');
  expect(multipart.body).toContain('name="a"\r\n\r\n1 2\r\n');
  expect(multipart.body).toContain('name="b"\r\n\r\nx&y\r\n');
});

test('a saved Authorization does not follow a redirect to another origin', async () => {
  const seen: Array<string | null> = [];
  const target = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      seen.push(req.headers.get('authorization'));
      return new Response('ok');
    },
  });
  const origin = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/away') return new Response(null, { status: 302, headers: { location: `http://localhost:${target.port}/landed` } });
      if (path === '/near') return new Response(null, { status: 302, headers: { location: '/landed' } });
      seen.push(req.headers.get('authorization'));
      return new Response('ok');
    },
  });
  try {
    const routes = httpRoutes(httpExecutor(), { secretHeaders: async () => [['Authorization', 'Bearer s3cret']] });
    const send = (path: string) =>
      Promise.resolve(
        routes['POST /api/http/send']!({
          req: new Request('http://x/'),
          json: async () => ({ request: { method: 'GET', url: `http://127.0.0.1:${origin.port}${path}`, headers: [] }, secretRef: 'tok' }),
        } as unknown as RouteContext),
      );
    await send('/away');
    await send('/near');
    expect(seen).toEqual([null, 'Bearer s3cret']);
  } finally {
    origin.stop(true);
    target.stop(true);
  }
});

test('secretHeaders gets the request URL and adds Authorization only when absent', async () => {
  const calls: Array<[string, string]> = [];
  const routes = httpRoutes(httpExecutor(), {
    secretHeaders: async (ref, url) => {
      calls.push([ref, url]);
      return [['Authorization', 'Bearer s3cret']];
    },
  });
  const send = (headers: Array<[string, string]>) =>
    Promise.resolve(
      routes['POST /api/http/send']!({
        req: new Request('http://x/'),
        json: async () => ({ request: { method: 'GET', url: `${base}/echo`, headers }, secretRef: 'tok' }),
      } as unknown as RouteContext),
    ) as Promise<{ text: string }>;
  expect(JSON.parse((await send([])).text).headers.authorization).toBe('Bearer s3cret');
  expect(JSON.parse((await send([['authorization', 'mine']])).text).headers.authorization).toBe('mine');
  expect(calls).toEqual([
    ['tok', `${base}/echo`],
    ['tok', `${base}/echo`],
  ]);
});

test('suggested file names come from the final URL and content type', () => {
  expect(suggestedName('http://h/files/r%C3%A9sum%C3%A9', 'application/json; charset=utf-8')).toBe('résumé.json');
  expect(suggestedName('http://h/data.json', 'application/json')).toBe('data.json');
  expect(suggestedName('http://h/', 'text/html')).toBe('response.html');
  expect(suggestedName('http://h/a%2Fb%3F', 'image/png')).toBe('a_b_');
  expect(suggestedName('http://h/%E0%A4%A', 'application/xml')).toBe('%E0%A4%A.xml');
  expect(suggestedName(`http://h/${'n'.repeat(300)}`, 'text/plain')).toHaveLength(104);
});

test('save writes the kept bytes to a picked target, and an evicted id is responseGone', async () => {
  const executor = httpExecutor({ keep: 1 });
  const picks = { saveTargets: pickedPaths() };
  const path = `${process.env.TEMP ?? '.'}/kedalion-http-save-${Date.now()}.json`;
  const routes = httpRoutes(executor, { picks });
  const call = (id: string, target?: string) =>
    Promise.resolve(routes['POST /api/http/save']!({ json: async () => ({ id, target }) } as unknown as RouteContext)).catch((e) => e);
  const first = await executor.send(spec('/echo'));
  const second = await executor.send(spec('/echo'));
  picks.saveTargets.add(path);
  expect(((await call(first.id, path)) as AppError).code).toBe('responseGone');
  const saved = (await call(second.id, path)) as { path: string; bytes: number };
  expect(saved.bytes).toBe(second.size);
  expect(await Bun.file(saved.path).text()).toBe(second.text!);
  expect(((await call(second.id, path)) as AppError).code).toBe('notASaveTarget');
  expect(((await call(second.id)) as AppError).code).toBe('notASaveTarget');
  await Bun.file(path).delete();
});

test('send resolves environment variables in URL, headers, body, form and saved auth', async () => {
  const asked: string[] = [];
  const routes = httpRoutes(httpExecutor(), {
    environmentVars: async (id) => {
      asked.push(id);
      return { base, token: 't0k', who: 'me', field: 'f' };
    },
    secretHeaders: async (_ref, url, resolve) => (url.startsWith(resolve('{{base}}')) ? [['Authorization', 'Bearer {{token}}']] : []),
  });
  const send = (request: unknown, extra: Record<string, unknown> = {}) =>
    Promise.resolve(
      routes['POST /api/http/send']!({ req: new Request('http://x/'), json: async () => ({ request, environment: 'dev', ...extra }) } as unknown as RouteContext),
    ) as Promise<{ text: string }>;
  const json = JSON.parse((await send({ method: 'POST', url: '{{base}}/echo', headers: [['x-who', '{{who}}']], body: '{"t":"{{token}}"}' }, { secretRef: 'r' })).text);
  expect(json.headers['x-who']).toBe('me');
  expect(json.headers.authorization).toBe('Bearer t0k');
  expect(json.body).toBe('{"t":"t0k"}');
  const form = JSON.parse((await send({ method: 'POST', url: '{{base}}/echo', headers: [], bodyKind: 'form', form: [['{{field}}', '{{who}}']] })).text);
  expect(form.body).toBe('f=me');
  expect(asked).toEqual(['dev', 'dev']);
});

test('captured vars win over the environment and unknown names still fail', async () => {
  const routes = httpRoutes(httpExecutor(), { environmentVars: async () => ({ base, who: 'env' }) });
  const send = (request: unknown, vars: unknown) =>
    Promise.resolve(routes['POST /api/http/send']!({ req: new Request('http://x/'), json: async () => ({ request, environment: 'e', vars }) } as unknown as RouteContext));
  const res = (await send({ method: 'GET', url: '{{base}}/echo', headers: [['x-who', '{{who}}']] }, { who: 'captured', bad: 5 })) as { text: string };
  expect(JSON.parse(res.text).headers['x-who']).toBe('captured');
  const err = (await send({ method: 'GET', url: '{{base}}/echo', headers: [['x-a', '{{bad}}']] }, { bad: 5 }).catch((e) => e)) as AppError;
  expect(err.code).toBe('unknownVariable');
});

test('unknown variables fail before sending and list every name', async () => {
  let fetched = 0;
  const executor = httpExecutor({ fetchImpl: (async () => (fetched++, new Response('x'))) as unknown as typeof fetch });
  const routes = httpRoutes(executor, { environmentVars: async () => ({ base }), secretHeaders: async () => [['Authorization', '{{secret}}']] });
  const send = (request: unknown, secretRef?: string) =>
    Promise.resolve(routes['POST /api/http/send']!({ req: new Request('http://x/'), json: async () => ({ request, environment: 'e', secretRef }) } as unknown as RouteContext));
  const err = (await send({ method: 'GET', url: '{{host}}/a', headers: [['a', '{{x}}{{host}}']] }).catch((e) => e)) as AppError;
  expect(err.code).toBe('unknownVariable');
  expect(err.opts.params).toEqual({ names: 'host, x' });
  expect(((await send({ method: 'GET', url: '{{base}}/a', headers: [] }, 'r').catch((e) => e)) as AppError).code).toBe('unknownVariable');
  expect(fetched).toBe(0);
});
