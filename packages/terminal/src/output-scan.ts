/**
 * Reading what commands print: results (pull requests, issues, running apps, commits, pushes), links on a line
 * (URLs, file paths, commit hashes) and triggers (regular expressions over output lines). Pure, shared by the
 * server's session model and the pane; `createLineReader` reads the completed lines of an xterm buffer (browser or headless).
 */

export type ResultKind = 'pr' | 'issue' | 'newPr' | 'app' | 'commit' | 'push';

/** Something a line produced: its kind, its web page (null for a commit), a title, and a commit's hash and branch. */
export interface DetectedResult {
  kind: ResultKind;
  url: string | null;
  title: string;
  /** The branch of a commit or push. */
  detail?: string;
  /** Full or short hash of a commit. */
  hash?: string;
}

/** Carried between the lines of one terminal: the remote of the push being read. */
export interface ScanState {
  push?: { host: string; repo: string };
}

const MIN_LINE = 4;
const MAX_LINE = 2000;

const PR_PATTERNS: Array<{ re: RegExp; result: (m: RegExpExecArray) => DetectedResult }> = [
  {
    re: /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/g,
    result: (m) => ({ kind: m[2] === 'pull' ? 'pr' : 'issue', url: m[0], title: `${m[1]}#${m[3]}` }),
  },
  {
    re: /https?:\/\/(gitlab\.[\w.-]+)\/([\w./-]+?)\/-\/(merge_requests|issues)\/(\d+)/g,
    result: (m) => ({ kind: m[3] === 'issues' ? 'issue' : 'pr', url: m[0], title: `${m[2]}${m[3] === 'issues' ? '#' : '!'}${m[4]}` }),
  },
  {
    re: /https?:\/\/dev\.azure\.com\/[^\s/]+\/[^\s/]+\/_git\/([^\s/]+)\/pullrequest\/(\d+)/g,
    result: (m) => ({ kind: 'pr', url: m[0], title: `${m[1]} !${m[2]}` }),
  },
  {
    re: /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/new\/([^\s'"<>`]+)/g,
    result: (m) => ({ kind: 'newPr', url: m[0], title: `${m[1]} ${m[2]}`, detail: m[2] }),
  },
];

const APP_RE = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w-]+\.localhost)(:\d{2,5})(\/[^\s'"<>`]*)?/g;
const COMMIT_RE = /^\[([^\s\]]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/;
const PUSH_TO_RE = /^To (?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](?:\d+\/)?([\w./-]+?)(?:\.git)?\/?$/;
const PUSH_REF_RE = /^\s*[+*-]?\s*(?:[0-9a-f]{7,40}\.\.\.?[0-9a-f]{7,40}|\[new branch\]|\[new tag\])\s+(\S+)\s+->\s+(\S+)/;

const trimUrl = (url: string) => url.replace(/[).,;:'"\]]+$/, '');

/** The results one output line produced; `state` carries a push's remote to the lines after it. */
export function detectResults(raw: string, state: ScanState): DetectedResult[] {
  if (raw.length < MIN_LINE || raw.length > MAX_LINE) return [];
  const line = raw.trimEnd();
  const out: DetectedResult[] = [];
  for (const { re, result } of PR_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) out.push(result(m));
  }
  APP_RE.lastIndex = 0;
  for (let m = APP_RE.exec(line); m; m = APP_RE.exec(line)) {
    const host = /^(0\.0\.0\.0|\[::\]|\[::1\])$/.test(m[1]) ? 'localhost' : m[1];
    const url = trimUrl(`${m[0].startsWith('https') ? 'https' : 'http'}://${host}${m[2]}${m[3] ?? ''}`);
    out.push({ kind: 'app', url, title: `${host}${m[2]}` });
  }
  const commit = COMMIT_RE.exec(line.trim());
  if (commit) out.push({ kind: 'commit', url: null, title: commit[3], detail: commit[1], hash: commit[2] });
  const to = PUSH_TO_RE.exec(line.trim());
  if (to) state.push = { host: to[1], repo: to[2] };
  else if (state.push) {
    const ref = PUSH_REF_RE.exec(line);
    if (ref) {
      const { host, repo } = state.push;
      const branch = ref[2].replace(/^refs\/heads\//, '');
      const url = host === 'github.com' ? `https://github.com/${repo}/tree/${branch}` : host.startsWith('gitlab.') ? `https://${host}/${repo}/-/tree/${branch}` : null;
      out.push({ kind: 'push', url, title: `${repo} ${branch}`, detail: branch });
    } else if (!/^\s|^remote:|^Enumerating|^Counting|^Delta|^Compressing|^Writing|^Total/.test(line)) state.push = undefined;
  }
  return out;
}

/** The key that makes two results the same one (a newer copy replaces the older). */
export const resultKey = (r: DetectedResult) => `${r.kind}\0${r.url ?? r.hash ?? r.title}`;

export type LinkKind = 'url' | 'path' | 'hash';

/** A link on a line: what it is, its text (a path without its `:line:col`), and the columns it spans in the line. */
export interface LineLink {
  kind: LinkKind;
  text: string;
  start: number;
  /** Exclusive. */
  end: number;
  /** Line number after a path (`file.ts:12`, `file.ts(12,5)`). */
  line?: number;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+/g;
const WIN_PATH_RE = /(?:\b[A-Za-z]:[\\/]|\\\\)[^\s"'<>|*?:()]+(?::(\d+)(?::\d+)?|\((\d+),\d+\))?/g;
const REL_PATH_RE = /(^|[\s('"`=:])((?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+-]+)+)(?::(\d+)(?::\d+)?|\((\d+),\d+\))?/g;
const HASH_RE = /\b[0-9a-f]{7,40}\b/g;

/** URLs, file paths and commit hashes on a line, left to right, never overlapping. */
export function findLinks(line: string): LineLink[] {
  if (line.length > MAX_LINE * 4) return [];
  const out: LineLink[] = [];
  const taken = (s: number, e: number) => out.some((l) => s < l.end && e > l.start);
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(line); m; m = URL_RE.exec(line)) {
    const text = trimUrl(m[0]);
    out.push({ kind: 'url', text, start: m.index, end: m.index + text.length });
  }
  WIN_PATH_RE.lastIndex = 0;
  for (let m = WIN_PATH_RE.exec(line); m; m = WIN_PATH_RE.exec(line)) {
    const suffix = m[1] ?? m[2];
    const cut = suffix !== undefined ? m[0].search(/[:(]\d/) : m[0].length;
    const text = m[0].slice(0, cut).replace(/[.,;]+$/, '');
    if (text.length < 4 || taken(m.index, m.index + m[0].length)) continue;
    out.push({ kind: 'path', text, start: m.index, end: m.index + m[0].length, ...(suffix ? { line: Number(suffix) } : {}) });
  }
  REL_PATH_RE.lastIndex = 0;
  for (let m = REL_PATH_RE.exec(line); m; m = REL_PATH_RE.exec(line)) {
    const start = m.index + m[1].length;
    const full = m[0].slice(m[1].length);
    const text = m[2].replace(/[.,;]+$/, '');
    // A fraction or date (1/2, 2024/01/02) is not a path.
    if (/^[\d/.]+$/.test(text) || taken(start, start + full.length)) continue;
    const suffix = m[3] ?? m[4];
    out.push({ kind: 'path', text, start, end: start + full.length, ...(suffix ? { line: Number(suffix) } : {}) });
  }
  HASH_RE.lastIndex = 0;
  for (let m = HASH_RE.exec(line); m; m = HASH_RE.exec(line)) {
    if (!/[a-f]/.test(m[0]) || !/\d/.test(m[0]) || taken(m.index, m.index + m[0].length)) continue;
    out.push({ kind: 'hash', text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type TriggerAction = 'highlight' | 'capture' | 'notify';

/** A regular expression run over each output line, with what a match does. */
export interface TerminalTrigger {
  id: string;
  name?: string;
  pattern: string;
  action: TriggerAction;
  caseSensitive?: boolean;
  /** `#rrggbb` of a highlight. */
  color?: string;
  enabled?: boolean;
}

export interface CompiledTrigger {
  trigger: TerminalTrigger;
  re: RegExp;
}

export const MAX_TRIGGERS = 50;
export const MAX_TRIGGER_PATTERN = 500;

/** The enabled triggers whose pattern compiles. */
export function compileTriggers(list: readonly TerminalTrigger[] | undefined): CompiledTrigger[] {
  return (list ?? []).flatMap((trigger) => {
    if (trigger.enabled === false || !trigger.pattern) return [];
    try {
      return [{ trigger, re: new RegExp(trigger.pattern, trigger.caseSensitive ? '' : 'i') }];
    } catch {
      return [];
    }
  });
}

/** The triggers list as settings save it, or null when anything in it is malformed. */
export function validTriggers(raw: unknown): TerminalTrigger[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_TRIGGERS) return null;
  const keys = new Set(['id', 'name', 'pattern', 'action', 'caseSensitive', 'color', 'enabled']);
  for (const t of raw) {
    if (typeof t !== 'object' || t === null || Array.isArray(t)) return null;
    const r = t as Record<string, unknown>;
    if (!Object.keys(r).every((k) => keys.has(k))) return null;
    if (typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
    if (r.name !== undefined && (typeof r.name !== 'string' || r.name.length > 80)) return null;
    if (typeof r.pattern !== 'string' || r.pattern.length > MAX_TRIGGER_PATTERN) return null;
    if (r.action !== 'highlight' && r.action !== 'capture' && r.action !== 'notify') return null;
    if (r.caseSensitive !== undefined && typeof r.caseSensitive !== 'boolean') return null;
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') return null;
    if (r.color !== undefined && (typeof r.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.color))) return null;
    if (r.pattern) {
      try {
        new RegExp(r.pattern);
      } catch {
        return null;
      }
    }
  }
  return raw as TerminalTrigger[];
}

/** The part of an xterm Terminal (browser or headless) the line reader uses. */
export interface ScanTerminal {
  buffer: {
    active: {
      type: 'normal' | 'alternate';
      length: number;
      baseY: number;
      cursorY: number;
      getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
    };
  };
  registerMarker(cursorYOffset?: number): { line: number; isDisposed: boolean; dispose(): void } | undefined;
}

/** Most rows one read looks at; a burst of output is read from its end. */
const MAX_READ_ROWS = 500;

export interface LineReader {
  /** Reads the lines completed since the last read; `emit` false skips them (prompt and typed command). */
  read(emit?: boolean): void;
  /** Skips everything up to the cursor row. */
  skipToCursor(): void;
  dispose(): void;
}

/** Reads each completed (logical, unwrapped) line of the normal buffer once, with the row it starts on. */
export function createLineReader(term: ScanTerminal, onLine: (text: string, row: number) => void): LineReader {
  let marker: ReturnType<ScanTerminal['registerMarker']>;
  const cursorRow = () => term.buffer.active.baseY + term.buffer.active.cursorY;
  const placeAt = (row: number) => {
    marker?.dispose();
    marker = term.registerMarker(row - cursorRow());
  };
  const read = (emit = true) => {
    const buf = term.buffer.active;
    if (buf.type !== 'normal') return;
    const end = cursorRow();
    let row = marker && !marker.isDisposed ? marker.line : 0;
    if (end - row > MAX_READ_ROWS) row = end - MAX_READ_ROWS;
    // A wrapped row continues the line above; start on a line's first row.
    while (row > 0 && row < end && buf.getLine(row)?.isWrapped) row++;
    let next = row;
    while (row < end) {
      let last = row;
      // Bounded by the cursor row: the line the cursor is on may still grow, so it is not read yet.
      while (last + 1 <= end && buf.getLine(last + 1)?.isWrapped) last++;
      if (last >= end) break;
      if (emit) {
        let text = '';
        for (let y = row; y <= last; y++) text += buf.getLine(y)?.translateToString(y === last) ?? '';
        if (text.trim()) onLine(text, row);
      }
      row = last + 1;
      next = row;
    }
    if (!marker || marker.isDisposed || marker.line !== next) placeAt(next);
  };
  return {
    read,
    skipToCursor: () => placeAt(cursorRow()),
    dispose: () => marker?.dispose(),
  };
}
