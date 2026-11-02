import { statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

/** Web path (no leading slash, e.g. `assets/index-a1b2.js`) → file to send. */
export type AssetMap = Record<string, string>;

/** Where the built web UI comes from: files bundled into the exe, or a folder on disk. */
export type WebSource = { files: AssetMap } | { dir: string };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

// Inline styles are allowed (React style props, themeHead's <style>, CodeMirror); inline and
// remote scripts are not, and images only come from the app, data:/blob: URLs or Spotify's cover CDN (i.scdn.co).
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.scdn.co; media-src 'self' blob:; " +
  "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'self' http://127.0.0.1:*";

const COMMON_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

// Vite puts content-hashed files under `assets/`; their URL changes whenever their content does.
const IMMUTABLE = 'public, max-age=31536000, immutable';

let embedded: AssetMap | null = null;

/** Called by the entry that `kedalion build` generates, before the app's own code runs. */
export function setEmbeddedWebAssets(files: AssetMap): void {
  embedded = files;
}

/** The web UI bundled into the exe, or null when running from source. */
export function embeddedWebAssets(): AssetMap | null {
  return embedded;
}

function lookupIn(source: WebSource): (path: string) => string | null {
  if ('files' in source) return (path) => (Object.hasOwn(source.files, path) ? source.files[path]! : null);
  const base = resolve(source.dir);
  return (path) => {
    const target = resolve(base, path);
    if (!target.startsWith(base + sep)) return null;
    return statSync(target, { throwIfNoEntry: false })?.isFile() ? target : null;
  };
}

/** Rewrites `index.html` before it is sent, e.g. to inline the saved theme. */
export type IndexTransform = (html: string) => string | Promise<string>;

/**
 * Serves the built UI. Unknown paths get `index.html` (the UI routes by hash); `..` segments get a 404.
 * `transformIndex` applies to every `index.html` response, the fallback included.
 */
export function staticHandler(source: WebSource, transformIndex?: IndexTransform): (pathname: string) => Promise<Response> {
  const lookup = lookupIn(source);
  return async (pathname) => {
    let path: string;
    try {
      path = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      return notFound('Not found');
    }
    if (path.split(/[\\/]/).includes('..')) return notFound('Not found');
    const hit = path === '' ? null : lookup(path);
    const name = hit ? path : 'index.html';
    const file = hit ?? lookup('index.html');
    if (!file) return notFound('UI not found. Run "bun run build:web" first.');
    const body = transformIndex && name === 'index.html' ? await transformIndex(await Bun.file(file).text()) : Bun.file(file);
    return new Response(body, {
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': name.startsWith('assets/') ? IMMUTABLE : 'no-cache',
        ...(name === 'index.html' ? { 'Content-Security-Policy': CSP } : {}),
      },
    });
  };
}

const notFound = (text: string) => new Response(text, { status: 404, headers: COMMON_HEADERS });
