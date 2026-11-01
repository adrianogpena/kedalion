import { expect, test } from 'bun:test';
import { createFakeClient } from './fake.ts';
import { createConsoleLog, createNetworkLog } from './logs.ts';

const setup = () => {
  const client = createFakeClient();
  return { client, session: client.session('s') };
};
const emit = (c: ReturnType<typeof createFakeClient>, ev: string, p: any) => c.emit(ev, p, 's');

test('console ring keeps only the newest entries', () => {
  const { client, session } = setup();
  const log = createConsoleLog(session, { cap: 3 });
  for (let i = 0; i < 5; i++) emit(client, 'Runtime.consoleAPICalled', { type: 'log', args: [{ value: `m${i}` }] });
  expect(log.entries().map((e) => e.text)).toEqual(['m2', 'm3', 'm4']);
  expect(log.entries({ since: 4 }).map((e) => e.text)).toEqual(['m4']);
  expect(log.entries({ limit: 1 }).map((e) => e.text)).toEqual(['m4']);
});

test('console maps api calls, exceptions and log entries', () => {
  const { client, session } = setup();
  const log = createConsoleLog(session);
  const seen: string[] = [];
  log.on('entry', (e) => seen.push(e.text));
  emit(client, 'Runtime.consoleAPICalled', {
    type: 'warning',
    args: [{ value: 'a' }, { type: 'object', description: 'Object' }],
    stackTrace: { callFrames: [{ url: 'http://x/app.js', lineNumber: 9 }] },
  });
  emit(client, 'Runtime.exceptionThrown', {
    exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: boom' }, stackTrace: { callFrames: [{ functionName: 'f', url: 'u', lineNumber: 0, columnNumber: 0 }] } },
  });
  emit(client, 'Log.entryAdded', { entry: { level: 'error', text: 'net fail', url: 'http://x/y', lineNumber: 0 } });
  const [a, b, c] = log.entries();
  expect(a).toMatchObject({ level: 'warn', text: 'a Object', args: ['a', 'Object'], source: { url: 'http://x/app.js', line: 10 } });
  expect(b).toMatchObject({ level: 'error', text: 'Error: boom', stack: 'at f (u:1:1)' });
  expect(c).toMatchObject({ level: 'error', text: 'net fail' });
  expect(seen).toHaveLength(3);
  expect(log.entries({ filter: { level: 'warn' } })).toHaveLength(1);
  expect(log.entries({ filter: { text: 'BOOM' } })).toHaveLength(1);
});

test('console clears on main-frame navigation unless preserve is set', () => {
  const { client, session } = setup();
  const log = createConsoleLog(session);
  emit(client, 'Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'x' }] });
  emit(client, 'Page.frameNavigated', { frame: { parentId: 'p' } });
  expect(log.entries()).toHaveLength(1);
  emit(client, 'Page.frameNavigated', { frame: {} });
  expect(log.entries()).toHaveLength(0);
  log.preserve = true;
  emit(client, 'Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'y' }] });
  emit(client, 'Page.frameNavigated', { frame: {} });
  expect(log.entries()).toHaveLength(1);
});

test('network request lifecycle merges into one entry', () => {
  const { client, session } = setup();
  const log = createNetworkLog(session);
  emit(client, 'Network.requestWillBeSent', { requestId: 'r1', timestamp: 10, type: 'XHR', request: { url: 'http://x/api', method: 'POST', headers: { a: '1' }, hasPostData: true } });
  emit(client, 'Network.responseReceived', { requestId: 'r1', type: 'XHR', response: { status: 201, mimeType: 'application/json', headers: { b: '2' } } });
  emit(client, 'Network.dataReceived', { requestId: 'r1', dataLength: 40 });
  emit(client, 'Network.loadingFinished', { requestId: 'r1', timestamp: 10.25, encodedDataLength: 55 });
  expect(log.entries()).toEqual([{ id: 1, requestId: 'r1', method: 'POST', url: 'http://x/api', type: 'xhr', status: 201, mime: 'application/json', size: 55, timing: 250, done: true }]);
});

test('failed requests carry the reason', () => {
  const { client, session } = setup();
  const log = createNetworkLog(session);
  emit(client, 'Network.requestWillBeSent', { requestId: 'r1', timestamp: 1, request: { url: 'http://x/', method: 'GET' } });
  emit(client, 'Network.loadingFailed', { requestId: 'r1', timestamp: 2, errorText: 'net::ERR_CONNECTION_REFUSED' });
  expect(log.entries()[0]).toMatchObject({ failed: 'net::ERR_CONNECTION_REFUSED', done: true, timing: 1000 });
  expect(log.entries({ filter: { failed: true } })).toHaveLength(1);
  expect(log.entries({ filter: { failed: false } })).toHaveLength(0);
});

test('redirects finish the first entry and start another', () => {
  const { client, session } = setup();
  const log = createNetworkLog(session);
  emit(client, 'Network.requestWillBeSent', { requestId: 'r1', timestamp: 1, request: { url: 'http://x/a', method: 'GET' } });
  emit(client, 'Network.requestWillBeSent', { requestId: 'r1', timestamp: 1.1, request: { url: 'http://x/b', method: 'GET' }, redirectResponse: { status: 302 } });
  const [a, b] = log.entries();
  expect(a).toMatchObject({ status: 302, done: true });
  expect(b).toMatchObject({ url: 'http://x/b', done: false });
});

test('network ring cap evicts the oldest', () => {
  const { client, session } = setup();
  const log = createNetworkLog(session, { cap: 2 });
  for (let i = 0; i < 4; i++) emit(client, 'Network.requestWillBeSent', { requestId: `r${i}`, timestamp: i, request: { url: `http://x/${i}`, method: 'GET' } });
  expect(log.entries().map((e) => e.url)).toEqual(['http://x/2', 'http://x/3']);
});

test('network log clears on navigation but keeps the document request, or everything with preserve', () => {
  const { client, session } = setup();
  const log = createNetworkLog(session);
  emit(client, 'Network.requestWillBeSent', { requestId: 'old', timestamp: 1, request: { url: 'http://x/old', method: 'GET' } });
  emit(client, 'Network.requestWillBeSent', { requestId: 'L1', timestamp: 2, request: { url: 'http://x/doc', method: 'GET' } });
  emit(client, 'Page.frameNavigated', { frame: { loaderId: 'L1' } });
  expect(log.entries().map((e) => e.url)).toEqual(['http://x/doc']);
  log.preserve = true;
  emit(client, 'Page.frameNavigated', { frame: { loaderId: 'L2' } });
  expect(log.entries()).toHaveLength(1);
});

test('detail fetches post data and the body, flagging base64', async () => {
  const { client, session } = setup();
  client.handlers['Network.getRequestPostData'] = () => ({ postData: 'a=1' });
  client.handlers['Network.getResponseBody'] = () => ({ body: 'AAEC', base64Encoded: true });
  const log = createNetworkLog(session);
  emit(client, 'Network.requestWillBeSent', { requestId: 'r1', timestamp: 1, request: { url: 'http://x/', method: 'POST', headers: { h: 'v' }, hasPostData: true } });
  emit(client, 'Network.loadingFinished', { requestId: 'r1', timestamp: 2, encodedDataLength: 3 });
  expect(await log.detail(1)).toEqual({ requestHeaders: { h: 'v' }, responseHeaders: {}, postData: 'a=1', body: 'AAEC', base64: true });
  expect(await log.detail(99)).toBeUndefined();
});

test('detail truncates text bodies over 1 MB', async () => {
  const { client, session } = setup();
  client.handlers['Network.getResponseBody'] = () => ({ body: 'a'.repeat(1024 * 1024 + 5), base64Encoded: false });
  const log = createNetworkLog(session);
  emit(client, 'Network.requestWillBeSent', { requestId: 'r1', timestamp: 1, request: { url: 'http://x/', method: 'GET' } });
  emit(client, 'Network.loadingFinished', { requestId: 'r1', timestamp: 2 });
  const d = await log.detail(1);
  expect(d!.truncated).toBe(true);
  expect(d!.body).toHaveLength(1024 * 1024);
});
