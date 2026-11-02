import type { CdpSession } from './client.ts';

export interface InterceptRule {
  id: string;
  enabled: boolean;
  /** URL pattern: `*` matches any text; without `*` the URL only has to contain it. */
  pattern: string;
  action: 'block' | 'mock';
  /** Mock response. */
  status?: number;
  contentType?: string;
  body?: string;
}

export function patternMatches(pattern: string, url: string): boolean {
  if (!pattern) return false;
  if (!pattern.includes('*')) return url.includes(pattern);
  const re = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}$`).test(url);
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
    const done = (m: string, params: object) => void session.send(m, params).catch(() => undefined);
    if (!rule) done('Fetch.continueRequest', { requestId: id });
    else if (rule.action === 'block') done('Fetch.failRequest', { requestId: id, errorReason: 'BlockedByClient' });
    else {
      done('Fetch.fulfillRequest', {
        requestId: id,
        responseCode: rule.status ?? 200,
        responseHeaders: [
          { name: 'Content-Type', value: rule.contentType || 'application/json' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(rule.body ?? '').toString('base64'),
      });
    }
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
