import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IMarker, Terminal } from '@xterm/headless';
import { RE2JS } from 're2js';
import type { EarlierHit } from '../protocol.ts';

export interface EarlierSearch {
  caseSensitive?: boolean;
  regex?: boolean;
}

/** A terminal's earlier output: the lines that left (or are about to leave) its scrollback, kept on disk for search. */
export interface Earlier {
  /** Saves the oldest unsaved rows when a full scrollback is about to drop them (call on every line feed). */
  check(): void;
  /** Saves the unsaved rows an erase is about to lose: the scrollback's, and the screen's too unless `scrollback`. */
  flush(kind: 'screen' | 'scrollback'): void;
  search(query: string, o?: EarlierSearch): Promise<{ hits: EarlierHit[]; count: number }>;
  dispose(): void;
}

/** Unsaved rows left above the top of a full scrollback before a batch is saved. */
const SAFETY = 1000;
const BATCH = 1000;
const MAX_HITS = 300;
const AROUND = 2;
/** Lines remembered to leave out a program's redraw of what is already kept (Claude Code redraws after a wipe). */
const RECENT = 5000;
/** A run of this many lines already kept is a redraw, not output. */
const REPEAT_RUN = 3;
const MIN_COMPARED = 12;

const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_SCAN_LINES = 100_000;
const SCAN_BUDGET_MS = 1000;
const MAX_REGEX_LENGTH = 200;
const MAX_REGEX_LINE = 300;

/** Indexes of the lines matching the regex, or undefined when it does not compile (RE2 has no backreferences or lookaround) or the scan runs past the budget; RE2 matches in linear time, so no pattern can freeze the server. */
async function regexScan(lines: string[], query: string, caseSensitive: boolean): Promise<number[] | undefined> {
  let re: RE2JS;
  try {
    re = RE2JS.compile(query, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch {
    return undefined;
  }
  const at: number[] = [];
  const deadline = Date.now() + SCAN_BUDGET_MS;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length <= MAX_REGEX_LINE && re.test(lines[i])) at.push(i);
    if ((i & 255) === 255 && Date.now() > deadline) return undefined;
  }
  return at;
}

/** The last MAX_SCAN_BYTES of the file as text, starting at a line start. */
function readTail(file: string): string {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - MAX_SCAN_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

export function createEarlier(term: Terminal, file: string, maxBytes = 20 * 1024 * 1024): Earlier {
  let marker: IMarker | undefined;
  /** After an erase the unsaved rows start at the top of the screen; after a lost marker, at the top of the buffer. */
  let anchorAtScreen = false;
  let bytes = 0;
  const recent: string[] = [];
  const recentSet = new Map<string, number>();
  const normal = () => term.buffer.normal;
  const cursorRow = () => normal().baseY + normal().cursorY;

  const unsavedStart = () => {
    if (marker && !marker.isDisposed) return marker.line;
    const row = anchorAtScreen ? normal().baseY : 0;
    anchorAtScreen = false;
    return row;
  };
  const placeAt = (row: number) => {
    marker?.dispose();
    marker = term.buffer.active.type === 'normal' ? term.registerMarker(row - cursorRow()) : undefined;
  };

  const remember = (key: string) => {
    recent.push(key);
    recentSet.set(key, (recentSet.get(key) ?? 0) + 1);
    if (recent.length > RECENT) {
      const old = recent.shift()!;
      const n = (recentSet.get(old) ?? 1) - 1;
      if (n) recentSet.set(old, n);
      else recentSet.delete(old);
    }
  };
  const keyOf = (line: string) => line.replace(/\s+/g, '');

  /** Leaves out runs of lines already kept (a redraw), then writes the rest. */
  const write = (lines: string[]) => {
    const keys = lines.map(keyOf);
    const known = keys.map((k) => k.length >= MIN_COMPARED && recentSet.has(k));
    const keep: string[] = [];
    for (let i = 0; i < lines.length; ) {
      if (!known[i]) {
        keep.push(lines[i]);
        i++;
        continue;
      }
      let j = i;
      while (j < lines.length && (known[j] || !keys[j])) j++;
      if (j - i < REPEAT_RUN) keep.push(...lines.slice(i, j));
      i = j;
    }
    for (const k of keys) if (k.length >= MIN_COMPARED) remember(k);
    while (keep.length && !keep[keep.length - 1].trim()) keep.pop();
    if (!keep.length) return;
    const text = keep.join('\n') + '\n';
    try {
      if (!bytes) mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, text);
      bytes += Buffer.byteLength(text);
      if (bytes > maxBytes) {
        const all = readFileSync(file, 'utf8');
        const kept = all.slice(Math.floor(all.length / 2));
        const cut = kept.indexOf('\n') + 1;
        writeFileSync(file, kept.slice(cut));
        bytes = Buffer.byteLength(kept) - cut;
      }
    } catch {
      // A full disk loses earlier output, never the terminal.
    }
  };

  /** Saves rows [from, to) as logical lines and moves the marker to `to`. */
  const save = (from: number, to: number) => {
    const buf = normal();
    const lines: string[] = [];
    for (let y = from; y < to; y++) {
      const line = buf.getLine(y);
      if (!line) break;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    write(lines);
    placeAt(to);
  };

  const check = () => {
    if (term.buffer.active.type !== 'normal') return;
    const buf = normal();
    if (buf.length < (term.options.scrollback ?? 0) + term.rows) return;
    const start = unsavedStart();
    if (start >= SAFETY) return;
    let to = Math.min(buf.baseY, start + BATCH);
    while (to < buf.baseY && buf.getLine(to)?.isWrapped) to++;
    if (to > start) save(start, to);
  };

  const flush = (kind: 'screen' | 'scrollback') => {
    if (term.buffer.active.type !== 'normal') return;
    save(unsavedStart(), kind === 'screen' ? normal().length : normal().baseY);
    marker?.dispose();
    marker = undefined;
    anchorAtScreen = true;
  };

  const search = async (query: string, o: EarlierSearch = {}) => {
    if (!query || !existsSync(file)) return { hits: [], count: 0 };
    let test: (line: string) => boolean = () => false;
    if (o.regex) {
      if (query.length > MAX_REGEX_LENGTH) return { hits: [], count: 0 };
    } else {
      const q = o.caseSensitive ? query : query.toLowerCase();
      test = o.caseSensitive ? (line) => line.includes(q) : (line) => line.toLowerCase().includes(q);
    }
    const lines = readTail(file).split('\n');
    if (lines.length > MAX_SCAN_LINES) lines.splice(0, lines.length - MAX_SCAN_LINES);
    let at: number[] = [];
    if (o.regex) {
      const found = await regexScan(lines, query, !!o.caseSensitive);
      if (!found) return { hits: [], count: 0 };
      at = found;
    } else {
      for (let i = 0; i < lines.length; i++) if (test(lines[i])) at.push(i);
    }
    const hits = at
      .slice(-MAX_HITS)
      .reverse()
      .map((i) => ({ line: lines[i], before: lines.slice(Math.max(0, i - AROUND), i), after: lines.slice(i + 1, i + 1 + AROUND) }));
    return { hits, count: at.length };
  };

  return {
    check,
    flush,
    search,
    dispose: () => {
      marker?.dispose();
      rmSync(file, { force: true });
    },
  };
}
