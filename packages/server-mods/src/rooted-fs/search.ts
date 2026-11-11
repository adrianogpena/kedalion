import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ndjson, type Routes } from '@kedalion/server-core';
import { isBinary } from '../bytes.ts';
import { collator, notADir, parseExclude, type SearchHit } from './common.ts';
import type { Ctx } from './context.ts';

const MAX_SEARCH_HITS = 5000;
const MAX_NAME_HITS = 200_000;
const MAX_CONTENT_BYTES = 1_000_000;
const MAX_HITS_PER_FILE = 20;
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Walks the tree below `start` breadth-first and yields name hits (case-insensitive substring of
 * `q`, and `glob` on the name when given) and, with `content`, lines containing `q` in text files
 * up to 1 MB (`glob` then picks the files). Skips `node_modules`, `.git` and links; returns as soon
 * as `signal` aborts. Exported for the tests.
 */
export async function* searchTree(
  start: { abs: string; rel: string },
  query: { q: string; content: boolean; glob: Bun.Glob | null; exclude?: Bun.Glob[] },
  signal: AbortSignal,
): AsyncGenerator<SearchHit> {
  const q = query.q.toLowerCase();
  const nameMatches = (name: string) => (q === '' || name.toLowerCase().includes(q)) && (!query.glob || query.glob.match(name));
  const queue = [start];
  while (queue.length && !signal.aborted) {
    const dir = queue.shift()!;
    let dirents: Dirent[];
    try {
      dirents = await readdir(dir.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    dirents.sort((a, b) => collator.compare(a.name, b.name));
    for (const d of dirents) {
      if (signal.aborted) return;
      if (d.isSymbolicLink() || SKIP_DIRS.has(d.name) || !(d.isDirectory() || d.isFile())) continue;
      const rel = dir.rel ? `${dir.rel}/${d.name}` : d.name;
      if (query.exclude?.some((g) => g.match(rel))) continue;
      const abs = join(dir.abs, d.name);
      if (nameMatches(d.name)) yield { path: rel, kind: d.isDirectory() ? 'dir' : 'file' };
      if (d.isDirectory()) queue.push({ abs, rel });
      else if (query.content && q !== '' && (!query.glob || query.glob.match(d.name))) {
        for (const hit of await contentHits(abs, q)) {
          if (signal.aborted) return;
          yield { path: rel, kind: 'file', ...hit };
        }
      }
    }
  }
}

/** Up to MAX_HITS_PER_FILE lines of a text file containing `q` (lower-cased); [] for big, binary or unreadable files. */
async function contentHits(file: string, q: string): Promise<Array<{ line: number; text: string }>> {
  try {
    if ((await stat(file)).size > MAX_CONTENT_BYTES) return [];
    const bytes = await Bun.file(file).bytes();
    if (isBinary(bytes)) return [];
    const hits: Array<{ line: number; text: string }> = [];
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
      const at = lines[i]!.toLowerCase().indexOf(q);
      if (at < 0) continue;
      // Long lines (minified code) are cut to a window around the match.
      const from = Math.max(0, at - 100);
      hits.push({ line: i + 1, text: lines[i]!.slice(from, from + 300).trim() });
    }
    return hits;
  } catch {
    return [];
  }
}

/** The search routes: content/name search and the full name listing. */
export function searchRoutes(ctx: Ctx): Routes {
  const { locate, fromQuery } = ctx;
  return {
    'GET /api/fs/search': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const glob = query.get('glob') ? new Bun.Glob(query.get('glob')!) : null;
      const search = { q: query.get('q') ?? '', content: query.get('content') === '1', glob, exclude: parseExclude(query.get('exclude')) };
      return ndjson(req, async (emit, signal) => {
        let count = 0;
        for await (const hit of searchTree({ abs: loc.real, rel: loc.segments.join('/') }, search, signal)) {
          await emit(hit);
          if (++count >= MAX_SEARCH_HITS) break;
        }
      });
    },

    // Every file and folder path below `path` (excludes applied), for Quick Open and tree find.
    'GET /api/fs/names': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const search = { q: '', content: false, glob: null, exclude: parseExclude(query.get('exclude')) };
      return ndjson(req, async (emit, signal) => {
        let count = 0;
        for await (const hit of searchTree({ abs: loc.real, rel: loc.segments.join('/') }, search, signal)) {
          await emit(hit);
          if (++count >= MAX_NAME_HITS) break;
        }
      });
    },
  };
}
