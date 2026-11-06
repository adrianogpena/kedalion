import { closeSync, openSync, readSync, readdirSync, statSync, type Stats } from 'node:fs';
import { join } from 'node:path';

import type { AgentCacheState, AgentCost, AgentSession, AgentTokens } from '../protocol.ts';
import { costOf } from './pricing.ts';
import { localDayKey } from './usage-history.ts';

export type { AgentSession };

export interface ProjectRef {
  name: string;
  path: string;
}

type Entry = Record<string, any>;

const CHUNK = 64 * 1024;
const SYNTHETIC = ['<command-name>', '<local-command-', '<command-message>', '<system-reminder>', '<usage>', '<bash-input>', '<bash-stdout>', '<bash-stderr>'];

function readRange(file: string, start: number, length: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function parseLines(text: string, dropFirst: boolean, dropLast: boolean): Entry[] {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out: Entry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === 'object') out.push(v);
    } catch {
      /* partial or corrupt line */
    }
  }
  return out;
}

/** The text of a real user prompt, or undefined for synthetic turns and tool results. */
export function realPrompt(entry: Entry): string | undefined {
  if (entry.type !== 'user' || entry.isMeta === true || entry.isSidechain === true) return undefined;
  const content = entry.message?.content;
  let text: string | undefined;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((c) => c?.type === 'tool_result')) return undefined;
    text = content.find((c) => c?.type === 'text' && typeof c.text === 'string')?.text;
  }
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed || SYNTHETIC.some((p) => trimmed.startsWith(p))) return undefined;
  return trimmed;
}

/** `/name args` of a slash-command turn, or undefined for any other entry. */
function commandPrompt(entry: Entry): string | undefined {
  if (entry.type !== 'user' || entry.isMeta === true || entry.isSidechain === true) return undefined;
  const content = entry.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.find((c) => c?.type === 'text' && typeof c.text === 'string')?.text : undefined;
  const name = text && /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/.exec(text)?.[1];
  if (!name) return undefined;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

function entryTitle(e: Entry): string | undefined {
  const v =
    e.type === 'summary' ? e.summary : e.type === 'ai-title' ? e.aiTitle : e.type === 'custom-title' ? e.customTitle : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function truncate(s: string, n = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Claude's transcript folder name of a directory: every non-alphanumeric character becomes `-`. */
export function encodeFolderName(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-');
}

/** Restricts a scan to the folders of the registered projects (and their subfolders), newest `perFolder` transcripts each plus `keep` ids. */
export interface ScanLimit {
  projectPaths: string[];
  perFolder: number;
  keep: ReadonlySet<string>;
}

/** Decodes a project folder name (`C--x-y` -> `C:\x\y`), a fallback when no transcript line has a cwd. */
export function decodeFolderName(name: string): string {
  const m = /^([A-Za-z])--(.*)$/.exec(name);
  if (m) return `${m[1]}:\\${m[2].replace(/-/g, '\\')}`;
  return name.replace(/-/g, '/');
}

/** Parses the head (and tail) of a transcript; null for files that are not sessions. */
export function parseTranscript(
  file: string,
  size: number,
  meta: { id: string; account: string; folder: string; mtime: number },
): AgentSession | null {
  const head = parseLines(readRange(file, 0, Math.min(size, CHUNK)), false, size > CHUNK);
  const tail = size > CHUNK ? parseLines(readRange(file, size - CHUNK, CHUNK), true, false) : [];
  if (head.length > 0 && head.every((e) => e.isSidechain === true)) return null;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let firstPrompt: string | undefined;
  let title: string | undefined;
  let model: string | undefined;
  let command: string | undefined;
  let answered = false;
  for (const e of head) {
    if (e.isSidechain === true) continue;
    if (!cwd && typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
    if (!gitBranch && typeof e.gitBranch === 'string' && e.gitBranch) gitBranch = e.gitBranch;
    if (!firstPrompt) firstPrompt = realPrompt(e);
    if (!command) command = commandPrompt(e);
    else if (e.type === 'user' && e.isMeta === true) answered = true;
    else if (e.type === 'assistant' && e.message?.model !== '<synthetic>') answered = true;
  }
  // A session opened with a command that ran (a skill expands into a meta turn or gets a reply; `/clear` does neither) is named after it until a real prompt or title exists.
  if (!firstPrompt && answered) firstPrompt = command;
  for (const e of [...head, ...tail]) {
    if (e.isSidechain === true) continue;
    const t = entryTitle(e);
    if (t) title = t;
    const m = e.message?.model;
    if (e.type === 'assistant' && typeof m === 'string' && m && m !== '<synthetic>') model = m;
  }
  if (!firstPrompt && !title) return null;
  return {
    id: meta.id,
    account: meta.account,
    cwd: cwd ?? decodeFolderName(meta.folder),
    title: title ? truncate(title, 200) : truncate(firstPrompt ?? meta.id),
    firstPrompt: truncate(firstPrompt ?? ''),
    updatedAt: meta.mtime,
    gitBranch,
    model,
  };
}

/** Running token sums of a transcript, fed only with the bytes appended since `offset`. */
export interface TokenTally {
  /** Bytes consumed (through the last complete line). */
  offset: number;
  tokens: AgentTokens;
  /** Usage counted per assistant message id: Claude writes one entry per content block, repeating the usage. */
  byMessage: Map<string, AgentTokens>;
  /** Input + cache tokens of the last main-chain assistant turn (its context size). */
  lastContext?: number;
  /** Estimated USD per local day ('YYYY-MM-DD', from the entry `timestamp`); entries without a timestamp or with an unknown model are left out. */
  dayCost: Map<string, number>;
  /** Cost counted per assistant message id, so a repeated id replaces its earlier amount. */
  msgCost: Map<string, { day: string; usd: number }>;
}

const TOKEN_KEYS = ['input', 'output', 'cacheCreation', 'cacheRead'] as const;
const TALLY_CHUNK = 1024 * 1024;

export const newTally = (): TokenTally => ({ offset: 0, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, byMessage: new Map(), dayCost: new Map(), msgCost: new Map() });

/** Local day of an entry's ISO `timestamp`, or undefined. */
function entryDay(e: Entry): string | undefined {
  const ms = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : typeof e.timestamp === 'number' ? e.timestamp : NaN;
  return Number.isFinite(ms) ? localDayKey(ms) : undefined;
}

function tallyCost(t: TokenTally, e: Entry, u: AgentTokens, id: string | undefined): void {
  const raw = e.message?.usage?.cache_creation;
  const oneHour = raw && typeof raw.ephemeral_1h_input_tokens === 'number' ? raw.ephemeral_1h_input_tokens : 0;
  const day = entryDay(e);
  const usd = day ? costOf(typeof e.message?.model === 'string' ? e.message.model : undefined, { ...u, cacheCreation1h: oneHour }) : undefined;
  const prev = id ? t.msgCost.get(id) : undefined;
  if (prev) t.dayCost.set(prev.day, (t.dayCost.get(prev.day) ?? 0) - prev.usd);
  if (day && usd !== undefined) {
    t.dayCost.set(day, (t.dayCost.get(day) ?? 0) + usd);
    if (id) t.msgCost.set(id, { day, usd });
  } else if (id) t.msgCost.delete(id);
}

function usageTokens(u: unknown): AgentTokens | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return { input: n(o.input_tokens), output: n(o.output_tokens), cacheCreation: n(o.cache_creation_input_tokens), cacheRead: n(o.cache_read_input_tokens) };
}

/** Adds one transcript entry's `message.usage`; a repeated message id replaces its earlier count. */
export function tallyEntry(t: TokenTally, e: Entry): void {
  if (e.type !== 'assistant') return;
  const u = usageTokens(e.message?.usage);
  if (!u) return;
  const id = typeof e.message?.id === 'string' && e.message.id ? e.message.id : typeof e.uuid === 'string' ? e.uuid : undefined;
  const prev = id ? t.byMessage.get(id) : undefined;
  for (const k of TOKEN_KEYS) t.tokens[k] += u[k] - (prev?.[k] ?? 0);
  tallyCost(t, e, u, id);
  if (id) t.byMessage.set(id, u);
  if (e.isSidechain !== true) t.lastContext = u.input + u.cacheCreation + u.cacheRead;
}

/** Feeds the complete lines appended since `t.offset`; starts over when the file shrank (rewritten). */
export function updateTally(file: string, size: number, prev: TokenTally): TokenTally {
  const t = size < prev.offset ? newTally() : prev;
  if (size === t.offset) return t;
  const fd = openSync(file, 'r');
  try {
    let pos = t.offset;
    let rest = Buffer.alloc(0);
    while (pos < size) {
      const chunk = Buffer.alloc(Math.min(TALLY_CHUNK, size - pos));
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n <= 0) break;
      pos += n;
      const buf = rest.length ? Buffer.concat([rest, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      const nl = buf.lastIndexOf(0x0a);
      if (nl < 0) {
        rest = buf;
        continue;
      }
      for (const e of parseLines(buf.subarray(0, nl).toString('utf8'), false, false)) tallyEntry(t, e);
      t.offset += nl + 1;
      rest = buf.subarray(nl + 1);
    }
  } finally {
    closeSync(fd);
  }
  return t;
}

/**
 * Context used in percent from the last turn's input + cache tokens. The window is the one a statusLine record reported for the model
 * (`windowSize`); without it 200k for Claude models (1M once above that).
 */
export function contextPercentOf(model: string | undefined, used: number | undefined, windowSize?: number): number | undefined {
  if (!used || !model || !/^claude-/i.test(model)) return undefined;
  const window = windowSize && windowSize >= used ? windowSize : /\[1m\]/i.test(model) || used > 200_000 ? 1_000_000 : 200_000;
  return Math.min(100, Math.round((used / window) * 100));
}

const CACHE_TAIL = 512 * 1024;
const TTL_5M = 5 * 60_000;
const TTL_1H = 60 * 60_000;

/**
 * Prompt-cache state from the last 512 KB of a transcript: the newest assistant message with usage gives the last-request time;
 * the TTL is 1 h if the newest cache-writing message wrote 1-hour tokens, else 5 min (also when nothing wrote cache).
 */
export function cacheStateOf(file: string, size: number): AgentCacheState | undefined {
  const start = Math.max(0, size - CACHE_TAIL);
  const entries = parseLines(readRange(file, start, size - start), start > 0, false);
  let lastAt: number | undefined;
  let ttlMs: number | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    const u = e.type === 'assistant' ? e.message?.usage : undefined;
    if (!u || typeof u !== 'object') continue;
    if (lastAt === undefined) {
      const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
      if (!Number.isFinite(at)) continue;
      lastAt = at;
    }
    const c = u.cache_creation;
    if (c && Number(c.ephemeral_1h_input_tokens) > 0) {
      ttlMs = TTL_1H;
      break;
    }
    if ((c && Number(c.ephemeral_5m_input_tokens) > 0) || Number(u.cache_creation_input_tokens) > 0) {
      ttlMs = TTL_5M;
      break;
    }
  }
  return lastAt === undefined ? undefined : { lastRequestAt: lastAt, ttlMs: ttlMs ?? TTL_5M };
}

interface CacheEntry {
  account: string;
  mtime: number;
  size: number;
  session: AgentSession | null;
  tally: TokenTally;
  /** False when parsed by a quick scan (no token sums, no cache state). */
  full: boolean;
}

/** Scanner caching each transcript by (mtime, size); only changed files are re-parsed, and token sums read only the appended bytes. */
export function createSessionScanner() {
  const cache = new Map<string, CacheEntry>();
  return {
    /** Forgets every cached transcript so the next scan re-reads them. */
    clear(): void {
      cache.clear();
    },
    /** Estimated USD per account on two local days, summed over cached transcripts modified at or after `since` (ms). */
    cost(today: string, yesterday: string, since: number): Map<string, AgentCost> {
      const out = new Map<string, AgentCost>();
      for (const c of cache.values()) {
        if (!c.full || c.mtime < since) continue;
        const td = c.tally.dayCost.get(today);
        const yd = c.tally.dayCost.get(yesterday);
        if (td === undefined && yd === undefined) continue;
        const o = out.get(c.account) ?? { today: 0, yesterday: 0 };
        o.today += td ?? 0;
        o.yesterday += yd ?? 0;
        out.set(c.account, o);
      }
      return out;
    },
    /** `quick` skips the token sums and cache state (the costly whole-file reads) for the first paint; a later full scan fills them. */
    scan(accounts: Array<{ id: string; dir: string }>, quick = false, limit?: ScanLimit, windowOf?: (model: string) => number | undefined): AgentSession[] {
      const prefixes = limit?.projectPaths.map((p) => encodeFolderName(p).toLowerCase());
      const seen = new Set<string>();
      const out: AgentSession[] = [];
      for (const acc of accounts) {
        const root = join(acc.dir, 'projects');
        let folders: string[] = [];
        try {
          folders = readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        } catch {
          continue;
        }
        for (const folder of folders) {
          if (prefixes) {
            const lower = folder.toLowerCase();
            if (!prefixes.some((p) => lower === p || lower.startsWith(`${p}-`))) continue;
          }
          let files: string[] = [];
          try {
            files = readdirSync(join(root, folder)).filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));
          } catch {
            continue;
          }
          let stats: Array<{ f: string; file: string; st: Stats }> = [];
          for (const f of files) {
            const file = join(root, folder, f);
            try {
              stats.push({ f, file, st: statSync(file) });
            } catch {
              /* vanished */
            }
          }
          if (limit) {
            stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
            stats = stats.filter((x, i) => i < limit.perFolder || limit.keep.has(x.f.slice(0, -6)));
          }
          for (const { f, file, st } of stats) {
            seen.add(file);
            let c = cache.get(file);
            if (!c || c.mtime !== st.mtimeMs || c.size !== st.size || (!quick && !c.full)) {
              let session: AgentSession | null = null;
              let tally = c?.tally ?? newTally();
              try {
                session = parseTranscript(file, st.size, { id: f.slice(0, -6), account: acc.id, folder, mtime: st.mtimeMs });
                if (!quick) tally = updateTally(file, st.size, tally);
              } catch {
                session = null;
              }
              if (session && !quick) {
                const tk = tally.tokens;
                if (tk.input + tk.output + tk.cacheCreation + tk.cacheRead > 0) session.tokens = { ...tk };
                try {
                  const cache = cacheStateOf(file, st.size);
                  if (cache) session.cache = cache;
                } catch {
                  /* no cache state */
                }
              }
              c = { account: acc.id, mtime: st.mtimeMs, size: st.size, session, tally, full: !quick };
              cache.set(file, c);
            }
            if (c.session) {
              const pct = c.full ? contextPercentOf(c.session.model, c.tally.lastContext, c.session.model ? windowOf?.(c.session.model) : undefined) : undefined;
              out.push(pct !== undefined && pct !== c.session.contextPercent ? { ...c.session, contextPercent: pct } : c.session);
            }
          }
        }
      }
      for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
      return out;
    },
  };
}

function norm(p: string, ci: boolean): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return ci ? s.toLowerCase() : s;
}

/** The project whose path equals or contains the cwd (longest match wins). */
export function matchProject<P extends ProjectRef>(
  cwd: string,
  projects: P[],
  caseInsensitive = process.platform === 'win32',
): P | undefined {
  const c = norm(cwd, caseInsensitive);
  let best: P | undefined;
  let bestLen = -1;
  for (const p of projects) {
    const pp = norm(p.path, caseInsensitive);
    if ((c === pp || c.startsWith(`${pp}/`)) && pp.length > bestLen) {
      best = p;
      bestLen = pp.length;
    }
  }
  return best;
}

/**
 * At most `cap` sessions per project: live ones first (always kept), then newest by `updatedAt`. Original order is kept; archived ones use slots.
 * `group` names the counted bucket (default the project; a split project node when `shareProjects` is off).
 */
export function capPerProject<T extends { project?: string; node?: string; live?: boolean; updatedAt: number }>(items: T[], cap: number, group: (x: T) => string | undefined = (x) => x.node ?? x.project): T[] {
  const keep = new Set<T>();
  const by = new Map<string, T[]>();
  for (const x of items) {
    const g = group(x);
    if (x.project === undefined || g === undefined || x.live) {
      keep.add(x);
      continue;
    }
    const l = by.get(g);
    if (l) l.push(x);
    else by.set(g, [x]);
  }
  for (const [project, rest] of by) {
    const used = items.filter((x) => group(x) === project && x.live).length;
    rest.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const x of rest.slice(0, Math.max(0, cap - used))) keep.add(x);
  }
  return items.filter((x) => keep.has(x));
}
