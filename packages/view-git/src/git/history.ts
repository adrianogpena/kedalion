import type { CommitSummary } from './graph.ts';

/** A commit as the history helpers read it; newest first, as `git log` lists them. */
export interface HistoryCommit extends CommitSummary {
  subject: string;
  author?: string;
}

/** A stash entry: `git stash` makes a commit with 2 or 3 parents and a "WIP on …" or "On …" subject. */
export const isStashCommit = (c: HistoryCommit) => (c.parents.length === 2 || c.parents.length === 3) && /^(WIP on|On) [^:]+:/.test(c.subject);

/** Hashes from `from` down its first parents up to and including `to`; undefined if `to` is not reached in `max` steps or the page. */
export function firstParentChain(commits: readonly CommitSummary[], from: string, to: string, max = 1000): string[] | undefined {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const out: string[] = [];
  let cur: string | undefined = from;
  while (cur !== undefined && out.length < max) {
    out.push(cur);
    if (cur === to) return out;
    cur = byHash.get(cur)?.parents[0];
  }
  return undefined;
}

export type FirstParentPosition = { kind: 'linear'; distance: number } | { kind: 'belowMerge'; distance: number } | { kind: 'notFound' };

/**
 * Where `target` sits on HEAD's first-parent line: `linear` with no merge commit between them, `belowMerge`
 * when a merge lies on the way (rewriting it would flatten that merge), `notFound` off the line or the page.
 */
export function firstParentPosition(commits: readonly CommitSummary[], head: string, target: string): FirstParentPosition {
  const chain = firstParentChain(commits, head, target);
  if (!chain) return { kind: 'notFound' };
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const merge = chain.slice(0, -1).some((h) => (byHash.get(h)?.parents.length ?? 0) > 1);
  return { kind: merge ? 'belowMerge' : 'linear', distance: chain.length - 1 };
}

export type SquashCheck =
  | { ok: true; newest: string; oldest: string; /** The parent the squashed commit goes onto. */ onto: string }
  | { ok: false; reason: 'tooFew' | 'notLoaded' | 'notOnHead' | 'notContiguous' | 'merge' | 'root' };

/**
 * Whether the selected commits can be squashed into one: at least two, all in the loaded page, all on HEAD's
 * first-parent line, next to each other on it, none a merge, and the oldest has a parent to go onto.
 */
export function squashCheck(commits: readonly CommitSummary[], selected: readonly string[], head: string): SquashCheck {
  const want = new Set(selected);
  if (want.size < 2) return { ok: false, reason: 'tooFew' };
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  if ([...want].some((h) => !byHash.has(h))) return { ok: false, reason: 'notLoaded' };
  const line: string[] = [];
  let cur: string | undefined = head;
  let found = 0;
  while (cur !== undefined && byHash.has(cur) && found < want.size) {
    line.push(cur);
    if (want.has(cur)) found++;
    cur = byHash.get(cur)!.parents[0];
  }
  if (found < want.size) return { ok: false, reason: 'notOnHead' };
  const first = line.findIndex((h) => want.has(h));
  const run = line.slice(first);
  if (run.length !== want.size) return { ok: false, reason: 'notContiguous' };
  if (run.some((h) => byHash.get(h)!.parents.length > 1)) return { ok: false, reason: 'merge' };
  const oldest = run[run.length - 1]!;
  const onto = byHash.get(oldest)!.parents[0];
  if (onto === undefined) return { ok: false, reason: 'root' };
  return { ok: true, newest: run[0]!, oldest, onto };
}

/** A commit message split into its subject (first line) and body (after the blank line), both trimmed. */
export function splitMessage(message: string): { subject: string; body: string } {
  const text = message.replace(/\r\n/g, '\n').trim();
  const nl = text.indexOf('\n');
  if (nl < 0) return { subject: text, body: '' };
  return { subject: text.slice(0, nl).trim(), body: text.slice(nl + 1).replace(/^\n+/, '').trimEnd() };
}

/** The default message of a squash: the messages oldest first, as paragraphs separated by a blank line; empty ones skipped. */
export function squashMessage(messagesOldestFirst: readonly string[]): string {
  return messagesOldestFirst
    .map((m) => m.replace(/\r\n/g, '\n').trim())
    .filter(Boolean)
    .join('\n\n');
}

export type TodoRole = 'keep' | 'fold' | 'drop' | 'command';

const TODO_WORDS: Record<string, { word: string; role: TodoRole }> = {};
for (const [word, short, role] of [
  ['pick', 'p', 'keep'],
  ['reword', 'r', 'keep'],
  ['edit', 'e', 'keep'],
  ['squash', 's', 'fold'],
  ['fixup', 'f', 'fold'],
  ['drop', 'd', 'drop'],
  ['exec', 'x', 'command'],
  ['break', 'b', 'command'],
  ['label', 'l', 'command'],
  ['reset', 't', 'command'],
  ['merge', 'm', 'command'],
  ['update-ref', 'u', 'command'],
] as const) {
  TODO_WORDS[word] = TODO_WORDS[short] = { word, role };
}

export interface TodoLine {
  /** The full word (`p` gives `pick`). */
  word: string;
  role: TodoRole;
  /** The commit, for keep, fold and drop lines. */
  hash?: string;
  /** `fixup -C` / `-c`: the folded commit's message replaces the target's. */
  useMessage?: boolean;
  rest: string;
}

/** One line of a rebase todo; undefined for blank lines, comments and unknown words. */
export function parseTodoLine(line: string): TodoLine | undefined {
  const s = line.trim();
  if (!s || s.startsWith('#')) return undefined;
  const [first = '', ...more] = s.split(/\s+/);
  const known = TODO_WORDS[first];
  if (!known) return undefined;
  let rest = more;
  let useMessage: boolean | undefined;
  if (known.word === 'fixup' && (rest[0] === '-C' || rest[0] === '-c')) {
    useMessage = true;
    rest = rest.slice(1);
  }
  if (known.role === 'command') return { word: known.word, role: known.role, rest: more.join(' ') };
  return { word: known.word, role: known.role, hash: rest[0], ...(useMessage && { useMessage }), rest: rest.slice(1).join(' ') };
}

/**
 * For each fold line (squash/fixup), the index of the line it folds into: the nearest earlier keep line,
 * skipping other folds of the same run. Undefined when nothing precedes it (git refuses such a todo).
 */
export function foldTargets(lines: readonly (TodoLine | undefined)[]): (number | undefined)[] {
  let target: number | undefined;
  return lines.map((l, i) => {
    if (!l) return undefined;
    if (l.role === 'keep') {
      target = i;
      return undefined;
    }
    if (l.role === 'fold') return target;
    if (l.role === 'command') target = undefined;
    return undefined;
  });
}

/**
 * The messages git combines for a run of a keep line and its folds: the target's and each `squash`;
 * a plain `fixup` adds nothing; `fixup -C` replaces everything gathered so far.
 */
export function foldRunMessages(run: readonly { line: TodoLine; message: string }[]): string[] {
  let out: string[] = [];
  for (const { line, message } of run) {
    if (line.role === 'keep' || line.word === 'squash') out.push(message);
    else if (line.word === 'fixup' && line.useMessage) out = [message];
  }
  return out;
}

export interface FindOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

/** A matcher for history search: subject or author; a plain query of 4+ hex chars also matches a hash prefix. Undefined for a bad regex. */
export function historyMatcher(query: string, options: FindOptions = {}): ((c: HistoryCommit) => boolean) | undefined {
  const q = query.trim();
  if (!q) return () => true;
  let test: (s: string) => boolean;
  if (options.regex) {
    try {
      const re = new RegExp(q, options.caseSensitive ? '' : 'i');
      test = (s) => re.test(s);
    } catch {
      return undefined;
    }
  } else {
    const needle = options.caseSensitive ? q : q.toLowerCase();
    test = (s) => (options.caseSensitive ? s : s.toLowerCase()).includes(needle);
  }
  const sha = !options.regex && /^[0-9a-f]{4,64}$/i.test(q) ? q.toLowerCase() : undefined;
  return (c) => test(c.subject) || (c.author !== undefined && test(c.author)) || (sha !== undefined && c.hash.toLowerCase().startsWith(sha));
}

/**
 * Whether results for `next` are a subset of results for `prev`, so only the previous matches need checking:
 * both plain, same case mode, and `next` extends `prev`. A hash-prefix query is a refinement too.
 */
export function isRefinement(prev: string, next: string, options: FindOptions = {}): boolean {
  if (options.regex || !prev.trim()) return false;
  const a = options.caseSensitive ? prev.trim() : prev.trim().toLowerCase();
  const b = options.caseSensitive ? next.trim() : next.trim().toLowerCase();
  return b.length > a.length && b.includes(a);
}

/**
 * The row to keep in view after the history is reloaded: the anchor itself if it survived, else the nearest
 * old neighbour that did (looking newer first at each distance), else undefined.
 */
export function nearestSurvivor(before: readonly string[], after: readonly string[], anchor: string): string | undefined {
  const alive = new Set(after);
  if (alive.has(anchor)) return anchor;
  const at = before.indexOf(anchor);
  if (at < 0) return undefined;
  for (let d = 1; d < before.length; d++) {
    const up = before[at - d];
    if (up !== undefined && alive.has(up)) return up;
    const down = before[at + d];
    if (down !== undefined && alive.has(down)) return down;
  }
  return undefined;
}
