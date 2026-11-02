import { useEffect, useMemo, useRef, useState } from 'react';
import { browserApi } from '../client';
import { BROWSER_SOCKET_PATH, type ClientMsg, type ServerMsg } from '../protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface BrowserSocket {
  status: SocketStatus;
  /** Sends while open; dropped otherwise. */
  send(msg: ClientMsg): void;
  /** Calls `fn` with every server message; returns the unsubscribe. */
  subscribe(fn: (msg: ServerMsg) => void): () => void;
}

const MAX_DELAY = 15_000;

/** The Browser socket: opens with a ticket and reconnects with backoff. */
export function useBrowserSocket(): BrowserSocket {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const ws = useRef<WebSocket | null>(null);
  const subs = useRef(new Set<(msg: ServerMsg) => void>());

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      if (stopped) return;
      setStatus('closed');
      timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, MAX_DELAY));
    };
    async function connect() {
      try {
        const { ticket } = await browserApi.socketTicket();
        if (stopped) return;
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const s = new WebSocket(`${scheme}//${location.host}${BROWSER_SOCKET_PATH}?t=${encodeURIComponent(ticket)}`);
        ws.current = s;
        s.onopen = () => {
          attempt = 0;
          setStatus('open');
        };
        s.onmessage = (e) => {
          let msg: ServerMsg;
          try {
            msg = JSON.parse(String(e.data)) as ServerMsg;
          } catch {
            return;
          }
          for (const fn of subs.current) fn(msg);
        };
        s.onclose = () => {
          if (ws.current === s) ws.current = null;
          retry();
        };
      } catch {
        retry();
      }
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      const s = ws.current;
      ws.current = null;
      if (s) {
        s.onclose = null;
        s.close();
      }
    };
  }, []);

  return useMemo<BrowserSocket>(
    () => ({
      status,
      send(msg) {
        const s = ws.current;
        if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg));
      },
      subscribe(fn) {
        subs.current.add(fn);
        return () => void subs.current.delete(fn);
      },
    }),
    [status],
  );
}
