import type { NetworkDetail, NetworkEntry } from '@kedalion/cdp';

const pairs = (h: Record<string, string>) => Object.entries(h).map(([name, value]) => ({ name, value }));

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
          startedDateTime: new Date().toISOString(),
          time,
          request: {
            method: e.method,
            url: e.url,
            httpVersion: 'HTTP/1.1',
            headers: pairs(d?.requestHeaders ?? {}),
            queryString: [],
            cookies: [],
            headersSize: -1,
            bodySize: d?.postData?.length ?? 0,
            ...(d?.postData !== undefined ? { postData: { mimeType: d.requestHeaders['Content-Type'] ?? '', text: d.postData } } : {}),
          },
          response: {
            status: e.failed ? 0 : (e.status ?? 0),
            statusText: e.failed ?? '',
            httpVersion: 'HTTP/1.1',
            headers: pairs(d?.responseHeaders ?? {}),
            cookies: [],
            content: { size: e.size, mimeType, ...(d?.body !== undefined ? { text: d.body, ...(d.base64 ? { encoding: 'base64' } : {}) } : {}) },
            redirectURL: d?.responseHeaders.Location ?? d?.responseHeaders.location ?? '',
            headersSize: -1,
            bodySize: e.size,
          },
          cache: {},
          timings: { send: 0, wait: time, receive: 0 },
        };
      }),
    },
  };
}
