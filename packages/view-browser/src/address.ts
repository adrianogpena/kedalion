const SCHEME = /^(?:[a-z][a-z0-9+.-]*:\/\/|about:|data:|view-source:)/i;
const HOST = /^(?:localhost|127\.0\.0\.1|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#].*)?$/i;
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::|[/?#]|$)/i;

export const SEARCH_URL = 'https://www.bing.com/search?q=';

/** URL bar text to a URL: a scheme is kept, a host gets http:// (localhost) or https://, anything else is a search. */
export function normalizeAddress(text: string): string {
  const s = text.trim();
  if (!s) return 'about:blank';
  if (SCHEME.test(s)) return s;
  if (!/\s/.test(s) && HOST.test(s)) return `${LOCAL.test(s) ? 'http' : 'https'}://${s}`;
  return SEARCH_URL + encodeURIComponent(s);
}

/** Like normalizeAddress, but only http:, https: and about:blank are allowed (throws otherwise). */
export function normalizeWebAddress(text: string): string {
  const url = normalizeAddress(text);
  if (url === 'about:blank') return url;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`Invalid address: ${url}`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error('Only http, https and about:blank addresses are allowed.');
  return url;
}
