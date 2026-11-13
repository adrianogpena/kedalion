import type { CdpSession } from '@kedalion/cdp';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { runtimeEval } from './page-util.ts';

/** Writes `data` to an absolute `path` (creating its folder) and returns the resolved path. */
export async function writeOutput(path: string, data: string | Uint8Array): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`Pass an absolute path, not ${path}`);
  const file = resolve(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  return file;
}

/** The real type of the bytes (servers often send WebP under a .png or .gif name). */
export function sniffMime(b: Uint8Array): string | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif';
  if (at(0, 0x42, 0x4d)) return 'image/bmp';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  const head = new TextDecoder().decode(b.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'text/html';
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  return undefined;
}

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/svg+xml': '.svg',
  'text/html': '.html',
  'application/pdf': '.pdf',
};
export const extFor = (mime: string | undefined): string => (mime ? (EXT[mime.split(';')[0]!.trim()] ?? '') : '');

/**
 * File name for a downloaded resource: the last path segment that looks like a file name
 * (Fandom's `.../Beet.png/revision/latest` gives Beet), cleaned, with the extension of the real type.
 */
export function fileNameFor(url: string, mime: string | undefined): string {
  let base = 'file';
  let bare = true;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    const named = [...parts].reverse().find((p) => /\.[a-z0-9]{2,5}$/i.test(p));
    bare = !named;
    base = named ?? parts.at(-1) ?? new URL(url).hostname;
  } catch {
    // Not a URL; keep the default name.
  }
  base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  const ext = extFor(mime);
  const own = bare ? '' : extname(base);
  if (ext && own.toLowerCase() !== ext && !(ext === '.jpg' && own.toLowerCase() === '.jpeg')) base = (own ? base.slice(0, -own.length) : base) + ext;
  return base;
}

/** `dir/name`, or `dir/name-2`, `-3`... when taken (on disk or in `taken`). */
export function uniqueFile(dir: string, name: string, taken: Set<string> = new Set()): string {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 1; ; i++) {
    const p = join(dir, i === 1 ? name : `${stem}-${i}${ext}`);
    if (!taken.has(p.toLowerCase()) && !existsSync(p)) {
      taken.add(p.toLowerCase());
      return p;
    }
  }
}

export interface LoadedResource {
  bytes: Uint8Array;
  /** Sniffed type, else the server's Content-Type. */
  mime?: string;
  status?: number;
}

/**
 * Fetches `url` through the browser itself (its cookies, its network stack, no CORS), so files a site
 * refuses to plain HTTP clients (bot checks) still load. Falls back to a fetch from the page.
 */
export async function loadResource(session: CdpSession, frameId: string, url: string): Promise<LoadedResource> {
  let first: string | undefined;
  try {
    const r: any = await session.send('Network.loadNetworkResource', { frameId, url, options: { disableCache: false, includeCredentials: true } });
    const res = r?.resource;
    if (res?.success && res.stream) {
      const chunks: Buffer[] = [];
      try {
        for (;;) {
          const part: any = await session.send('IO.read', { handle: res.stream, size: 1 << 20 });
          if (part.data) chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'));
          if (part.eof) break;
        }
      } finally {
        void session.send('IO.close', { handle: res.stream }).catch(() => undefined);
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const header = Object.entries((res.headers ?? {}) as Record<string, string>).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
      if (res.httpStatusCode && res.httpStatusCode >= 400) throw new Error(`HTTP ${res.httpStatusCode}`);
      return { bytes, mime: sniffMime(bytes) ?? header?.split(';')[0], status: res.httpStatusCode };
    }
    first = res?.netErrorName ?? (res?.httpStatusCode ? `HTTP ${res.httpStatusCode}` : 'not loaded');
  } catch (e) {
    first = (e as Error).message;
  }
  const r = await runtimeEval(
    session,
    `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); const b = await r.blob(); const d = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); }); return { type: b.type, status: r.status, data: String(d).split(',')[1] || '' }; })`,
    { awaitPromise: true, returnByValue: true, timeoutMs: 30_000 },
  );
  if (!r.ok) throw new Error(`${first ? `${first}; ` : ''}page fetch: ${r.text}`);
  const v = r.value as { type: string; status: number; data: string };
  const bytes = new Uint8Array(Buffer.from(v.data, 'base64'));
  return { bytes, mime: sniffMime(bytes) ?? (v.type || undefined), status: v.status };
}

/**
 * Converts image bytes to PNG in the page (first frame of an animation), scaled up without smoothing
 * to at least `minSize` px on the short side (pixel art stays sharp) and down to at most `maxSize` px
 * on the long side; `error` when the page cannot decode it.
 */
export async function toPng(session: CdpSession, bytes: Uint8Array, minSize = 0, maxSize = 4096): Promise<{ data: string; w: number; h: number } | { error: string }> {
  const b64 = Buffer.from(bytes).toString('base64');
  const r = await runtimeEval(
    session,
    `(async () => {
      const raw = atob(${JSON.stringify(b64)});
      const u = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u]));
      const up = Math.max(1, Math.ceil(${minSize} / Math.max(1, Math.min(bmp.width, bmp.height))));
      const k = Math.min(up, ${maxSize} / Math.max(bmp.width, bmp.height));
      const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = k < 1;
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const out = await c.convertToBlob({ type: 'image/png' });
      const d = await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(out); });
      return { data: String(d).split(',')[1], w: c.width, h: c.height };
    })()`,
    { awaitPromise: true, returnByValue: true, timeoutMs: 30_000 },
  );
  if (!r.ok) return { error: r.text };
  return r.value as { data: string; w: number; h: number };
}
