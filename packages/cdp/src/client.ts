export interface CdpError extends Error {
  code: number | string;
}

export type CdpListener = (params: any, sessionId?: string) => void;

export interface CdpSession {
  send(method: string, params?: object): Promise<any>;
  /** `frame` names the child target (iframe, worker) an event came from; unset for the page itself. */
  on(event: string, cb: (params: any, frame?: string) => void): () => void;
}

export interface CdpClient {
  send(method: string, params?: object, sessionId?: string, timeoutMs?: number): Promise<any>;
  on(event: string, cb: CdpListener): () => void;
  onClose(cb: () => void): void;
  session(sessionId: string): CdpSession;
  close(): void;
}

export interface ConnectOptions {
  WebSocketImpl?: new (url: string) => WebSocket;
}

const cdpError = (code: number | string, message: string): CdpError => Object.assign(new Error(message), { code });

export function connectCdp(wsUrl: string, opts: ConnectOptions = {}): Promise<CdpClient> {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const ws = new Impl(wsUrl);
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Map<string, Set<CdpListener>>();
  const closeCbs: Array<() => void> = [];

  const failAll = () => {
    if (closed) return;
    closed = true;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(cdpError('cdpClosed', 'The connection closed'));
      pending.delete(id);
    }
    for (const cb of closeCbs) cb();
  };

  ws.addEventListener('message', (ev: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(cdpError(msg.error.code, msg.error.message));
      else p.resolve(msg.result);
    } else if (typeof msg.method === 'string') {
      for (const cb of [...(listeners.get(msg.method) ?? [])]) cb(msg.params, msg.sessionId);
    }
  });
  ws.addEventListener('close', failAll);

  const client: CdpClient = {
    send(method, params, sessionId, timeoutMs = 30000) {
      if (closed) return Promise.reject(cdpError('cdpClosed', 'The connection closed'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(cdpError('cdpTimeout', `${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        const payload: Record<string, unknown> = { id, method };
        if (params) payload.params = params;
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
    },
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
      return () => void set.delete(cb);
    },
    onClose(cb) {
      closeCbs.push(cb);
    },
    session(sessionId) {
      return {
        send: (method, params) => client.send(method, params, sessionId),
        on: (event, cb) =>
          client.on(event, (params, sid) => {
            if (sid === sessionId) cb(params);
          }),
      };
    },
    close() {
      ws.close();
      failAll();
    },
  };

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(client));
    ws.addEventListener('error', () => reject(cdpError('cdpConnect', 'Could not connect to the browser')));
  });
}
