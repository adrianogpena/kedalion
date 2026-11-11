import { renderMarkdown, sanitizeHtml } from './markdown';

export interface ExportImage {
  mime: string;
  bytes: Uint8Array;
}

export interface ExportHtmlOptions {
  /** The page title, e.g. the file name. */
  title?: string;
  /** Reads a relative image src from the project; null when it cannot be read. Wins over `resolveImage`. */
  loadImage?(src: string): Promise<ExportImage | null>;
  /** The editor's image resolver (a URL it may still be loading); used to build `loadImage` when that is absent. */
  resolveImage?(src: string): string | null;
  /** Markdown to sanitized HTML; defaults to `renderMarkdown` (needs a DOM). */
  render?(markdown: string, opts: { resolveImage(src: string): string | null }): string;
}

/** Largest local image embedded as a data URI. */
export const MAX_EMBED_BYTES = 2 * 1024 * 1024;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const unescapeHtml = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!);

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? unescapeHtml(m[1] ?? m[2] ?? '') : null;
};

/** The data URI for a local `src` of at most 2 MiB, or null (the image then becomes its alt text). */
async function dataUriOf(src: string, loadImage: (src: string) => Promise<ExportImage | null>): Promise<string | null> {
  let image: ExportImage | null = null;
  if (src && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
    try {
      image = await loadImage(src);
    } catch {
      image = null;
    }
  }
  return image && image.bytes.length <= MAX_EMBED_BYTES && /^image\/[\w.+-]+$/i.test(image.mime) ? `data:${image.mime};base64,${toBase64(image.bytes)}` : null;
}

/** Rewrites every `<img>`: a local image of at most 2 MiB becomes a data URI; anything else becomes its alt text. */
export async function embedImages(html: string, loadImage: (src: string) => Promise<ExportImage | null>): Promise<string> {
  // With a DOM, the images are rewritten as elements, so attribute escaping does not matter.
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
    const cache = new Map<string, Promise<string | null>>();
    for (const img of [...doc.body.querySelectorAll('img')]) {
      const src = (img.getAttribute('src') ?? '').trim();
      const alt = img.getAttribute('alt') ?? '';
      if (!cache.has(src)) cache.set(src, dataUriOf(src, loadImage));
      const uri = await cache.get(src)!;
      if (uri) {
        const out = doc.createElement('img');
        out.setAttribute('src', uri);
        out.setAttribute('alt', alt);
        img.replaceWith(out);
      } else {
        img.replaceWith(doc.createTextNode(alt));
      }
    }
    return doc.body.innerHTML;
  }
  const tags = [...new Set(html.match(/<img\b[^>]*>/gi) ?? [])];
  const replacements = new Map<string, string>();
  for (const tag of tags) {
    const src = (attr(tag, 'src') ?? '').trim();
    const alt = attr(tag, 'alt') ?? '';
    const uri = await dataUriOf(src, loadImage);
    replacements.set(tag, uri ? `<img src="${uri}" alt="${escapeHtml(alt)}">` : escapeHtml(alt));
  }
  return html.replace(/<img\b[^>]*>/gi, (tag) => replacements.get(tag) ?? '');
}

/** Removes `<script>` elements and `on*=` attributes (the renderer already sanitizes; this is a second guard). */
export function stripActive(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/(<[a-z][^>]*?)\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '$1');
}

const CSS = `
html{background:#fff;color:#1f2328}
body{max-width:860px;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em}
h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}
a{color:#0969da}
img{max-width:100%;height:auto}
pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
code{background:#eff1f3;padding:.15em .35em;border-radius:4px}
pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:.8rem 1rem;overflow:auto}
pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:0 1em;color:#59636e;border-left:4px solid #d0d7de}
table{border-collapse:collapse;margin:1em 0}
th,td{border:1px solid #d0d7de;padding:.35em .7em;text-align:left}
th{background:#f6f8fa}
hr{border:0;border-top:1px solid #d0d7de}
@media print{
html,body,pre,code,th{background:none!important;color:#000}
body{max-width:none;margin:0;padding:0}
pre{border-color:#999;white-space:pre-wrap;word-break:break-word}
pre,table,tr,img,blockquote{break-inside:avoid;page-break-inside:avoid}
h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}
a{color:#000;text-decoration:underline}
a[href^="http"]::after{content:" (" attr(href) ")";font-size:.85em}
}
`;

/** Sanitizes with DOMPurify when a DOM exists (same config as the editor preview); without one only `stripActive` runs, so `render` must return sanitized HTML. */
function sanitizeBody(body: string): string {
  if (typeof document === 'undefined') return stripActive(body);
  const box = document.createElement('div');
  box.append(sanitizeHtml(body));
  return stripActive(box.innerHTML);
}

/** Wraps rendered body HTML in a standalone page (UTF-8, inline CSS, print rules, no scripts). */
export function buildPage(body: string, title = ''): string {
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n${sanitizeBody(body)}\n</body>\n</html>\n`;
}

// The editor's resolver hands out a placeholder data URI first and the blob URL once the bytes are in; poll the same resolver.
async function loaderFromResolver(resolveImage: (src: string) => string | null): Promise<(src: string) => Promise<ExportImage | null>> {
  return async (src) => {
    let url = resolveImage(src);
    for (let i = 0; i < 100 && url?.startsWith('data:'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      url = resolveImage(src);
    }
    if (!url || url.startsWith('data:')) return null;
    const blob = await (await fetch(url)).blob();
    return { mime: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
  };
}

/** A standalone HTML snapshot of `markdown` (unsaved text included). Needs a DOM unless `render` is given. */
export async function exportHtml(markdown: string, opts: ExportHtmlOptions = {}): Promise<string> {
  // Relative srcs stay as written, so embedImages can load each one.
  const render = opts.render ?? ((md, o) => renderMarkdown(md, o));
  const body = render(markdown, { resolveImage: (src) => src });
  const load = opts.loadImage ?? (opts.resolveImage ? await loaderFromResolver(opts.resolveImage) : async () => null);
  return buildPage(await embedImages(body, load), opts.title);
}
