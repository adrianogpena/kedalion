const HIDDEN = new Set(['host', 'content-length', 'connection']);

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A `curl` command (bash quoting) that repeats a request. */
export function toCurl(req: { method: string; url: string; headers: Record<string, string>; body?: string }): string {
  const parts = ['curl', quote(req.url)];
  if (req.method !== 'GET') parts.push('-X', req.method);
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HIDDEN.has(name.toLowerCase()) && !name.startsWith(':')) parts.push('-H', quote(`${name}: ${value}`));
  }
  if (req.body !== undefined && req.body !== '') parts.push('--data-raw', quote(req.body));
  return parts.join(' ');
}
