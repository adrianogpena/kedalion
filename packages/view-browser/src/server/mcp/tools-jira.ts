import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { runtimeEval, str } from './page-util.ts';
import { extFor, loadResource, uniqueFile, writeOutput } from './resource.ts';
import { failResult, type McpTool, textResult, type ToolContext } from './types.ts';

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  created: string;
}

/** Names of one document across its versions share this key (extension kept: a .docx and its .pdf stay apart). */
export function attachmentFamily(filename: string): string {
  const ext = extname(filename).toLowerCase();
  let base = filename.slice(0, filename.length - ext.length).toLowerCase();
  base = base.replace(/\([0-9a-f]{8}-[0-9a-f-]{27}\)/g, '').replace(/\(\d+\)/g, '');
  base = base.replace(/\s*reviewed.*$/, '').replace(/(?:^|[ _\-.])v\.?\s*\d+(?:[.\-]\d+)*/g, '');
  return `${base.replace(/[^a-z0-9]/g, '')}${ext}`;
}

export interface Family {
  newest: Attachment;
  older: Attachment[];
}

/** One entry per document family: the newest upload (ties: higher id), with the older ones. Images are never merged. */
export function newestPerFamily(list: Attachment[]): Family[] {
  const groups = new Map<string, Attachment[]>();
  for (const a of list) {
    const key = a.mimeType.startsWith('image/') ? `image:${a.id}` : attachmentFamily(a.filename);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const newer = (x: Attachment, y: Attachment) => y.created.localeCompare(x.created) || Number(y.id) - Number(x.id);
  return [...groups.values()].map((g) => ({ newest: [...g].sort(newer)[0]!, older: [...g].sort(newer).slice(1) })).sort((x, y) => y.newest.created.localeCompare(x.newest.created));
}

/** Text of word/document.xml inside a .docx (a zip), paragraphs on lines and table cells separated by " | ". */
export function docxText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const next = p + 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === 'word/document.xml') {
      const local = buf.readUInt32LE(p + 42);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      const xml = (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
      return xml
        .replace(/<\/w:p>\s*<\/w:tc>|<\/w:tc>/g, ' | ')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<\/w:p>|<w:br\s*\/>/g, '\n')
        .replace(/<w:tab\s*\/>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/ \| *\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    p = next;
  }
  throw new Error('word/document.xml not found: not a .docx');
}

const ISSUE = /\/browse\/([A-Z][A-Z0-9]+-\d+)/;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

/** A tab on a Jira site (the active one when it is, else the first), with its origin. */
function jiraTab(ctx: ToolContext, wanted?: string): { id: string; url: string; origin: string } {
  const tabs = ctx.service.tabs().list();
  const isJira = (u: string) => /^https:\/\/[^/]+\.atlassian\.net\//.test(u);
  const active = ctx.service.activeTab();
  const t = (wanted ? tabs.find((x) => x.id === wanted) : undefined) ?? tabs.find((x) => x.id === active && isJira(x.url)) ?? tabs.find((x) => isJira(x.url));
  if (!t || !isJira(t.url)) throw new Error('Open a Jira page (https://<site>.atlassian.net/...) in the browser first and sign in; this tool uses its session.');
  return { id: t.id, url: t.url, origin: new URL(t.url).origin };
}

async function pageJson<T>(ctx: ToolContext, tab: string, path: string): Promise<T> {
  const r = await runtimeEval(ctx.service.tabs().session(tab), `fetch(${JSON.stringify(path)}, { credentials: 'include' }).then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return JSON.stringify(await r.json()); })`, { awaitPromise: true, timeoutMs: 20_000 });
  if (!r.ok) throw new Error(`Jira ${path.split('?')[0]}: ${r.text}`);
  return JSON.parse(r.text) as T;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'attachment';

export const jiraTools: McpTool[] = [
  {
    name: 'jira_attachments',
    description:
      'Attachments of a Jira issue, using the browser\'s signed-in Jira session. Without get: lists only the newest upload of each document (versions V.1, V.2, "(1)", "Reviewed" and copies are folded into one family; all=true lists every file). With get (attachment ids from the list, comma separated): saves just those files under their real names and, for .docx, with text=true also writes a .txt next to it (PDFs and images: open the saved file directly). issue defaults to the key in the active Jira tab URL.',
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'Issue key, e.g. VWDE-24050; default the one in the Jira tab URL.' },
        all: { type: 'boolean', description: 'List every attachment, not only the newest of each document.' },
        get: { type: 'string', description: 'Attachment ids to save, comma separated.' },
        text: { type: 'boolean', description: 'With get: also write the text of .docx files to a .txt next to them.' },
        dir: { type: 'string', description: 'Absolute folder to save into; default Downloads/kedalion/jira/<ISSUE>.' },
        tab: { type: 'string', description: 'A Jira tab id from browser_tabs; default the active (or first) Jira tab.' },
      },
    },
    async run(a, ctx) {
      try {
        await ctx.ready();
        const t = jiraTab(ctx, str(a, 'tab'));
        const key = str(a, 'issue') ?? t.url.match(ISSUE)?.[1];
        if (!key || !/^[A-Z][A-Z0-9]+-\d+$/.test(key)) return failResult('Pass issue (e.g. VWDE-24050), or open a /browse/<KEY> page.');
        const issue = await pageJson<{ fields: { attachment?: Attachment[] } }>(ctx, t.id, `/rest/api/3/issue/${key}?fields=attachment`);
        const all = (issue.fields.attachment ?? []).map(({ id, filename, mimeType, size, created }) => ({ id, filename, mimeType, size, created }));
        const ids = (str(a, 'get') ?? '').split(/[\s,]+/).filter(Boolean);
        if (!ids.length) {
          if (!all.length) return textResult(`${key} has no attachments.`);
          const line = (x: Attachment, note = '') => `${x.id}  ${x.created.slice(0, 10)}  ${kb(x.size).padStart(7)}  ${x.mimeType.split('/').pop()?.replace(/^vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, 'docx')}  ${x.filename}${note}`;
          if (a.all === true) {
            const sorted = [...all].sort((x, y) => y.created.localeCompare(x.created) || Number(y.id) - Number(x.id));
            const dup = (x: Attachment) => sorted.find((y) => y !== x && y.filename === x.filename && y.size === x.size && y.created.slice(0, 16) === x.created.slice(0, 16) && Number(y.id) > Number(x.id));
            return textResult(`${key}: ${all.length} attachments\n${sorted.map((x) => line(x, dup(x) ? `  [same file as ${dup(x)!.id}]` : '')).join('\n')}`);
          }
          const fams = newestPerFamily(all);
          const hidden = fams.reduce((n, f) => n + f.older.length, 0);
          return textResult(`${key}: ${fams.length} documents (newest version of each)\n${fams.map((f) => line(f.newest, f.older.length ? `  [newest of ${f.older.length + 1}]` : '')).join('\n')}${hidden ? `\n(${hidden} older versions hidden; all=true lists them)` : ''}`);
        }
        const dir = str(a, 'dir') ?? join(homedir(), 'Downloads', 'kedalion', 'jira', key);
        const session = ctx.service.tabs().session(t.id);
        const taken = new Set<string>();
        const lines: string[] = [];
        for (const id of ids) {
          const meta = all.find((x) => x.id === id);
          if (!meta) {
            lines.push(`FAILED ${id}: not an attachment of ${key}`);
            continue;
          }
          try {
            const res = await loadResource(session, t.id, `${t.origin}/rest/api/3/attachment/content/${id}`);
            const name = safeName(meta.filename);
            const file = uniqueFile(dir, extname(name) ? name : `${name}${extFor(meta.mimeType)}`, taken);
            await writeOutput(file, res.bytes);
            lines.push(`saved ${file} (${meta.mimeType.split('/').pop()}, ${kb(res.bytes.length)})`);
            if (a.text === true && /\.docx$/i.test(meta.filename)) {
              const txt = await writeOutput(file.replace(/\.docx$/i, '.txt'), docxText(res.bytes));
              lines.push(`text  ${txt}`);
            }
          } catch (e) {
            lines.push(`FAILED ${id} ${meta.filename}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return textResult(lines.join('\n'));
      } catch (e) {
        return failResult(e instanceof Error ? e.message : String(e));
      }
    },
  },
];
