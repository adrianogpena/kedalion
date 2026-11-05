import type { ImportedRequest } from './http-import';

export type CurlExportFormat = 'fetch' | 'powershell' | 'http';

interface Plain {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: string;
  json: boolean;
}

function plain(request: ImportedRequest): Plain {
  const { draft, auth } = request;
  const headers = draft.headers.filter((h) => h.enabled && h.name.trim() !== '').map((h): [string, string] => [h.name.trim(), h.value]);
  if (auth && !headers.some(([n]) => n.toLowerCase() === 'authorization')) headers.push(['Authorization', auth]);
  let body = draft.body;
  if (draft.bodyLang === 'form' || draft.bodyLang === 'multipart') {
    body = (draft.form ?? []).map((f) => `${encodeURIComponent(f.name)}=${encodeURIComponent(f.value)}`).join('&');
    if (draft.bodyLang === 'form' && !headers.some(([n]) => n.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  const sends = draft.method !== 'GET' && draft.method !== 'HEAD';
  return { method: draft.method, url: draft.url, headers, body: sends ? body : '', json: draft.bodyLang === 'json' };
}

const contentType = (headers: Array<[string, string]>) => headers.find(([n]) => n.toLowerCase() === 'content-type')?.[1];

function indent(text: string, by: string): string {
  return text.split('\n').map((l, i) => (i === 0 ? l : by + l)).join('\n');
}

function asFetch(p: Plain): string {
  const lines = [`method: ${JSON.stringify(p.method)},`];
  if (p.headers.length) lines.push(`headers: {\n${p.headers.map(([n, v]) => `    ${JSON.stringify(n)}: ${JSON.stringify(v)},`).join('\n')}\n  },`);
  if (p.body !== '') {
    let literal = JSON.stringify(p.body);
    if (p.json) {
      try {
        literal = `JSON.stringify(${indent(JSON.stringify(JSON.parse(p.body), null, 2), '  ')})`;
      } catch {
        // not valid JSON (e.g. an unquoted {{variable}}): keep the string literal
      }
    }
    lines.push(`body: ${literal},`);
  }
  return `const response = await fetch(${JSON.stringify(p.url)}, {\n  ${lines.join('\n  ')}\n});\nconsole.log(response.status, await response.text());\n`;
}

const psq = (s: string) => `'${s.replaceAll("'", "''")}'`;

function asPowerShell(p: Plain): string {
  const type = contentType(p.headers);
  const headers = p.headers.filter(([n]) => n.toLowerCase() !== 'content-type');
  const out: string[] = [];
  if (headers.length) out.push(`$headers = @{\n${headers.map(([n, v]) => `  ${psq(n)} = ${psq(v)}`).join('\n')}\n}`);
  if (p.body !== '') out.push(`$body = @'\n${p.body}\n'@`);
  const call = [`Invoke-RestMethod -Method ${p.method[0]}${p.method.slice(1).toLowerCase()} -Uri ${psq(p.url)}`];
  if (headers.length) call.push('-Headers $headers');
  if (type) call.push(`-ContentType ${psq(type)}`);
  if (p.body !== '') call.push('-Body $body');
  out.push(call.join(' `\n  '));
  return `${out.join('\n\n')}\n`;
}

function asHttp(p: Plain): string {
  const head = [`${p.method} ${p.url}`, ...p.headers.map(([n, v]) => `${n}: ${v}`)].join('\n');
  return p.body === '' ? `${head}\n` : `${head}\n\n${p.body}\n`;
}

/** The request as a JavaScript `fetch` call, a PowerShell `Invoke-RestMethod` call or a `.http` (REST Client) request. `{{variables}}` stay as they are. */
export function exportCurl(request: ImportedRequest, format: CurlExportFormat): string {
  const p = plain(request);
  return format === 'fetch' ? asFetch(p) : format === 'powershell' ? asPowerShell(p) : asHttp(p);
}
