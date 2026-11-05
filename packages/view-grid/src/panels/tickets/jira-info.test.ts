import { describe, expect, test } from 'bun:test';
import { findPcr, formatDuration, infoFields, isOverdue, mapInfo, pcrOf, ticketEvents } from './jira-info';

describe('mapInfo', () => {
  const raw = {
    key: 'ABC-1',
    fields: {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Bug' },
      priority: { name: 'High' },
      assignee: { displayName: 'Ana' },
      parent: { key: 'ABC-9', fields: { summary: 'Epic' } },
      labels: ['a', 'b'],
      fixVersions: [{ name: '1.2' }],
      issuelinks: [
        { type: { inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'ABC-3', fields: { summary: 'Rel', status: { name: 'Open' } } } },
        { type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'ABC-2', fields: { summary: 'Blocker', status: { name: 'Open' } } } },
      ],
      customfield_1: 5,
      timeoriginalestimate: 57600,
      timeestimate: 28800,
      timespent: 0,
      updated: '2026-10-01T10:00:00.000+0000',
      duedate: '2026-10-20',
      comment: { comments: [{ author: { displayName: 'Bo' }, created: 'c1', body: 'first' }, { author: { displayName: 'Cy' }, created: 'c2', body: 'last' }] },
    },
  };

  test('maps the fields, blockers first', () => {
    const info = mapInfo(raw, 'customfield_1');
    expect(info).toMatchObject({ status: 'In Progress', tone: 'info', type: 'Bug', priority: 'High', assignee: 'Ana', parent: 'ABC-9 Epic', points: 5, originalEstimate: 57600, remainingEstimate: 28800, timeSpent: null });
    expect(info.links.map((l) => [l.key, l.blocker])).toEqual([['ABC-2', true], ['ABC-3', false]]);
    expect(info.lastComment).toEqual({ author: 'Cy', created: 'c2', body: 'last' });
  });

  test('empty issue gives empty values', () => {
    expect(mapInfo({ key: 'X-1' })).toMatchObject({ status: '', assignee: '', parent: '', labels: [], links: [], points: null, lastComment: null });
  });
});

test('infoFields adds the points field only when known', () => {
  expect(infoFields()).not.toContain('customfield_1');
  expect(infoFields('customfield_1')).toContain('customfield_1');
});

test('formatDuration uses 8h days and 5d weeks', () => {
  expect(formatDuration(3600 * 6)).toBe('6h');
  expect(formatDuration(3600 * 12)).toBe('1d 4h');
  expect(formatDuration(3600 * 8 * 5)).toBe('1w');
});

test('isOverdue ignores done tickets and empty dates', () => {
  const now = Date.parse('2026-10-26T12:00:00');
  expect(isOverdue('2026-10-20', 'info', now)).toBe(true);
  expect(isOverdue('2026-10-20', 'ok', now)).toBe(false);
  expect(isOverdue('', 'info', now)).toBe(false);
  expect(isOverdue('2026-10-26', 'info', now)).toBe(false);
});

test('findPcr reads the number of the first PCR tag', () => {
  expect(findPcr(['Fix login', 'PCR#163 - Analysis & FAD'])).toBe('163');
  expect(findPcr(['Umsetzung (PCR # 12)'])).toBe('12');
  expect(findPcr(['no tag'])).toBe('');
});

test('pcrOf looks in the title, parent, labels and linked titles', () => {
  expect(pcrOf({ fields: { summary: 'PCR#163 - FAD' } })).toBe('163');
  expect(pcrOf({ fields: { summary: 'x', parent: { fields: { summary: 'PCR#7 - epic' } } } })).toBe('7');
  expect(pcrOf({ fields: { summary: 'x', issuelinks: [{ type: { inward: 'relates to' }, inwardIssue: { key: 'A-1', fields: { summary: 'PCR#9' } } }] } })).toBe('9');
  expect(pcrOf({ fields: { summary: 'x' } })).toBe('');
});

describe('ticketEvents', () => {
  const prev = JSON.stringify(['In Progress', 'Ana', 'High']);
  test('one line per changed field, old → new', () => {
    expect(ticketEvents('VWDE-1', prev, { status: 'Done', assignee: '', priority: 'High' })).toEqual([
      { heading: 'Status', line: 'VWDE-1: In Progress → Done' },
      { heading: 'Assignee', line: 'VWDE-1: Ana → Unassigned' },
    ]);
  });
  test('a new ticket gives nothing', () => {
    expect(ticketEvents('VWDE-1', undefined, { status: 'Done', assignee: '', priority: 'High' })).toEqual([]);
  });
});
