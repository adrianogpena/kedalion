import type { CdpSession } from '@kedalion/cdp';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PAGE_LIB } from './page-lib.ts';
import { bool, num, pageSession, resolveTab, runtimeEval, str, withTimeout } from './page-util.ts';
import { fileNameFor, loadResource, toPng, uniqueFile, writeOutput } from './resource.ts';
import { challengeNote, type PageImages } from './snapshot.ts';
import { loadReport } from './tools-page.ts';
import { failResult, type McpTool, textResult, type ToolArgs, type ToolContent, type ToolProp, type ToolSchema } from './types.ts';

const TAB: ToolProp = { type: 'string', description: 'Tab id from browser_tabs; default the active tab.' };
const schema = (properties: Record<string, ToolProp>, required: string[] = []): ToolSchema => ({
  type: 'object',
  properties: { ...properties, tab: TAB },
  ...(required.length ? { required } : {}),
});
const CONTENT: Record<string, ToolProp> = {
  main: { type: 'boolean', description: 'Only the main content (article, main, wiki body), default true.' },
  scope: { type: 'string', description: 'CSS selector or text of the container to use instead of the main content.' },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`);

/** Runs `expr` with `kd` (the in-page library) in scope and returns its value. */
async function kdCall<T>(session: CdpSession, expr: string, timeoutMs = 15_000): Promise<T> {
  const r = await runtimeEval(session, `(async () => { const kd = ${PAGE_LIB}; return await (${expr}); })()`, { returnByValue: true, awaitPromise: true, timeoutMs });
  if (!r.ok) throw new Error(r.text);
  return r.value as T;
}

const rootArgs = (a: ToolArgs) => {
  const scope = str(a, 'scope');
  return `${JSON.stringify(scope ?? null)}, ${scope ? false : a.main !== false}`;
};

const guard = (fn: McpTool['run']): McpTool['run'] => async (a, ctx) => {
  try {
    return await fn(a, ctx);
  } catch (e) {
    return failResult(e instanceof Error ? e.message : String(e));
  }
};

interface Markdown {
  title: string;
  url: string;
  markdown: string;
  error?: string;
}

/** Default folder for files a tool saves: Downloads/kedalion/<host>. */
function defaultDir(url: string, sub = ''): string {
  let host = 'page';
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || host;
  } catch {
    // keep the default
  }
  return join(homedir(), 'Downloads', 'kedalion', host.replace(/[^a-z0-9.-]/gi, '_'), sub);
}

interface SavedFile {
  url: string;
  path?: string;
  mime?: string;
  bytes?: number;
  error?: string;
}

/** Downloads each URL through the browser into `dir` (as PNG when `png`); 4 at a time. */
async function downloadAll(session: CdpSession, frameId: string, urls: string[], dir: string, png: boolean): Promise<SavedFile[]> {
  await mkdir(dir, { recursive: true });
  const taken = new Set<string>();
  const out: SavedFile[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i]!;
      try {
        const res = await loadResource(session, frameId, url);
        let bytes = res.bytes;
        let mime = res.mime;
        if (png && mime?.startsWith('image/') && mime !== 'image/png' && mime !== 'image/svg+xml') {
          const c = await toPng(session, bytes);
          if ('data' in c) {
            bytes = new Uint8Array(Buffer.from(c.data, 'base64'));
            mime = 'image/png';
          }
        }
        const path = uniqueFile(dir, fileNameFor(url, mime), taken);
        await writeFile(path, bytes);
        out[i] = { url, path, mime, bytes: bytes.length };
      } catch (e) {
        out[i] = { url, error: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  return out;
}

/** Whether `url` matches a crawl pattern: full URL or path, `*` matches anything, else a prefix. */
export function matchesPattern(url: string, pattern: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const subject = /^https?:/i.test(pattern) ? `${u.origin}${u.pathname}${u.search}` : `${u.pathname}${u.search}`;
  if (!pattern.includes('*')) return subject.startsWith(pattern);
  const rx = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return rx.test(subject);
}

/** The default crawl pattern: the folder of the start page, e.g. https://x/guide/ for https://x/guide/intro. */
export function defaultPattern(start: string): string {
  const u = new URL(start);
  return `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`;
}

/** The URL without its #fragment, for de-duplication. */
export const pageKey = (url: string): string => url.replace(/#.*$/, '');

const NOT_PAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|pdf|zip|rar|7z|gz|mp3|mp4|webm|exe|msi|css|js|json|xml)$/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';

export const contentTools: McpTool[] = [
  {
    name: 'browser_extract',
    description:
      'The page content as Markdown: headings, paragraphs, lists, tables (as Markdown tables), links and images (![alt](real source)). Default the main content only (article, wiki body), without navigation. Long pages are paged with offset; saveTo writes the whole Markdown to a file.',
    inputSchema: schema({
      ...CONTENT,
      maxChars: { type: 'integer', description: 'Characters to return, default 12000, at most 19000.' },
      offset: { type: 'integer', description: 'First character to return, default 0.' },
      saveTo: { type: 'string', description: 'Absolute file path: write the whole Markdown there and return only its path and size.' },
    }),
    run: guard(async (a, ctx) => {
      const { session } = await pageSession(ctx, a);
      const md = await kdCall<Markdown>(session, `kd.markdown(${rootArgs(a)})`);
      if (md.error) return failResult(md.error);
      const challenge = await kdCall<string | null>(session, 'kd.challenge()');
      const head = `Title: ${md.title}\nURL: ${md.url}${challenge ? `\n${challengeNote(challenge)}` : ''}`;
      const saveTo = str(a, 'saveTo');
      if (saveTo) {
        const file = await writeOutput(saveTo, `# ${md.title}\n\nSource: ${md.url}\n\n${md.markdown}\n`);
        return textResult(`${head}\nSaved ${md.markdown.length} chars of Markdown to ${file}`);
      }
      const size = Math.min(Math.max(num(a, 'maxChars') ?? 12_000, 500), 19_000);
      const start = Math.min(Math.max(num(a, 'offset') ?? 0, 0), md.markdown.length);
      const end = Math.min(start + size, md.markdown.length);
      const more = end < md.markdown.length ? `\n\n... [chars ${start}-${end} of ${md.markdown.length}] pass offset=${end} for the next part, or saveTo=<file> for all of it` : '';
      return textResult(`${head}\n\n${md.markdown.slice(start, end) || '(no content found; try main=false or a scope)'}${more}`);
    }),
  },
  {
    name: 'browser_image',
    description:
      'Show an image to you (returned as an image): an <img> or element by ref (from browser_snapshot images) or selector, or any image URL. Image files are fetched through the browser (its cookies; works where plain downloads are refused) and converted to PNG (first frame of an animation); CSS background images and sprite cells are captured from the page. Small images are scaled up to minSize px without smoothing.',
    inputSchema: schema({
      ref: { type: 'string', description: 'Ref (e1..) of an image, sprite cell or any element.' },
      selector: { type: 'string', description: 'CSS selector of the element.' },
      url: { type: 'string', description: 'Image URL.' },
      minSize: { type: 'integer', description: 'Scale small images up to at least this many px on the short side, default 128 (0 keeps the size).' },
    }),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const minSize = Math.min(Math.max(num(a, 'minSize') ?? 128, 0), 1024);
      let url = str(a, 'url');
      let label = url ?? '';
      if (!url) {
        const ref = str(a, 'ref');
        const selector = str(a, 'selector');
        if (!ref && !selector) return failResult('Pass ref, selector or url.');
        const find = ref ? `kd.byRef(${JSON.stringify(ref)})` : `document.querySelector(${JSON.stringify(selector)})`;
        const el = await kdCall<{ tag: string; src: string; desc: string } | null>(session, `(() => { const el = ${find}; if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); return { tag: el.tagName, src: el.tagName === 'IMG' ? kd.srcOf(el) : '', desc: kd.desc(el) }; })()`);
        if (!el) return failResult(ref ? `Unknown ref ${ref}: take a new browser_snapshot.` : `No element matches ${selector}`);
        label = el.desc;
        if (el.src) url = el.src;
        else {
          await sleep(150);
          const box = await kdCall<{ x: number; y: number; width: number; height: number } | null>(session, `(() => { const el = ${find}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
          if (!box || box.width < 1 || box.height < 1) return failResult(`${label} has no visible size.`);
          const scale = Math.min(Math.max(1, Math.ceil(minSize / Math.min(box.width, box.height))), 8);
          const shot = await withTimeout(session.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale }, captureBeyondViewport: true }), 15_000, 'The capture timed out');
          return { content: [{ type: 'text', text: `${label}: captured from the page, ${Math.round(box.width)}x${Math.round(box.height)} px${scale > 1 ? ` shown at ${scale}x` : ''}` }, { type: 'image', data: String(shot.data), mimeType: 'image/png' }] };
        }
      }
      const res = await loadResource(session, tab, url);
      if (!res.mime?.startsWith('image/')) return failResult(`${url} is not an image (${res.mime ?? 'unknown type'}, ${kb(res.bytes.length)}).`);
      const png = await toPng(session, res.bytes, minSize, 1600);
      if ('error' in png) return failResult(`Could not decode ${url} (${res.mime}): ${png.error}`);
      const content: ToolContent[] = [
        { type: 'text', text: `${label === url ? fileNameFor(url, res.mime) : label}: ${res.mime}, ${kb(res.bytes.length)}, shown as PNG ${png.w}x${png.h} -> ${url}` },
        { type: 'image', data: png.data, mimeType: 'image/png' },
      ];
      return { content };
    }),
  },
  {
    name: 'browser_download',
    description:
      'Save files through the browser (its cookies and session, so sites that refuse plain downloads still work): one url, the image of a ref/selector, or every image of the page (images=true, main content by default, sprite sheets included). Files are named after the URL with the extension of their real type (servers often send WebP under .png names); png=true converts images to PNG. Default folder Downloads/kedalion/<host>.',
    inputSchema: schema({
      url: { type: 'string', description: 'URL of one file.' },
      ref: { type: 'string', description: 'Ref of an image (its source is saved).' },
      selector: { type: 'string', description: 'CSS selector of an image.' },
      images: { type: 'boolean', description: 'Every image of the main content (or scope, or the whole page with main=false).' },
      ...CONTENT,
      dir: { type: 'string', description: 'Absolute folder to save into.' },
      png: { type: 'boolean', description: 'Convert images to PNG (first frame of an animation).' },
      limit: { type: 'integer', description: 'Most files to save with images=true, default 200.' },
    }),
    run: guard(async (a, ctx) => {
      const { tab, session } = await pageSession(ctx, a);
      const pageUrl = await kdCall<string>(session, 'location.href');
      let urls: string[] = [];
      const one = str(a, 'url');
      if (one) urls = [new URL(one, pageUrl).href];
      else if (str(a, 'ref') || str(a, 'selector')) {
        const find = str(a, 'ref') ? `kd.byRef(${JSON.stringify(str(a, 'ref'))})` : `document.querySelector(${JSON.stringify(str(a, 'selector'))})`;
        const src = await kdCall<string | null>(session, `(() => { const el = ${find}; if (!el) return null; if (el.tagName === 'IMG') return kd.srcOf(el); const m = /url\\(["']?([^"')]+)/.exec(getComputedStyle(el).backgroundImage || ''); return m ? new URL(m[1], location.href).href : ''; })()`);
        if (src === null) return failResult('No such element; take a new browser_snapshot.');
        if (!src) return failResult('The element has no image source.');
        urls = [src];
      } else if (bool(a, 'images')) {
        const list = await kdCall<PageImages & { error?: string }>(session, `kd.images(${rootArgs(a)})`);
        if (list.error) return failResult(list.error);
        urls = [...new Set([...list.sprites.map((s) => s.sheet), ...list.images.map((i) => i.src)])].filter((u) => /^https?:/i.test(u));
      } else return failResult('Pass url, ref, selector or images=true.');
      const limit = Math.max(num(a, 'limit') ?? 200, 1);
      const dropped = Math.max(urls.length - limit, 0);
      urls = urls.slice(0, limit);
      if (!urls.length) return textResult('No images found; try main=false or loadLazy with browser_snapshot first.');
      const dir = str(a, 'dir') ?? defaultDir(pageUrl);
      const saved = await downloadAll(session, tab, urls, dir, bool(a, 'png'));
      const ok = saved.filter((s) => s.path);
      const lines = saved.map((s) => (s.path ? `saved ${relative(dir, s.path)} (${s.mime ?? '?'}, ${kb(s.bytes ?? 0)})` : `FAILED ${s.url}: ${s.error}`));
      return textResult(`${ok.length} of ${saved.length} saved in ${dir}${dropped ? ` (${dropped} more not saved; raise limit)` : ''}\n${lines.join('\n')}`);
    }),
  },
  {
    name: 'browser_crawl',
    description:
      'Follow the links of a site and save each page as Markdown (main content, tables kept) in a folder, with an index.md; images=true also saves each page\'s images and points the Markdown at the local files. Starts at url (default the current page), follows links matching pattern (default the start page\'s folder) up to depth and maxPages, waiting delayMs between pages, in its own background tab. Stops at a bot check and says so.',
    inputSchema: schema({
      url: { type: 'string', description: 'Start page, default the current page of the tab.' },
      pattern: { type: 'string', description: 'Links to follow: a URL or path prefix, * matches anything (e.g. /wiki/*). Default the folder of the start page.' },
      maxPages: { type: 'integer', description: 'Most pages to save, default 20, at most 300.' },
      depth: { type: 'integer', description: 'Link hops from the start page, default 2.' },
      delayMs: { type: 'integer', description: 'Pause between pages, default 800, at least 250.' },
      images: { type: 'boolean', description: 'Also save the images of each page (images/ folder).' },
      ...CONTENT,
      dir: { type: 'string', description: 'Absolute folder to save into; default Downloads/kedalion/<host>/crawl-<time>.' },
    }),
    run: guard(async (a, ctx) => {
      const from = await resolveTab(ctx, a).catch(() => undefined);
      let start = str(a, 'url');
      if (!start && from) start = (await kdCall<string>(ctx.service.tabs().session(from), 'location.href')) || undefined;
      if (!start || !/^https?:/i.test(start)) return failResult('Pass url (http or https), or open the start page first.');
      const pattern = str(a, 'pattern') ?? defaultPattern(start);
      const maxPages = Math.min(Math.max(num(a, 'maxPages') ?? 20, 1), 300);
      const depthMax = Math.min(Math.max(num(a, 'depth') ?? 2, 0), 10);
      const delay = Math.max(num(a, 'delayMs') ?? 800, 250);
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const dir = str(a, 'dir') ?? defaultDir(start, `crawl-${stamp}`);
      const imgDir = join(dir, 'images');
      await mkdir(dir, { recursive: true });
      const tab = (await ctx.service.open('about:blank', { activate: false })).id;
      const session = ctx.service.tabs().session(tab);
      const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
      const seen = new Set([pageKey(start)]);
      const index: string[] = [];
      const failures: string[] = [];
      const imageFiles = new Map<string, string>();
      let stopped = '';
      try {
        while (queue.length && index.length < maxPages) {
          const { url, depth } = queue.shift()!;
          if (index.length || failures.length) await sleep(delay);
          const since = ctx.service.logs(tab)?.network.entries({ limit: 1 }).at(-1)?.id ?? 0;
          const navError = await ctx.service.navigate(tab, url);
          if (navError) {
            failures.push(`${url}: ${navError}`);
            continue;
          }
          const report = await loadReport(ctx, tab, since, 30_000);
          if (report.includes('Bot check:')) {
            stopped = `Stopped at a bot check on ${url}: ask the user to complete it in the Browser view (tab ${tab}), then crawl again; saved pages are kept.`;
            break;
          }
          const status = /Status: (\d+)/.exec(report)?.[1];
          if (status && Number(status) >= 400) {
            failures.push(`${url}: HTTP ${status}`);
            continue;
          }
          const md = await kdCall<Markdown>(session, `kd.markdown(${rootArgs(a)})`);
          if (md.error) {
            failures.push(`${url}: ${md.error}`);
            continue;
          }
          let text = md.markdown;
          if (bool(a, 'images')) {
            const list = await kdCall<PageImages>(session, `kd.images(${rootArgs(a)})`).catch(() => ({ images: [], sprites: [] }) as PageImages);
            const wanted = [...new Set(list.images.map((i) => i.src))].filter((u) => /^https?:/i.test(u) && !imageFiles.has(u));
            for (const s of await downloadAll(session, tab, wanted, imgDir, false)) if (s.path) imageFiles.set(s.url, relative(dir, s.path).replace(/\\/g, '/'));
            text = text.replace(/\]\((https?:[^)\s]+)\)/g, (m, u: string) => (imageFiles.has(u) ? `](${imageFiles.get(u)})` : m));
          }
          const file = `${String(index.length + 1).padStart(3, '0')}-${slug(md.title.replace(/\s+[-|–]\s+[^-|–]+$/, ''))}.md`;
          await writeFile(join(dir, file), `# ${md.title}\n\nSource: ${md.url}\n\n${text}\n`);
          index.push(`- [${md.title.replace(/[[\]]/g, '')}](${file}) — ${md.url}`);
          if (depth >= depthMax) continue;
          const links = await kdCall<string[]>(session, `[...document.querySelectorAll('a[href]')].map((x) => x.href)`);
          for (const l of links) {
            const key = pageKey(l);
            if (seen.has(key) || !/^https?:/i.test(key) || NOT_PAGE.test(new URL(key).pathname) || !matchesPattern(key, pattern)) continue;
            seen.add(key);
            queue.push({ url: key, depth: depth + 1 });
          }
        }
      } finally {
        if (!stopped) await ctx.service.close(tab).catch(() => undefined);
      }
      await writeFile(join(dir, 'index.md'), `# Crawl of ${start}\n\nPattern: ${pattern}\n\n${index.join('\n')}\n${failures.length ? `\n## Failed\n\n${failures.map((f) => `- ${f}`).join('\n')}\n` : ''}`);
      const left = queue.length ? `; ${queue.length} matching links not visited (raise maxPages or depth)` : '';
      return textResult(
        `${index.length} pages saved in ${dir} (index.md)${bool(a, 'images') ? `, ${imageFiles.size} images in images/` : ''}${left}. Pattern: ${pattern}${failures.length ? `\nFailed (${failures.length}):\n${failures.slice(0, 20).join('\n')}` : ''}${stopped ? `\n${stopped}` : ''}`,
      );
    }),
  },
];
