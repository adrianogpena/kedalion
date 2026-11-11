import type { NetworkDetail, NetworkEntry } from '@kedalion/cdp';

const pairs = (h: Record<string, string>) => Object.entries(h).map(([name, value]) => ({ name, value }));

const queryOf = (url: string): { name: string; value: string }[] => {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
};

const httpVersionOf = (protocol: string | undefined): string => {
  switch (protocol?.toLowerCase()) {
    case 'h2':
      return 'HTTP/2.0';
    case 'h3':
      return 'HTTP/3.0';
    case 'http/1.0':
      return 'HTTP/1.0';
    case undefined:
    case '':
    case 'http/1.1':
      return 'HTTP/1.1';
    default:
      return protocol!.toUpperCase();
  }
};

/** HAR timings from a CDP ResourceTiming (ms offsets; -1 when absent); without it the whole time is `wait`. */
export function harTimings(t: Record<string, number> | undefined, total: number): Record<string, number> {
  if (!t || typeof t.sendStart !== 'number' || t.sendStart < 0) return { send: 0, wait: total, receive: 0 };
  const span = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && a >= 0 && b >= a ? b - a : -1);
  const ssl = span(t.sslStart, t.sslEnd);
  const connectRaw = span(t.connectStart, t.connectEnd);
  const send = Math.max(span(t.sendStart, t.sendEnd), 0);
  const wait = t.receiveHeadersEnd !== undefined && t.receiveHeadersEnd >= (t.sendEnd ?? t.sendStart) ? t.receiveHeadersEnd - (t.sendEnd ?? t.sendStart) : 0;
  const receive = Math.max(total - Math.max(t.receiveHeadersEnd ?? 0, 0), 0);
  return {
    blocked: -1,
    dns: span(t.dnsStart, t.dnsEnd),
    connect: connectRaw >= 0 && ssl >= 0 ? connectRaw - ssl : connectRaw,
    ssl,
    send,
    wait,
    receive,
  };
}

/** HAR 1.2 of the given requests; `details` is looked up by entry id. */
export function buildHar(entries: readonly NetworkEntry[], details: ReadonlyMap<number, NetworkDetail | undefined>): unknown {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Kedalion', version: '1' },
      entries: entries.map((e) => {
        const d = details.get(e.id);
        const time = e.timing ?? 0;
        const mimeType = e.mime ?? '';
        return {
          startedDateTime: new Date(e.startedAt ?? Date.now()).toISOString(),
          time,
          request: {
            method: e.method,
            url: e.url,
            httpVersion: httpVersionOf(e.protocol),
            headers: pairs(d?.requestHeaders ?? {}),
            queryString: queryOf(e.url),
            cookies: [],
            headersSize: -1,
            bodySize: d?.postData?.length ?? 0,
            ...(d?.postData !== undefined ? { postData: { mimeType: d.requestHeaders['Content-Type'] ?? '', text: d.postData } } : {}),
          },
          response: {
            status: e.failed ? 0 : (e.status ?? 0),
            statusText: e.failed ?? '',
            httpVersion: httpVersionOf(e.protocol),
            headers: pairs(d?.responseHeaders ?? {}),
            cookies: [],
            content: { size: e.size, mimeType, ...(d?.body !== undefined ? { text: d.body, ...(d.base64 ? { encoding: 'base64' } : {}) } : {}) },
            redirectURL: d?.responseHeaders.Location ?? d?.responseHeaders.location ?? '',
            headersSize: -1,
            bodySize: e.size,
          },
          cache: {},
          timings: harTimings(e.resourceTiming, time),
        };
      }),
    },
  };
}
