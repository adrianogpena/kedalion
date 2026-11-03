export interface DecodedOperation {
  operation: string;
  args: string;
}

export interface RequestLike {
  method?: string;
  url: string;
  postData?: string | undefined;
  contentType?: string | undefined;
}

export const ARGS_CAP = 160;

const isForm = (contentType: string | undefined, body: string) =>
  /x-www-form-urlencoded/i.test(contentType ?? '') || (!contentType && /^[\w.-]+=/.test(body) && body.includes('%3C'));

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** The XML text of a body: the `_transaction` field of a form body, the whole decoded body otherwise. */
function xmlOf(body: string): string {
  const m = /(?:^|&)_transaction=([^&]*)/.exec(body);
  if (m) return safeDecode(m[1]!);
  return body.includes('%3C') ? safeDecode(body) : body;
}

function summarizeValues(segment: string): string {
  const values = /<values(?:\s[^>]*)?>([\s\S]*?)(?:<\/values>|$)/.exec(segment)?.[1] ?? '';
  const leaves = [...values.matchAll(/<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g)].map((m) => `${m[1]}=${m[2]!.trim()}`);
  const text = leaves.length ? leaves.join(', ') : values.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > ARGS_CAP ? `${text.slice(0, ARGS_CAP - 3)}...` : text;
}

/** GWT-RPC body `7|0|<n>|base|strongName|service|method|...`: `Service.method`, null for any other body. */
function decodeGwtRpc(body: string): DecodedOperation | null {
  const parts = body.split('|');
  if (!/^\d+$/.test(parts[0] ?? '') || !/^\d+$/.test(parts[1] ?? '') || !/^\d+$/.test(parts[2] ?? '')) return null;
  const count = Number(parts[2]);
  const strings = parts.slice(3, 3 + count);
  if (strings.length < 4 || strings.length < count) return null;
  return { operation: `${strings[2]!.split('.').pop()}.${strings[3]}`, args: '' };
}

/** Operations batched in an RPC body (SmartGWT `_transaction` XML): name and a one-line summary of the values. */
export function decodeOperations(body: string): DecodedOperation[] {
  const gwt = decodeGwtRpc(body);
  if (gwt) return [gwt];
  const xml = xmlOf(body);
  const starts = [...xml.matchAll(/<operation>([^<]*)<\/operation>/g)];
  return starts.map((m, i) => {
    const end = starts[i + 1]?.index ?? xml.length;
    return { operation: m[1]!.trim(), args: summarizeValues(xml.slice(m.index! + m[0].length, end)) };
  });
}

function indentXml(xml: string): string {
  const out: string[] = [];
  let depth = 0;
  for (const tok of xml.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (!tok.startsWith('<')) {
      const text = tok.trim();
      if (!text) continue;
      const last = out.length - 1;
      if (last >= 0 && /^\s*<[\w:.-]+(\s[^>]*)?>$/.test(out[last]!)) out[last] += text;
      else out.push('  '.repeat(depth) + text);
      continue;
    }
    if (tok.startsWith('</')) {
      const last = out.length - 1;
      const open = /^\s*<([\w:.-]+)(\s[^>]*)?>/.exec(out[last] ?? '');
      depth = Math.max(depth - 1, 0);
      if (last >= 0 && open && !out[last]!.includes('</') && tok === `</${open[1]}>`) out[last] += tok;
      else out.push('  '.repeat(depth) + tok);
    } else if (tok.startsWith('<?') || tok.startsWith('<!') || tok.endsWith('/>')) out.push('  '.repeat(depth) + tok);
    else {
      out.push('  '.repeat(depth) + tok);
      depth++;
    }
  }
  return out.join('\n');
}

/** Readable body: form bodies url-decoded with indented XML, JSON indented, anything else unchanged. */
export function prettyBody(body: string, contentType = ''): string {
  if (/json/i.test(contentType)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  if (isForm(contentType, body)) {
    return body
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
        const value = eq < 0 ? '' : safeDecode(pair.slice(eq + 1));
        return value.trimStart().startsWith('<') ? `${key}=\n${indentXml(value.trim())}` : `${key}=${value}`;
      })
      .join('\n');
  }
  return body;
}

/** E.g. `IDACall: ISystemRepositoryOutpost.getConfigurationProperties +14`; empty when the request carries no operations. */
export function summarizeRequest(req: RequestLike): string {
  if (!req.postData) return '';
  const ops = decodeOperations(req.postData);
  if (!ops.length) return '';
  let path = req.url;
  try {
    path = new URL(req.url).pathname;
  } catch {
    // keep the raw url
  }
  const name = path.split('/').filter(Boolean).pop() ?? 'rpc';
  return `${name}: ${ops[0]!.operation}${ops.length > 1 ? ` +${ops.length - 1}` : ''}`;
}

/** Resource types hidden by the compact network view when they succeeded. */
export const STATIC_TYPES = new Set(['image', 'stylesheet', 'script', 'font', 'media', 'manifest', 'texttrack']);

const COMPACT_VALUE_MAX = 40;

/** Path plus the query parameters whose values are short; long ones (encoded transactions) become `name=…`. */
export function compactUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const parts = [...u.searchParams].map(([k, v]) => (v.length <= COMPACT_VALUE_MAX ? `${k}=${v}` : `${k}=…`));
  return u.pathname + (parts.length ? `?${parts.join('&')}` : '');
}
