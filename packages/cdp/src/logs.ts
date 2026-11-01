import type { CdpSession } from './client.ts';

export const CONSOLE_CAP = 2000;
export const NETWORK_CAP = 1000;
export const BODY_LIMIT = 1024 * 1024;

export interface QueryOptions<F> {
  since?: number;
  limit?: number;
  filter?: F;
}

class Ring<T extends { id: number }> {
  items: T[] = [];
  private seq = 0;
  private handlers = new Set<(e: T) => void>();
  constructor(
    private cap: number,
    private onEvict?: (e: T) => void,
  ) {}
  nextId() {
    return ++this.seq;
  }
  push(e: T) {
    this.items.push(e);
    while (this.items.length > this.cap) {
      const old = this.items.shift()!;
      this.onEvict?.(old);
    }
    this.emit(e);
  }
  emit(e: T) {
    for (const cb of [...this.handlers]) cb(e);
  }
  query(pred: (e: T) => boolean, o: { since?: number; limit?: number }): T[] {
    let out = this.items.filter((e) => (o.since === undefined || e.id > o.since) && pred(e));
    if (o.limit !== undefined && out.length > o.limit) out = out.slice(out.length - o.limit);
    return out;
  }
  clear() {
    this.items = [];
  }
  on(cb: (e: T) => void) {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  id: number;
  ts: number;
  level: ConsoleLevel;
  text: string;
  source?: { url: string; line: number };
  args: string[];
  stack?: string;
}

export interface ConsoleFilter {
  level?: ConsoleLevel | ConsoleLevel[];
  text?: string;
}

export interface ConsoleLog {
  entries(o?: QueryOptions<ConsoleFilter>): ConsoleEntry[];
  clear(): void;
  preserve: boolean;
  on(event: 'entry', cb: (e: ConsoleEntry) => void): () => void;
  dispose(): void;
}

const LEVELS: Record<string, ConsoleLevel> = { log: 'log', info: 'info', warning: 'warn', warn: 'warn', error: 'error', assert: 'error', debug: 'debug', verbose: 'debug' };

export function previewValue(o: any): string {
  if (!o) return '';
  if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  return o.description ?? o.preview?.description ?? o.className ?? o.type ?? '';
}

const stackText = (st: any): string | undefined =>
  st?.callFrames?.length
    ? st.callFrames.map((f: any) => `at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`).join('\n')
    : undefined;

const isMainNavigation = (p: any) => !p?.frame?.parentId;

export function createConsoleLog(session: CdpSession, opts: { cap?: number } = {}): ConsoleLog {
  const ring = new Ring<ConsoleEntry>(opts.cap ?? CONSOLE_CAP);
  const log: ConsoleLog = {
    preserve: false,
    entries(o = {}) {
      const f = o.filter ?? {};
      const levels = f.level === undefined ? undefined : Array.isArray(f.level) ? f.level : [f.level];
      const text = f.text?.toLowerCase();
      return ring.query((e) => (!levels || levels.includes(e.level)) && (!text || e.text.toLowerCase().includes(text)), o);
    },
    clear: () => ring.clear(),
    on: (_event, cb) => ring.on(cb),
    dispose() {
      for (const off of offs) off();
    },
  };
  const add = (e: Omit<ConsoleEntry, 'id'>) => ring.push({ id: ring.nextId(), ...e });
  const offs = [
    session.on('Runtime.consoleAPICalled', (p) => {
      const args = (p.args ?? []).map(previewValue);
      const top = p.stackTrace?.callFrames?.[0];
      add({
        ts: p.timestamp ?? Date.now(),
        level: LEVELS[p.type] ?? 'log',
        text: args.join(' '),
        args,
        ...(top ? { source: { url: top.url, line: top.lineNumber + 1 } } : {}),
      });
    }),
    session.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails ?? {};
      const stack = stackText(d.stackTrace);
      add({
        ts: p.timestamp ?? Date.now(),
        level: 'error',
        text: d.exception?.description ?? d.text ?? 'Uncaught',
        args: [],
        ...(d.url ? { source: { url: d.url, line: (d.lineNumber ?? 0) + 1 } } : {}),
        ...(stack ? { stack } : {}),
      });
    }),
    session.on('Log.entryAdded', (p) => {
      const e = p.entry ?? {};
      add({
        ts: e.timestamp ?? Date.now(),
        level: LEVELS[e.level] ?? 'log',
        text: e.text ?? '',
        args: [],
        ...(e.url ? { source: { url: e.url, line: (e.lineNumber ?? 0) + 1 } } : {}),
      });
    }),
    session.on('Page.frameNavigated', (p) => {
      if (isMainNavigation(p) && !log.preserve) ring.clear();
    }),
  ];
  return log;
}

export interface NetworkEntry {
  id: number;
  requestId: string;
  method: string;
  url: string;
  status?: number;
  type?: string;
  mime?: string;
  size: number;
  timing?: number;
  failed?: string;
  done: boolean;
}

export interface NetworkFilter {
  text?: string;
  method?: string;
  type?: string;
  failed?: boolean;
  status?: number;
}

export interface NetworkDetail {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  postData?: string;
  body?: string;
  base64?: boolean;
  truncated?: boolean;
}

export interface NetworkLog {
  entries(o?: QueryOptions<NetworkFilter>): NetworkEntry[];
  detail(id: number): Promise<NetworkDetail | undefined>;
  clear(): void;
  preserve: boolean;
  on(event: 'entry', cb: (e: NetworkEntry) => void): () => void;
  dispose(): void;
}

interface Extra {
  start: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  hasPostData: boolean;
}

export function createNetworkLog(session: CdpSession, opts: { cap?: number } = {}): NetworkLog {
  const byRequest = new Map<string, NetworkEntry>();
  const extras = new Map<number, Extra>();
  const ring = new Ring<NetworkEntry>(opts.cap ?? NETWORK_CAP, (e) => {
    extras.delete(e.id);
    if (byRequest.get(e.requestId) === e) byRequest.delete(e.requestId);
  });
  const reset = () => {
    ring.clear();
    byRequest.clear();
    extras.clear();
  };
  const finish = (e: NetworkEntry, ts: number | undefined) => {
    e.done = true;
    const x = extras.get(e.id);
    if (x && ts !== undefined) e.timing = Math.max(0, Math.round((ts - x.start) * 1000));
    ring.emit(e);
  };
  const net: NetworkLog = {
    preserve: false,
    entries(o = {}) {
      const f = o.filter ?? {};
      const text = f.text?.toLowerCase();
      return ring.query(
        (e) =>
          (!text || e.url.toLowerCase().includes(text)) &&
          (f.method === undefined || e.method === f.method) &&
          (f.type === undefined || e.type === f.type) &&
          (f.status === undefined || e.status === f.status) &&
          (f.failed === undefined || !!e.failed === f.failed),
        o,
      );
    },
    async detail(id) {
      const e = ring.items.find((x) => x.id === id);
      const x = extras.get(id);
      if (!e || !x) return undefined;
      const d: NetworkDetail = { requestHeaders: x.requestHeaders, responseHeaders: x.responseHeaders };
      if (x.hasPostData) {
        try {
          d.postData = (await session.send('Network.getRequestPostData', { requestId: e.requestId })).postData;
        } catch {
          // post data may be gone already
        }
      }
      if (e.done && !e.failed) {
        try {
          const r = await session.send('Network.getResponseBody', { requestId: e.requestId });
          if (r.base64Encoded) d.base64 = true;
          if (r.body.length > BODY_LIMIT) {
            d.truncated = true;
            if (!r.base64Encoded) d.body = r.body.slice(0, BODY_LIMIT);
          } else d.body = r.body;
        } catch {
          // body not available (redirect, evicted)
        }
      }
      return d;
    },
    clear: reset,
    on: (_event, cb) => ring.on(cb),
    dispose() {
      for (const off of offs) off();
    },
  };
  const offs = [
    session.on('Network.requestWillBeSent', (p) => {
      const prev = byRequest.get(p.requestId);
      if (prev && p.redirectResponse) {
        prev.status = p.redirectResponse.status;
        prev.mime = p.redirectResponse.mimeType;
        extras.get(prev.id)!.responseHeaders = p.redirectResponse.headers ?? {};
        finish(prev, p.timestamp);
      }
      const e: NetworkEntry = {
        id: ring.nextId(),
        requestId: p.requestId,
        method: p.request.method,
        url: p.request.url,
        ...(p.type ? { type: String(p.type).toLowerCase() } : {}),
        size: 0,
        done: false,
      };
      extras.set(e.id, { start: p.timestamp ?? 0, requestHeaders: p.request.headers ?? {}, responseHeaders: {}, hasPostData: !!p.request.hasPostData });
      byRequest.set(p.requestId, e);
      ring.push(e);
    }),
    session.on('Network.responseReceived', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      e.status = p.response.status;
      e.mime = p.response.mimeType;
      if (p.type) e.type = String(p.type).toLowerCase();
      extras.get(e.id)!.responseHeaders = p.response.headers ?? {};
      ring.emit(e);
    }),
    session.on('Network.dataReceived', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e || e.done) return;
      e.size += p.dataLength ?? 0;
    }),
    session.on('Network.loadingFinished', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      if (p.encodedDataLength !== undefined) e.size = p.encodedDataLength;
      finish(e, p.timestamp);
    }),
    session.on('Network.loadingFailed', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      e.failed = p.canceled ? 'canceled' : (p.errorText ?? 'failed');
      finish(e, p.timestamp);
    }),
    session.on('Page.frameNavigated', (p) => {
      if (!isMainNavigation(p) || net.preserve) return;
      const keep = ring.items.filter((e) => e.requestId === p.frame.loaderId);
      const kept = keep.map((e) => [e, extras.get(e.id)!] as const);
      reset();
      for (const [e, x] of kept) {
        ring.items.push(e);
        byRequest.set(e.requestId, e);
        extras.set(e.id, x);
      }
    }),
  ];
  return net;
}
