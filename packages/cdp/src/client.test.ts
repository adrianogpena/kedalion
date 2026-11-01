import { expect, test } from 'bun:test';
import { connectCdp } from './client.ts';

class FakeSocket {
  static last: FakeSocket;
  sent: any[] = [];
  private handlers: Record<string, Array<(ev: any) => void>> = {};
  constructor(public url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.emit('open', {}));
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    (this.handlers[type] ??= []).push(cb);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.emit('close', {});
  }
  emit(type: string, ev: any) {
    for (const cb of this.handlers[type] ?? []) cb(ev);
  }
  receive(msg: object) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
}

const connect = () => connectCdp('ws://x', { WebSocketImpl: FakeSocket as any });

test('matches responses to requests by id', async () => {
  const cdp = await connect();
  const a = cdp.send('A.one', { x: 1 });
  const b = cdp.send('B.two', undefined, 's1');
  const [m1, m2] = FakeSocket.last.sent;
  expect(m1).toEqual({ id: m1.id, method: 'A.one', params: { x: 1 } });
  expect(m2.sessionId).toBe('s1');
  expect(m2.id).toBe(m1.id + 1);
  FakeSocket.last.receive({ id: m2.id, result: { b: 2 } });
  FakeSocket.last.receive({ id: m1.id, result: { a: 1 } });
  expect(await a).toEqual({ a: 1 });
  expect(await b).toEqual({ b: 2 });
});

test('error responses reject with code and message', async () => {
  const cdp = await connect();
  const p = cdp.send('A.fail');
  FakeSocket.last.receive({ id: FakeSocket.last.sent[0].id, error: { code: -32000, message: 'boom' } });
  const err: any = await p.catch((e) => e);
  expect(err.message).toBe('boom');
  expect(err.code).toBe(-32000);
});

test('timeouts reject with cdpTimeout', async () => {
  const cdp = await connect();
  const err: any = await cdp.send('A.slow', undefined, undefined, 10).catch((e) => e);
  expect(err.code).toBe('cdpTimeout');
});

test('session facade only sees its own events', async () => {
  const cdp = await connect();
  const seen: any[] = [];
  const s = cdp.session('s1');
  s.on('Page.x', (p) => seen.push(p));
  FakeSocket.last.receive({ method: 'Page.x', params: { n: 1 }, sessionId: 's1' });
  FakeSocket.last.receive({ method: 'Page.x', params: { n: 2 }, sessionId: 's2' });
  FakeSocket.last.receive({ method: 'Page.x', params: { n: 3 } });
  expect(seen).toEqual([{ n: 1 }]);
  void s.send('Page.go', { a: 1 });
  expect(FakeSocket.last.sent[0].sessionId).toBe('s1');
});

test('on returns an unsubscribe and onClose fires', async () => {
  const cdp = await connect();
  let n = 0;
  const off = cdp.on('E.e', () => n++);
  FakeSocket.last.receive({ method: 'E.e', params: {} });
  off();
  FakeSocket.last.receive({ method: 'E.e', params: {} });
  expect(n).toBe(1);
  let closed = 0;
  cdp.onClose(() => closed++);
  FakeSocket.last.close();
  expect(closed).toBe(1);
});

test('close rejects pending calls', async () => {
  const cdp = await connect();
  const p = cdp.send('A.pending');
  cdp.close();
  const err: any = await p.catch((e) => e);
  expect(err.code).toBe('cdpClosed');
  expect(((await cdp.send('A.after').catch((e) => e)) as any).code).toBe('cdpClosed');
});
