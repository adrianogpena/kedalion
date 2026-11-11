import type { CdpSession } from './client.ts';

export interface InterceptRule {
  id: string;
  enabled: boolean;
  /** URL pattern: `*` matches any text; without `*` the URL only has to contain it. */
  pattern: string;
  /** `modify` lets the request continue with `headers` set as request headers. */
  action: 'block' | 'mock' | 'modify';
  /** Mock response. */
  status?: number;
  contentType?: string;
  body?: string;
  /** Wait this long before answering (mock/block) or continuing. */
  delayMs?: number;
  /** Mock: response headers set or overriding the defaults. Modify: request headers to set. */
  headers?: Record<string, string>;
  /** Requests this rule has handled (runtime only). */
  hits?: number;
}

type HeaderList = { name: string; value: string }[];

/** `base` with `extra` set over it (header names compare case-insensitively). */
export function mergeHeaders(base: HeaderList, extra: Record<string, string> | undefined): HeaderList {
  const out = [...base];
  for (const [name, value] of Object.entries(extra ?? {})) {
    const i = out.findIndex((h) => h.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) out[i] = { name, value };
    else out.push({ name, value });
  }
  return out;
}

/** Mock response headers: content type and CORS (the request Origin echoed with credentials, else `*`), then the rule's own. */
export function mockHeaders(rule: InterceptRule, requestHeaders: Record<string, string> | undefined): HeaderList {
  const origin = Object.entries(requestHeaders ?? {}).find(([k]) => k.toLowerCase() === 'origin')?.[1];
  const base: HeaderList = [
    { name: 'Content-Type', value: rule.contentType || 'application/json' },
    { name: 'Access-Control-Allow-Origin', value: origin || '*' },
    ...(origin ? [{ name: 'Access-Control-Allow-Credentials', value: 'true' }] : []),
  ];
  return mergeHeaders(base, rule.headers);
}

export function patternMatches(pattern: string, url: string): boolean {
  if (!pattern) return false;
  if (!pattern.includes('*')) return url.includes(pattern);
  const parts = pattern.split('*');
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (url.length < first.length + last.length || !url.startsWith(first) || !url.endsWith(last)) return false;
  let pos = first.length;
  const end = url.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!part) continue;
    const at = url.indexOf(part, pos);
    if (at < 0 || at + part.length > end) return false;
    pos = at + part.length;
  }
  return true;
}

/** The first enabled rule that matches the URL. */
export function matchRule(rules: readonly InterceptRule[], url: string): InterceptRule | undefined {
  return rules.find((r) => r.enabled && patternMatches(r.pattern, url));
}

export interface Interceptor {
  setRules(rules: readonly InterceptRule[]): void;
  dispose(): void;
}

/** Blocks or mocks the requests of one tab that match a rule; every other request continues untouched. */
export function createInterceptor(session: CdpSession, initial: readonly InterceptRule[] = []): Interceptor {
  let rules: readonly InterceptRule[] = [];
  let active = false;
  const off = session.on('Fetch.requestPaused', (p) => {
    const rule = matchRule(rules, String(p.request?.url ?? ''));
    const id = p.requestId as string;
    const send = (m: string, params: object) => void session.send(m, params).catch(() => undefined);
    if (!rule) return send('Fetch.continueRequest', { requestId: id });
    rule.hits = (rule.hits ?? 0) + 1;
    const done = () => {
      if (rule.action === 'block') send('Fetch.failRequest', { requestId: id, errorReason: 'BlockedByClient' });
      else if (rule.action === 'modify') {
        const reqHeaders = Object.entries((p.request?.headers ?? {}) as Record<string, string>).map(([name, value]) => ({ name, value: String(value) }));
        send('Fetch.continueRequest', { requestId: id, headers: mergeHeaders(reqHeaders, rule.headers) });
      } else {
        send('Fetch.fulfillRequest', {
          requestId: id,
          responseCode: rule.status ?? 200,
          responseHeaders: mockHeaders(rule, p.request?.headers),
          body: Buffer.from(rule.body ?? '').toString('base64'),
        });
      }
    };
    if (rule.delayMs && rule.delayMs > 0) setTimeout(done, rule.delayMs);
    else done();
  });
  const interceptor: Interceptor = {
    setRules(next) {
      rules = next;
      const want = next.some((r) => r.enabled && r.pattern);
      if (want === active) return;
      active = want;
      void session.send(want ? 'Fetch.enable' : 'Fetch.disable', want ? { patterns: [{ urlPattern: '*', requestStage: 'Request' }] } : {}).catch(() => undefined);
    },
    dispose() {
      off();
      if (active) void session.send('Fetch.disable').catch(() => undefined);
      active = false;
    },
  };
  interceptor.setRules(initial);
  return interceptor;
}
