import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../catalog.server';
import type { SourceContext } from '../../server';
import { ticketsSource, ticketsStore } from './server';

const config = { connection: '', statuses: 'Todo', keyPattern: '', jiraBaseUrl: '' };

async function setup(key = 'ABC-1', notes?: string) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tickets-data-'));
  const ticketsRoot = await mkdtemp(join(tmpdir(), 'tickets-root-'));
  await ticketsStore(dataDir).update((s) => ({ ...s, tickets: [{ id: 't1', key, description: '', status: 'Todo', autoMove: null, order: 0, ...(notes ? { notes } : {}) }] }));
  const ctx = { dataDir, ticketsRoot, signal: new AbortController().signal, projectRoots: async () => [{ id: 'kedalion-tickets', path: ticketsRoot }] } as unknown as SourceContext;
  const act = (name: string, payload: unknown) => ticketsSource.actions![name]!(payload, config as never, ctx) as Promise<any>;
  return { dataDir, ticketsRoot, act };
}

describe('tickets files', () => {
  test('default-root notes fall back to the stored notes, then move to the file', async () => {
    const { dataDir, ticketsRoot, act } = await setup('ABC-1', 'old');
    expect(await act('notes-get', { id: 't1' })).toBe('old');
    await act('notes-set', { id: 't1', text: 'new' });
    expect(await readFile(join(ticketsRoot, 'ABC-1.md'), 'utf8')).toBe('new');
    expect(await act('notes-get', { id: 't1' })).toBe('new');
    expect((await ticketsStore(dataDir).read()).tickets[0]!.notes).toBeUndefined();
  });

  test('file-get on a missing file creates nothing', async () => {
    const { ticketsRoot, act } = await setup();
    expect(await act('file-get', { id: 't1', kind: 'sql' })).toEqual({ text: '', exists: false, project: 'kedalion-tickets', path: 'sql/ABC-1.sql' });
    expect(existsSync(join(ticketsRoot, 'sql'))).toBe(false);
  });

  test('file-set creates the subfolder and file', async () => {
    const { ticketsRoot, act } = await setup();
    const out = await act('file-set', { id: 't1', kind: 'rest', text: 'curl x' });
    expect(out).toEqual({ text: 'curl x', exists: true, project: 'kedalion-tickets', path: 'rest/ABC-1.curl' });
    expect(await readFile(join(ticketsRoot, 'rest', 'ABC-1.curl'), 'utf8')).toBe('curl x');
  });

  test('an unsafe key is rejected', async () => {
    const { ticketsRoot, act } = await setup('../evil');
    await expect(act('file-set', { id: 't1', kind: 'sql', text: 'x' })).rejects.toThrow();
    expect(existsSync(join(ticketsRoot, 'sql'))).toBe(false);
  });
});
