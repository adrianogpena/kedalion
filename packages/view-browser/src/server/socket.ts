import type { ServerWebSocket } from 'bun';
import type { SocketData, SocketRoutes, SocketTickets } from '@kedalion/server-core';
import { BROWSER_SOCKET_PATH, parseClientMsg, type ServerMsg } from '../protocol.ts';
import type { BrowserService } from './service.ts';

export interface BrowserSocketOptions {
  service: BrowserService;
  tickets: SocketTickets<true>;
  ready(): Promise<void>;
}

export function browserSockets({ service, tickets, ready }: BrowserSocketOptions): SocketRoutes {
  const clients = new Set<ServerWebSocket<SocketData>>();
  let off: (() => void) | undefined;
  const send = (ws: ServerWebSocket<SocketData>, msg: ServerMsg) => ws.send(JSON.stringify(msg));
  const broadcast = (msg: ServerMsg) => {
    const text = JSON.stringify(msg);
    for (const ws of clients) ws.send(text);
  };
  const fail = (ws: ServerWebSocket<SocketData>, e: unknown) => send(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) });

  return {
    [BROWSER_SOCKET_PATH]: {
      tickets,
      open(ws) {
        clients.add(ws);
        off ??= service.onEvent(broadcast);
        service.setViewers(clients.size);
        ready().then(
          () => {
            send(ws, { type: 'tabs', tabs: service.tabs().list(), ...(service.activeTab() ? { active: service.activeTab()! } : {}) });
          },
          (e) => fail(ws, e),
        );
      },
      message(ws, raw) {
        const msg = parseClientMsg(typeof raw === 'string' ? raw : raw.toString('utf8'));
        if (!msg) return;
        const run = async () => {
          switch (msg.type) {
            case 'viewport':
              service.setViewport(msg);
              return;
            case 'input':
              return service.input(msg.event);
            case 'activate':
              return service.activate(msg.tab);
            case 'selectChoice':
              return service.chooseOption(msg.id, msg.value);
            case 'dialogAnswer':
              return service.answerDialog(msg.tab, msg.accept, msg.text);
          }
        };
        void run().catch((e) => fail(ws, e));
      },
      close(ws) {
        clients.delete(ws);
        service.setViewers(clients.size);
        if (clients.size === 0) {
          off?.();
          off = undefined;
        }
      },
    },
  };
}
