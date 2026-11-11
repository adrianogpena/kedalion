import type { CdpSession } from './client.ts';

export const CONSOLE_CAP = 2000;
export const NETWORK_CAP = 1000;
export const BODY_LIMIT = 1024 * 1024;
/** Per-body size cap (characters) of the bodies recorded as requests finish, so they survive navigations. */
export const RECORD_BODY_LIMIT = 512 * 1024;
const SKIP_RECORD_TYPES = new Set(['image', 'font', 'media']);
/** Responses with a larger encoded size are not fetched for recording. */
export const RECORD_MAX_ENCODED = 5 * 1024 * 1024;
export const FRAME_CAP = 200;
export const FRAME_PAYLOAD_LIMIT = 4096;

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
  /** Child target (iframe, worker) the message came from. */
  frame?: string;
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

const previewProp = (p: any): string => (p?.type === 'string' ? JSON.stringify(p.value) : String(p?.value ?? p?.type ?? ''));

/** `{a: 1, b: "x", ...}` / `[1, 2, ...]` / `Map(2) {"k" => 1}` from a CDP object preview; undefined when there is none. */
export function renderPreview(pv: any): string | undefined {
  if (!pv || typeof pv !== 'object') return undefined;
  const props: any[] = pv.properties ?? [];
  const entries: any[] = pv.entries ?? [];
  const more = pv.overflow ? ', ...' : '';
  const nested = previewProp;
  const entryText = (v: any) => renderPreview(v) ?? (v?.type === 'string' ? JSON.stringify(v.description) : String(v?.description ?? v?.type ?? ''));
  const head = pv.description && !/^(Object|Array)$/.test(String(pv.description).replace(/\(\d+\)$/, '')) ? `${pv.description} ` : '';
  if (pv.subtype === 'map' || pv.subtype === 'set') {
    const items = entries.map((e) => (pv.subtype === 'map' ? `${entryText(e.key)} => ${entryText(e.value)}` : entryText(e.value)));
    return `${pv.description ?? pv.subtype} {${items.join(', ')}${more}}`;
  }
  if (pv.subtype === 'array') return `${head}[${props.map((p) => nested(p)).join(', ')}${more}]`;
  if (!props.length && !entries.length) return undefined;
  return `${head}{${props.map((p) => `${p.name}: ${nested(p)}`).join(', ')}${more}}`;
}

export function previewValue(o: any): string {
  if (!o) return '';
  if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  if (o.type === 'object' && o.preview) {
    const r = renderPreview(o.preview);
    if (r) return r;
  }
  return o.description ?? o.preview?.description ?? o.className ?? o.type ?? '';
}

const stackText = (st: any): string | undefined =>
  st?.callFrames?.length
    ? st.callFrames.map((f: any) => `at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`).join('\n')
    : undefined;

/** errorText, blockedReason and the CORS error of a Network.loadingFailed event, joined. */
export const failureText = (p: any): string => [p?.errorText, p?.blockedReason, p?.corsErrorStatus?.corsError].filter(Boolean).join(' / ') || 'failed';

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
    session.on('Runtime.consoleAPICalled', (p, frame) => {
      const args = (p.args ?? []).map(previewValue);
      const top = p.stackTrace?.callFrames?.[0];
      const level = LEVELS[p.type] ?? 'log';
      const stack = level === 'warn' || level === 'error' ? stackText(p.stackTrace) : undefined;
      add({
        ts: p.timestamp ?? Date.now(),
        level,
        text: args.join(' '),
        args,
        ...(top ? { source: { url: top.url, line: top.lineNumber + 1 } } : {}),
        ...(stack ? { stack } : {}),
        ...(frame ? { frame } : {}),
      });
    }),
    session.on('Runtime.exceptionThrown', (p, frame) => {
      const d = p.exceptionDetails ?? {};
      const stack = stackText(d.stackTrace);
      add({
        ts: p.timestamp ?? Date.now(),
        level: 'error',
        text: d.exception?.description ?? d.text ?? 'Uncaught',
        args: [],
        ...(d.url ? { source: { url: d.url, line: (d.lineNumber ?? 0) + 1 } } : {}),
        ...(stack ? { stack } : {}),
        ...(frame ? { frame } : {}),
      });
    }),
    session.on('Log.entryAdded', (p, frame) => {
      const e = p.entry ?? {};
      add({
        ts: e.timestamp ?? Date.now(),
        level: LEVELS[e.level] ?? 'log',
        text: e.text ?? '',
        args: [],
        ...(frame ? { frame } : {}),
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
  /** Wall-clock ms when the request started. */
  startedAt?: number;
  /** Network protocol of the response (`h2`, `http/1.1`). */
  protocol?: string;
  /** CDP ResourceTiming of the response (ms offsets from `requestTime`). */
  resourceTiming?: Record<string, number>;
  /** Served from the HTTP cache. */
  fromCache?: boolean;
  /** Child target (iframe, worker) the request came from. */
  frame?: string;
}

/** One WebSocket frame or server-sent event. */
export interface NetworkFrame {
  dir: 'sent' | 'recv';
  /** WebSocket opcode (1 text, 2 binary) or the SSE event name. */
  opcode: number | string;
  payload: string;
  ts: number;
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
  mime?: string;
  /** Decoded size of the response body in bytes (binary bodies). */
  bodyBytes?: number;
  frames?: NetworkFrame[];
  /** Cookies the browser did not send or accept, with the reasons. */
  blockedCookies?: string[];
}

/** Bytes of a base64 string. */
export const base64Bytes = (s: string): number => Math.floor((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);

/** Failed, or answered with 4xx/5xx; a request the page canceled after a successful response (e.g. a video range) is not a failure. */
function isFailed(e: NetworkEntry): boolean {
  if ((e.status ?? 0) >= 400) return true;
  return !!e.failed && !(e.failed === 'canceled' && e.status !== undefined);
}

export interface NetworkLog {
  entries(o?: QueryOptions<NetworkFilter>): NetworkEntry[];
  /** `full` returns the whole body, without the BODY_LIMIT cut. */
  detail(id: number, opts?: { full?: boolean }): Promise<NetworkDetail | undefined>;
  /** Request and response text recorded when the request finished (capped at RECORD_BODY_LIMIT); synchronous. */
  recorded(id: number): { postData?: string; body?: string } | undefined;
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
  postData?: string;
  body?: string;
  frames?: NetworkFrame[];
}

/** Headers and blocked cookies from the *ExtraInfo events, which can arrive before or after the main event. */
interface ExtraInfo {
  req?: Record<string, string>;
  res?: Record<string, string>;
  blocked: string[];
}

const blockedLines = (kind: string, list: any): string[] =>
  (Array.isArray(list) ? list : [])
    .filter((c) => c?.blockedReasons?.length)
    .map((c) => `${kind} ${c.cookie?.name ?? '?'}: ${c.blockedReasons.join(', ')}`);

export function createNetworkLog(session: CdpSession, opts: { cap?: number } = {}): NetworkLog {
  const byRequest = new Map<string, NetworkEntry>();
  const extras = new Map<number, Extra>();
  const info = new Map<string, ExtraInfo>();
  const infoOf = (requestId: string): ExtraInfo => {
    let i = info.get(requestId);
    if (!i) info.set(requestId, (i = { blocked: [] }));
    return i;
  };
  const ring = new Ring<NetworkEntry>(opts.cap ?? NETWORK_CAP, (e) => {
    extras.delete(e.id);
    if (byRequest.get(e.requestId) === e) {
      byRequest.delete(e.requestId);
      info.delete(e.requestId);
    }
  });
  const reset = () => {
    ring.clear();
    byRequest.clear();
    extras.clear();
    info.clear();
  };
  const addFrame = (requestId: string, f: NetworkFrame) => {
    const e = byRequest.get(requestId);
    const x = e && extras.get(e.id);
    if (!e || !x) return;
    const frames = (x.frames ??= []);
    frames.push({ ...f, payload: f.payload.length > FRAME_PAYLOAD_LIMIT ? f.payload.slice(0, FRAME_PAYLOAD_LIMIT) : f.payload });
    if (frames.length > FRAME_CAP) frames.shift();
    ring.emit(e);
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
          (f.type === undefined || e.type?.toLowerCase() === f.type.toLowerCase()) &&
          (f.status === undefined || e.status === f.status) &&
          (f.failed === undefined || isFailed(e) === f.failed),
        o,
      );
    },
    async detail(id, o = {}) {
      const e = ring.items.find((x) => x.id === id);
      const x = extras.get(id);
      if (!e || !x) return undefined;
      const extra = info.get(e.requestId);
      const d: NetworkDetail = { requestHeaders: { ...x.requestHeaders, ...extra?.req }, responseHeaders: { ...x.responseHeaders, ...extra?.res } };
      if (e.mime) d.mime = e.mime;
      if (x.frames?.length) d.frames = [...x.frames];
      if (extra?.blocked.length) d.blockedCookies = [...extra.blocked];
      if (x.postData !== undefined) d.postData = x.postData;
      else if (x.hasPostData) {
        try {
          d.postData = (await session.send('Network.getRequestPostData', { requestId: e.requestId })).postData;
        } catch {
          // post data may be gone already
        }
      }
      if (e.done && !e.failed && !e.frame && e.type !== 'websocket') {
        try {
          const r = await session.send('Network.getResponseBody', { requestId: e.requestId });
          if (r.base64Encoded) {
            d.base64 = true;
            d.bodyBytes = base64Bytes(r.body);
          }
          if (r.body.length > BODY_LIMIT && !o.full) {
            d.truncated = true;
            d.body = r.body.slice(0, BODY_LIMIT);
          } else d.body = r.body;
        } catch {
          // body not available (redirect, evicted, page navigated away)
        }
        if (d.body === undefined && !d.base64 && x.body !== undefined) d.body = x.body;
      }
      return d;
    },
    recorded(id) {
      const x = extras.get(id);
      if (!x) return undefined;
      return { ...(x.postData !== undefined ? { postData: x.postData } : {}), ...(x.body !== undefined ? { body: x.body } : {}) };
    },
    clear: reset,
    on: (_event, cb) => ring.on(cb),
    dispose() {
      for (const off of offs) off();
    },
  };
  const offs = [
    session.on('Network.requestWillBeSent', (p, frame) => {
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
        startedAt: Date.now(),
        ...(frame ? { frame } : {}),
      };
      extras.set(e.id, {
        start: p.timestamp ?? 0,
        requestHeaders: p.request.headers ?? {},
        responseHeaders: {},
        hasPostData: !!p.request.hasPostData,
        ...(typeof p.request.postData === 'string' ? { postData: p.request.postData.slice(0, RECORD_BODY_LIMIT) } : {}),
      });
      byRequest.set(p.requestId, e);
      ring.push(e);
    }),
    session.on('Network.responseReceived', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      e.status = p.response.status;
      e.mime = p.response.mimeType;
      if (typeof p.response.protocol === 'string') e.protocol = p.response.protocol;
      if (p.response.timing && typeof p.response.timing === 'object') e.resourceTiming = p.response.timing;
      if (p.type) e.type = String(p.type).toLowerCase();
      if (p.response.fromDiskCache || p.response.fromPrefetchCache) e.fromCache = true;
      extras.get(e.id)!.responseHeaders = p.response.headers ?? {};
      ring.emit(e);
    }),
    session.on('Network.requestServedFromCache', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      e.fromCache = true;
      ring.emit(e);
    }),
    session.on('Network.requestWillBeSentExtraInfo', (p) => {
      const i = infoOf(p.requestId);
      if (p.headers && typeof p.headers === 'object') i.req = p.headers;
      i.blocked.push(...blockedLines('request cookie', p.associatedCookies));
    }),
    session.on('Network.responseReceivedExtraInfo', (p) => {
      const i = infoOf(p.requestId);
      if (p.headers && typeof p.headers === 'object') i.res = p.headers;
      i.blocked.push(...blockedLines('response cookie', p.blockedCookies));
    }),
    session.on('Network.webSocketCreated', (p, frame) => {
      const e: NetworkEntry = { id: ring.nextId(), requestId: p.requestId, method: 'GET', url: p.url, type: 'websocket', size: 0, done: false, startedAt: Date.now(), ...(frame ? { frame } : {}) };
      extras.set(e.id, { start: 0, requestHeaders: {}, responseHeaders: {}, hasPostData: false, frames: [] });
      byRequest.set(p.requestId, e);
      ring.push(e);
    }),
    session.on('Network.webSocketHandshakeResponseReceived', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      e.status = p.response?.status;
      const x = extras.get(e.id)!;
      x.responseHeaders = p.response?.headers ?? {};
      if (p.response?.requestHeaders) x.requestHeaders = p.response.requestHeaders;
      ring.emit(e);
    }),
    session.on('Network.webSocketFrameSent', (p) => addFrame(p.requestId, { dir: 'sent', opcode: p.response?.opcode ?? 1, payload: String(p.response?.payloadData ?? ''), ts: p.timestamp ?? 0 })),
    session.on('Network.webSocketFrameReceived', (p) => addFrame(p.requestId, { dir: 'recv', opcode: p.response?.opcode ?? 1, payload: String(p.response?.payloadData ?? ''), ts: p.timestamp ?? 0 })),
    session.on('Network.webSocketFrameError', (p) => {
      const e = byRequest.get(p.requestId);
      if (e) e.failed = String(p.errorMessage ?? 'frame error');
    }),
    session.on('Network.webSocketClosed', (p) => {
      const e = byRequest.get(p.requestId);
      if (e) finish(e, undefined);
    }),
    session.on('Network.eventSourceMessageReceived', (p) => addFrame(p.requestId, { dir: 'recv', opcode: p.eventName || 'message', payload: String(p.data ?? ''), ts: p.timestamp ?? 0 })),
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
      const x = extras.get(e.id);
      if (x && !e.frame && !SKIP_RECORD_TYPES.has(e.type ?? '') && !((p.encodedDataLength ?? 0) > RECORD_MAX_ENCODED)) {
        void (async () => {
          try {
            const r = await session.send('Network.getResponseBody', { requestId: p.requestId });
            if (!r?.base64Encoded && typeof r?.body === 'string') x.body = r.body.slice(0, RECORD_BODY_LIMIT);
          } catch {
            // body not available
          }
        })();
      }
    }),
    session.on('Network.loadingFailed', (p) => {
      const e = byRequest.get(p.requestId);
      if (!e) return;
      e.failed = p.canceled ? 'canceled' : failureText(p);
      finish(e, p.timestamp);
    }),
    session.on('Page.frameNavigated', (p) => {
      if (!isMainNavigation(p) || net.preserve) return;
      const keep = ring.items.filter((e) => e.requestId === p.frame.loaderId);
      const kept = keep.map((e) => [e, extras.get(e.id)!] as const);
      const keptInfo = keep.map((e) => [e.requestId, info.get(e.requestId)] as const);
      reset();
      for (const [rid, i] of keptInfo) if (i) info.set(rid, i);
      for (const [e, x] of kept) {
        ring.items.push(e);
        byRequest.set(e.requestId, e);
        extras.set(e.id, x);
      }
    }),
  ];
  return net;
}
