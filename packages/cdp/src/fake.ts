import type { CdpClient, CdpListener, CdpSession } from './client.ts';

export interface FakeCall {
  method: string;
  params?: any;
  sessionId?: string;
}

export type FakeHandler = (params: any, sessionId?: string) => any;

export interface FakeClient extends CdpClient {
  calls: FakeCall[];
  handlers: Record<string, FakeHandler>;
  emit(event: string, params: any, sessionId?: string): void;
  methods(sessionId?: string): string[];
}

export function createFakeClient(handlers: Record<string, FakeHandler> = {}): FakeClient {
  const calls: FakeCall[] = [];
  const listeners = new Map<string, Set<CdpListener>>();
  const on = (event: string, cb: CdpListener) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  };
  const send = async (method: string, params?: any, sessionId?: string) => {
    calls.push({ method, params, sessionId });
    const h = fake.handlers[method];
    return h ? h(params, sessionId) : {};
  };
  const fake: FakeClient = {
    calls,
    handlers,
    send,
    on,
    onClose() {},
    close() {},
    session(sessionId: string): CdpSession {
      return {
        send: (method, params) => send(method, params, sessionId),
        on: (event, cb) => on(event, (p, sid) => sid === sessionId && cb(p)),
      };
    },
    emit(event, params, sessionId) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(params, sessionId);
    },
    methods(sessionId) {
      return calls.filter((c) => sessionId === undefined || c.sessionId === sessionId).map((c) => c.method);
    },
  } as FakeClient;
  return fake;
}
