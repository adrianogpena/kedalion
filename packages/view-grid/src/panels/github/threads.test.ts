import { describe, expect, test } from 'bun:test';
import { mapThreads, THREAD_MAX } from './threads';

const thread = (createdAt: string, extra: object = {}) => ({
  isResolved: false,
  path: 'a/B.java',
  line: 3,
  comments: { totalCount: 1, nodes: [{ author: { login: 'rev' }, body: ' fix this ', createdAt, url: 'u' }] },
  ...extra,
});

describe('mapThreads', () => {
  test('keeps unresolved threads, newest first', () => {
    const r = mapThreads([thread('2026-01-01'), { ...thread('x'), isResolved: true }, null, thread('2026-02-01')]);
    expect(r.items.map((i) => i.createdAt)).toEqual(['2026-02-01', '2026-01-01']);
    expect(r.items[0]).toMatchObject({ author: 'rev', body: 'fix this', path: 'a/B.java', line: 3, replies: 0, outdated: false, copilot: false });
    expect(r.more).toBe(0);
  });

  test('reports replies, the last replier, outdated and Copilot', () => {
    const t = thread('d', {
      isOutdated: true,
      comments: { totalCount: 3, nodes: [{ author: { login: 'copilot-pull-request-reviewer' }, body: 'b' }, { author: { login: 'me' } }, { author: { login: 'dev' } }] },
    });
    expect(mapThreads([t]).items[0]).toMatchObject({ copilot: true, outdated: true, replies: 2, lastReplier: 'dev' });
  });

  test('caps the list and counts the rest', () => {
    const r = mapThreads(Array.from({ length: THREAD_MAX + 3 }, (_, i) => thread(String(i).padStart(3, '0'))));
    expect(r.items).toHaveLength(THREAD_MAX);
    expect(r.more).toBe(3);
  });
});
