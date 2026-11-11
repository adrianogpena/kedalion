export const THREAD_MAX = 10;

export interface ThreadItem {
  author: string;
  copilot: boolean;
  body: string;
  path: string;
  line: number | null;
  outdated: boolean;
  url: string;
  createdAt: string;
  replies: number;
  lastReplier: string;
}

export interface ThreadsInfo {
  items: ThreadItem[];
  /** Unresolved threads beyond `THREAD_MAX`. */
  more: number;
}

interface CommentNode {
  author?: { login?: string } | null;
  body?: string | null;
  createdAt?: string;
  url?: string;
}

export interface ThreadNode {
  isResolved?: boolean;
  isOutdated?: boolean;
  path?: string | null;
  line?: number | null;
  originalLine?: number | null;
  comments?: { totalCount?: number; nodes?: (CommentNode | null)[] } | null;
}

/** The unresolved threads, newest first, the first `THREAD_MAX` of them. */
export function mapThreads(nodes: readonly (ThreadNode | null | undefined)[]): ThreadsInfo {
  const open = nodes.filter((t): t is ThreadNode => !!t && t.isResolved === false);
  const items = open.map((t): ThreadItem => {
    const list = (t.comments?.nodes ?? []).filter((c): c is CommentNode => !!c);
    const first = list[0];
    const total = t.comments?.totalCount ?? list.length;
    const author = first?.author?.login ?? '';
    return {
      author,
      copilot: /copilot/i.test(author),
      body: (first?.body ?? '').trim(),
      path: t.path ?? '',
      line: t.line ?? t.originalLine ?? null,
      outdated: t.isOutdated === true,
      url: first?.url ?? '',
      createdAt: first?.createdAt ?? '',
      replies: Math.max(0, total - 1),
      lastReplier: total > 1 ? (list[list.length - 1]?.author?.login ?? '') : '',
    };
  });
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items: items.slice(0, THREAD_MAX), more: Math.max(0, items.length - THREAD_MAX) };
}
