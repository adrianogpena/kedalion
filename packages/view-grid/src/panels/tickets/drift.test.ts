import { describe, expect, test } from 'bun:test';
import { DEFAULT_JIRA_MAP, driftOf } from './drift';
import { DEFAULT_STATUSES, type Ticket } from './model';

const ticket = (status: string, extra: Partial<Ticket> = {}): Ticket => ({ id: 'a', key: 'X-1', description: '', status, autoMove: null, order: 0, ...extra });
const map = DEFAULT_JIRA_MAP;

describe('driftOf', () => {
  test('ahead when Jira is further right', () => {
    expect(driftOf(ticket('Open'), 'In Review', DEFAULT_STATUSES, map)).toEqual({ expected: 'In Review', direction: 'ahead' });
  });

  test('behind when Jira is further left', () => {
    expect(driftOf(ticket('In Test'), 'in progress', DEFAULT_STATUSES, map)).toEqual({ expected: 'In Progress', direction: 'behind' });
  });

  test('null when equal, unmapped, missing or muted', () => {
    expect(driftOf(ticket('In Review'), 'In Review', DEFAULT_STATUSES, map)).toBeNull();
    expect(driftOf(ticket('Open'), 'Weird', DEFAULT_STATUSES, map)).toBeNull();
    expect(driftOf(ticket('Open'), undefined, DEFAULT_STATUSES, map)).toBeNull();
    expect(driftOf(ticket('Open', { jiraMuted: 'In Review' }), 'In Review', DEFAULT_STATUSES, map)).toBeNull();
    expect(driftOf(ticket('Open', { jiraMuted: 'Draft' }), 'In Review', DEFAULT_STATUSES, map)).not.toBeNull();
  });

  test('null when the expected column is not on the board; board spelling is returned', () => {
    expect(driftOf(ticket('Open'), 'In Review', ['Open', 'Done'], map)).toBeNull();
    expect(driftOf(ticket('Open'), 'In Review', ['Open', 'IN REVIEW'], map)).toEqual({ expected: 'IN REVIEW', direction: 'ahead' });
  });
});
